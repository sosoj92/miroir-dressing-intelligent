import {
  ASSEMBLY_LIMITS,
  ManifestError,
  buildAssemblyBatches,
  checkBytes,
  checkEntry,
  isAssemblyManifest,
  parseAssemblyManifest,
  planFiles,
  toAssemblyPayloads,
  uploadPlan,
  type AssemblyActionResult,
  type AssemblyBatch,
  type AssemblyCleanup,
  type AssemblyCounts,
  type PackageFile,
} from './assemblage';
import { isZip, pool } from './client';
import { findDbJson, folderOf, listZipEntries, readZipEntry, type ZipEntry } from './zip';

// Import du paquet d'assemblage dans le navigateur (docs/conception.md §3.2), sans DOM ni Supabase : le
// composant fournit l'envoi d'un fichier dans Storage et l'appel de la server action.
// 1. manifest.json lu et validé ; 2. chaque fichier attendu vérifié (présent, taille, octets
// magiques) ; rien n'est envoyé si quelque chose ne va pas ; 3. chaque photo envoyée une seule
// fois, même partagée par plusieurs pièces, avec ses couches des bras pliés s'il y en a ;
// 4. les fiches, par envois de moins de 900 Ko ; 5. une fois tous les envois écrits, les fichiers
// qu'ils ont remplacés, supprimés s'ils ne servent plus.

const UPLOAD_CONCURRENCY = 3;
const MANIFEST_NAME = 'manifest.json';

export type AssemblyPackage = {
  bytes: Uint8Array;
  /** Taille décompressée annoncée par le zip, par entrée. */
  sizes: Map<string, number>;
  /** Dossier de manifest.json, avec la barre finale (« » à la racine du zip). */
  folder: string;
  manifest: unknown;
};

export type OpenResult = { ok: true; pkg: AssemblyPackage } | { ok: false; error: string } | null;

export type AssemblyProgress =
  | { step: 'check' }
  | { step: 'photos'; done: number; total: number }
  | { step: 'sleeves'; done: number; total: number }
  | { step: 'save'; done: number; total: number };

export type AssemblyDeps = {
  userId: string;
  /** Envoie un fichier dans le bucket `items` (upsert). Renvoie false si l'envoi a échoué. */
  upload: (path: string, bytes: Uint8Array, contentType: string) => Promise<boolean>;
  /** Appelle la server action importAssembly. */
  send: (batch: AssemblyBatch) => Promise<AssemblyActionResult>;
  /**
   * Appelle la server action finishAssemblyImport avec les fichiers remplacés par tous les envois,
   * une fois le dernier écrit. Son échec n'annule rien (au pire, des fichiers orphelins).
   */
  finish: (cleanup: AssemblyCleanup) => Promise<unknown>;
  onProgress?: (progress: AssemblyProgress) => void;
};

export type AssemblyOutcome =
  /** `arms` : photos envoyées avec leurs couches des bras pliés. */
  | { ok: true; counts: AssemblyCounts; photos: number; arms: number; sleeves: number }
  | { ok: false; error: string };

function depth(path: string): number {
  return path.split('/').filter(Boolean).length;
}

/** manifest.json le moins profond du zip (hors métadonnées macOS), ou null. */
function findManifest(names: readonly string[]): string | null {
  const candidates = names.filter((name) => name === MANIFEST_NAME || name.endsWith(`/${MANIFEST_NAME}`));
  return candidates.sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1))[0] ?? null;
}

/**
 * Le fichier choisi est-il un paquet d'assemblage ? null s'il n'en est pas un (le flux du
 * prototype prend le relais), sinon le paquet ouvert, ou une erreur précise.
 */
