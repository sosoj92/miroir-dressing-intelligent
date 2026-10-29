import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { armsLayers } from '@/lib/assembly/arms-files';
import { declaresArms, parseAssembly } from '@/lib/assembly/parse';
import { FILE_REF_COLUMNS, removeUnusedItemFiles } from '@/lib/items/cleanup';
import { itemFiles, type ItemFileRefs } from '@/lib/items/files';
import { assertOwnPath, StoragePathError } from '@/lib/server/storage';
import type { Assembly } from '@/lib/types';
import {
  ASSEMBLY_KEY_PATTERN,
  ASSEMBLY_LIMITS,
  ManifestError,
  assemblyArmsPath,
  assemblyCutoutPath,
  assemblyPhotoPath,
  assemblySleevesPath,
  readItemFields,
  type AssemblyCounts,
  type AssemblyItemPayload,
} from './assemblage';

// Côté serveur de l'import du paquet d'assemblage (docs/conception.md §3.2) : validation stricte de ce que le
// navigateur envoie (mêmes règles que le manifeste, chemins exacts attendus pour le compte),
// puis écriture rejouable, rangée par (owner, legacy_id). `dirty` et `created_at` ne sont jamais
// envoyés : une pièce déjà importée garde son état « au sale » et sa date d'ajout.

/** Taille des listes passées à `.in()` (elles partent dans l'URL de PostgREST). */
const LOOKUP_CHUNK = 100;
const MAX_PATH_LENGTH = 300;

export type AssemblyValidation = { ok: true; items: AssemblyItemPayload[] } | { ok: false; error: string };

function fail(message: string): never {
  throw new ManifestError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Chemin exact attendu, rangé sous `<userId>/` (assertOwnPath), sinon refus. */
function expectedPath(userId: string, value: unknown, expected: string, label: string): string {
  if (typeof value !== 'string' || value.length > MAX_PATH_LENGTH || value !== expected) fail(`${label} : chemin refusé.`);
  try {
    return assertOwnPath(userId, value);
  } catch (error) {
    if (error instanceof StoragePathError) fail(`${label} : chemin refusé.`);
    throw error;
  }
}

function readPayload(userId: string, value: unknown, index: number): AssemblyItemPayload {
  if (!isRecord(value)) fail(`Pièce n° ${index + 1} : fiche illisible.`);
  const legacyId = value.legacy_id;
  if (typeof legacyId !== 'string' || !ASSEMBLY_KEY_PATTERN.test(legacyId)) fail(`Pièce n° ${index + 1} : identifiant refusé.`);
  const label = `Pièce ${legacyId}`;
  const fields = readItemFields(value, label);

  const parsed = parseAssembly(value.assembly);
  if (!parsed) fail(`${label} : repères d'assemblage illisibles.`);
  const key = parsed.photo.key;
  // parseAssembly ignore des bras pliés illisibles (lecture de la base) : ici, on les refuse.
  if (declaresArms(isRecord(value.assembly) ? value.assembly.photo : undefined) && !parsed.photo.arms) {
    fail(`${label} : bras pliés illisibles.`);
  }

  const photo_path = expectedPath(userId, value.photo_path, assemblyPhotoPath(userId, key), label);
  const cutout_path = expectedPath(userId, value.cutout_path, assemblyCutoutPath(userId, key), label);
  const sleevesPath =
    parsed.sleevesPath === null
      ? null
      : expectedPath(userId, parsed.sleevesPath, assemblySleevesPath(userId, legacyId), label);
  // Couches des bras pliés : chemins fixes, dérivés de la clé de la photo, comme la photo détourée.
  for (const { name, layer } of armsLayers(parsed.photo)) {
    expectedPath(userId, layer.path, assemblyArmsPath(userId, key, name), label);
  }

  return {
    legacy_id: legacyId,
    ...fields,
    photo_path,
    cutout_path,
    assembly: { v: 1, photo: parsed.photo, sleevesPath },
  };
}

/** Valide un envoi d'import du paquet d'assemblage pour le compte `userId`. */
export function validateAssemblyBatch(input: unknown, userId: string): AssemblyValidation {
  try {
    if (!isRecord(input) || !Array.isArray(input.items)) fail("Données d'import invalides.");
    if (input.items.length === 0) fail('Aucune pièce à importer.');
    if (input.items.length > ASSEMBLY_LIMITS.items) fail(`Trop de pièces dans un envoi (${ASSEMBLY_LIMITS.items} au plus).`);
    const items = input.items.map((value, index) => readPayload(userId, value, index));
    const ids = new Set(items.map((item) => item.legacy_id));
    if (ids.size !== items.length) fail('Identifiant de pièce en double.');
    return { ok: true, items };
  } catch (error) {
    if (error instanceof ManifestError) return { ok: false, error: error.message };
    throw error;
  }
}

export type AssemblyRow = AssemblyItemPayload & { owner: string };

/**
 * Lignes upsert de `items`, toutes avec les mêmes colonnes (un upsert groupé met à jour l'union
 * des colonnes, voir groupByColumns dans server.ts). Les repères sont relus par parseAssembly
 * juste avant l'écriture : une structure incomplète n'atteint jamais la base.
 */
export function assemblyRows(userId: string, items: readonly AssemblyItemPayload[]): AssemblyRow[] {
  return items.map((item) => {
    const assembly: Assembly | null = parseAssembly(item.assembly);
    if (!assembly) throw new ManifestError(`Pièce ${item.legacy_id} : repères d'assemblage illisibles.`);
    return {
      owner: userId,
      legacy_id: item.legacy_id,
      name: item.name,
      category: item.category,
      color: item.color,
      warmth: item.warmth,
      styles: item.styles,
      rain_ok: item.rain_ok,
      photo_path: item.photo_path,
      cutout_path: item.cutout_path,
      assembly,
    };
  });
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

export type AssemblyImportResult = { counts: AssemblyCounts; replaced: string[] };

/**
 * Écrit un envoi validé : upsert sur (owner, legacy_id). Rejouer l'import met les fiches à jour
 * sans doublon. Renvoie le nombre de pièces créées et mises à jour, et les fichiers qu'une pièce
 * mise à jour ne cite plus (nouvelle photo, manches retirées, couches des bras pliés d'un paquet
 * plus récent absentes d'un paquet plus ancien, photo à plat remplacée par la photo portée).
 * Rien n'est supprimé ici : un envoi suivant du même import peut citer une photo que celui-ci a
 * cessé de citer (deux pièces qui échangent leurs photos). Le navigateur réunit les `replaced` de
 * tous les envois et les passe à removeReplacedFiles une fois le dernier écrit.
 */
export async function runAssemblyImport(
  supabase: SupabaseClient,
  userId: string,
  items: readonly AssemblyItemPayload[],
): Promise<AssemblyImportResult> {
  const rows = assemblyRows(userId, items);

  // Pièces déjà présentes, avec les fichiers qu'elles citent : elles seront mises à jour, les
  // autres créées.
  const existing = new Map<string, string[]>();
  for (const chunk of chunks(rows.map((row) => row.legacy_id), LOOKUP_CHUNK)) {
    const { data, error } = await supabase
      .from('items')
      .select(`legacy_id, ${FILE_REF_COLUMNS}`)
      .eq('owner', userId)
      .in('legacy_id', chunk);
    if (error) throw error;
    for (const row of (data ?? []) as Array<ItemFileRefs & { legacy_id: unknown }>) {
      if (typeof row.legacy_id === 'string') existing.set(row.legacy_id, itemFiles(row));
    }
  }

  const { data, error } = await supabase.from('items').upsert(rows, { onConflict: 'owner,legacy_id' }).select('legacy_id');
  if (error) throw error;

  const counts: AssemblyCounts = { created: 0, updated: 0 };
  for (const row of (data ?? []) as Array<{ legacy_id: unknown }>) {
    if (typeof row.legacy_id !== 'string') continue;
    if (existing.has(row.legacy_id)) counts.updated++;
    else counts.created++;
  }

  // Anciens fichiers des pièces mises à jour, sans doublon.
  const replaced = rows.flatMap((row) => {
    const current = new Set(itemFiles(row));
    return (existing.get(row.legacy_id) ?? []).filter((path) => !current.has(path));
  });
  return { counts, replaced: [...new Set(replaced)] };
}

/** Une pièce cite au plus 6 fichiers (itemFiles) : photo, détourage, manches, trois couches. */
const MAX_CLEANUP_PATHS = ASSEMBLY_LIMITS.items * 6;

/** Valide la fin d'un import : `{ paths }`, une liste bornée de chemins (filtrés ensuite par compte). */
export function validateAssemblyCleanup(input: unknown): { ok: true; paths: string[] } | { ok: false; error: string } {
  if (!isRecord(input) || !Array.isArray(input.paths)) return { ok: false, error: "Données d'import invalides." };
  const { paths } = input;
  if (paths.length > MAX_CLEANUP_PATHS || !paths.every((path) => typeof path === 'string')) {
    return { ok: false, error: "Données d'import invalides." };
  }
  return { ok: true, paths: paths as string[] };
}

/**
 * Fin de l'import, une fois tous les envois écrits : supprime de Storage ceux des fichiers
 * remplacés qu'aucune pièce ne cite plus. removeUnusedItemFiles ne garde que les chemins rangés
 * sous `<userId>/…` et relit la base : une photo partagée, ou citée par un envoi suivant, reste en
 * place. Un échec ici laisse au pire un fichier orphelin, sans faire échouer l'import.
 */
export async function removeReplacedFiles(supabase: SupabaseClient, userId: string, paths: readonly string[]): Promise<string[]> {
  return removeUnusedItemFiles(supabase, userId, paths);
}