export function openAssemblyPackage(bytes: Uint8Array): OpenResult {
  if (!isZip(bytes)) return null;
  let entries: ZipEntry[];
  try {
    entries = listZipEntries(bytes);
  } catch {
    return null; // le flux du prototype dira « Ce zip est illisible. »
  }
  const names = entries.map((entry) => entry.name);
  const manifestPath = findManifest(names);
  if (!manifestPath) return null;

  const sizes = new Map(entries.map((entry) => [entry.name, entry.size]));
  const hasDb = findDbJson(names) !== null;
  if ((sizes.get(manifestPath) ?? 0) > ASSEMBLY_LIMITS.manifestBytes) {
    return hasDb ? null : { ok: false, error: 'Ce manifest.json est trop gros pour être importé.' };
  }

  let json: unknown;
  try {
    const raw = readZipEntry(bytes, manifestPath);
    if (!raw) return null;
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return hasDb ? null : { ok: false, error: 'Le manifest.json de ce zip est illisible.' };
  }
  if (!isAssemblyManifest(json)) return null;
  return { ok: true, pkg: { bytes, sizes, folder: folderOf(manifestPath), manifest: json } };
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

/** Vérifie un fichier attendu : présent, pas trop lourd (annoncé puis réel), du bon type. */
function verify(pkg: AssemblyPackage, file: PackageFile): string | null {
  const declared = checkEntry(file, pkg.sizes.get(file.entry));
  if (declared) return declared;
  const bytes = readZipEntry(pkg.bytes, file.entry);
  if (!bytes) return `Fichier absent du zip : ${file.label}.`;
  return checkBytes(file, bytes);
}

/** Importe un paquet ouvert par openAssemblyPackage. */
export async function importAssemblyPackage(pkg: AssemblyPackage, deps: AssemblyDeps): Promise<AssemblyOutcome> {
  // 1. Manifeste.
  const parsed = parseAssemblyManifest(pkg.manifest);
  if (!parsed.ok) return parsed;
  const { manifest } = parsed;
  const plan = uploadPlan(manifest, deps.userId, pkg.folder);

  let batches: AssemblyBatch[];
  try {
    batches = buildAssemblyBatches(toAssemblyPayloads(manifest, deps.userId));
  } catch (error) {
    if (error instanceof ManifestError) return { ok: false, error: error.message };
    throw error;
  }

  // 2. Tous les fichiers, avant le moindre envoi. Les octets ne sont pas gardés : un paquet de
  // 300 photos ne tiendrait pas en mémoire sur un téléphone ; ils sont relus au moment de l'envoi.
  deps.onProgress?.({ step: 'check' });
  for (const file of planFiles(plan)) {
    const problem = verify(pkg, file);
    if (problem) return { ok: false, error: problem };
  }

  // 3. Envois. Chemins fixes et upsert : rejouer l'import remplace les mêmes fichiers.
  let failed = 0;
  async function send(file: PackageFile): Promise<boolean> {
    const bytes = readZipEntry(pkg.bytes, file.entry);
    const sent = bytes ? await deps.upload(file.path, bytes, file.contentType).catch(() => false) : false;
    if (!sent) failed++;
    return sent;
  }

  let photosDone = 0;
  deps.onProgress?.({ step: 'photos', done: 0, total: plan.photos.length });
  await pool(plan.photos, UPLOAD_CONCURRENCY, async (photo) => {
    for (const file of photo.files) await send(file);
    photosDone++;
    deps.onProgress?.({ step: 'photos', done: photosDone, total: plan.photos.length });
  });

  if (plan.sleeves.length > 0) {
    let sleevesDone = 0;
    deps.onProgress?.({ step: 'sleeves', done: 0, total: plan.sleeves.length });
    await pool(plan.sleeves, UPLOAD_CONCURRENCY, async (file) => {
      await send(file);
      sleevesDone++;
      deps.onProgress?.({ step: 'sleeves', done: sleevesDone, total: plan.sleeves.length });
    });
  }

  // Une fiche ne doit jamais pointer vers un fichier absent : on s'arrête avant d'enregistrer.
  if (failed > 0) {
    return {
      ok: false,
      error: `${plural(failed, "fichier n'a pas pu être envoyé", "fichiers n'ont pas pu être envoyés")}. Vérifie la connexion et réessaie : l'import reprend sans doublon.`,
    };
  }

  // 4. Fiches, envoi par envoi.
  const counts: AssemblyCounts = { created: 0, updated: 0 };
  const replaced = new Set<string>();
  for (const [index, batch] of batches.entries()) {
    deps.onProgress?.({ step: 'save', done: index, total: batches.length });
    const result = await deps.send(batch);
    // Un envoi refusé : on ne supprime rien. Les pièces des envois suivants citent encore leurs
    // anciens fichiers en base, et le rejeu doit retrouver ceux du paquet (envoyés à l'étape 3).
    if (!result.ok) return result;
    counts.created += result.counts.created;
    counts.updated += result.counts.updated;
    for (const path of result.replaced) replaced.add(path);
  }
  // 5. Fichiers remplacés, seulement maintenant : un envoi peut citer une photo qu'un envoi
  // précédent a cessé de citer (deux pièces qui échangent leurs photos).
  if (replaced.size > 0) await deps.finish({ paths: [...replaced] }).catch(() => undefined);
  deps.onProgress?.({ step: 'save', done: batches.length, total: batches.length });

  const arms = plan.photos.filter((photo) => photo.arms).length;
  return { ok: true, counts, photos: plan.photos.length, arms, sleeves: plan.sleeves.length };
}

/** « 20 pièces importées : 15 créées, 5 mises à jour. » */
export function assemblySummary(outcome: Extract<AssemblyOutcome, { ok: true }>): string {
  const { created, updated } = outcome.counts;
  const total = plural(created + updated, 'pièce importée', 'pièces importées');
  return `${total} : ${plural(created, 'créée', 'créées')}, ${plural(updated, 'mise à jour', 'mises à jour')}.`;
}

/** « 20 photos envoyées, 3 images de manches. », « 20 photos envoyées (16 avec les bras pliés). » */
export function assemblyDetail(outcome: Extract<AssemblyOutcome, { ok: true }>): string {
  const sent = plural(outcome.photos, 'photo envoyée', 'photos envoyées');
  const photos = outcome.arms > 0 ? `${sent} (${outcome.arms} avec les bras pliés)` : sent;
  if (outcome.sleeves === 0) return `${photos}.`;
  return `${photos}, ${plural(outcome.sleeves, 'image de manches', 'images de manches')}.`;
}
