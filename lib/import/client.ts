import { DEFAULT_TIME_ZONE, isoDateInTimeZone } from '@/lib/dates';
import {
  addCounts,
  buildBatches,
  EMPTY_COUNTS,
  ImportTooLargeError,
  toItemPayload,
  type ImportActionResult,
  type ImportBatch,
  type ImportCounts,
} from './batches';
import {
  MAX_IMAGE_BYTES,
  checkCutout,
  checkPhoto,
  importCutoutPath,
  importPhotoPath,
  type ImageCheck,
} from './images';
import { mapPrototype, parsePrototypeDb, prototypeTimeZone, type ImportItem } from './prototype';
import { findDbJson, findPhotoEntry, folderOf, listZipEntries, readZipEntry, type ZipEntry } from './zip';

// Déroulé de l'import dans le navigateur (docs/conception.md §3.1), sans dépendance au DOM ni à Supabase :
// le composant fournit l'envoi d'une image dans Storage et l'appel de la server action.
// 1. lire db.json (dans le zip, ou seul) ; 2. convertir ; 3. envoyer chaque image autorisée
// directement dans Storage ; 4. envoyer les fiches et les chemins, par envois de moins de 900 Ko.
// Aucun appel à Bria ni à Claude pendant l'import.

/** db.json seul : au-delà, ce n'est pas le fichier du prototype. */
export const MAX_JSON_BYTES = 20 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 3;

export type ImportProgress =
  | { step: 'read' }
  | { step: 'photos'; done: number; total: number }
  | { step: 'save'; done: number; total: number };

export type ImportDeps = {
  userId: string;
  now: Date;
  /** Envoie une image dans le bucket `items` (upsert). Renvoie false si l'envoi a échoué. */
  upload: (path: string, bytes: Uint8Array, contentType: string) => Promise<boolean>;
  /** Appelle la server action importPrototype. */
  send: (batch: ImportBatch) => Promise<ImportActionResult>;
  onProgress?: (progress: ImportProgress) => void;
};

export type ImportOutcome =
  | {
      ok: true;
      counts: ImportCounts;
      /** Fiches illisibles écartées. */
      ignored: number;
      /** Images refusées (SVG, GIF, trop lourdes, détourage non PNG) ou absentes du zip. */
      skippedImages: number;
      /** Images autorisées dont l'envoi a échoué. */
      failedUploads: number;
    }
  | { ok: false; error: string };

export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))
  );
}

/** Exécute `task` sur chaque valeur, `size` à la fois au plus. */
export async function pool<T>(values: T[], size: number, task: (value: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, values.length) }, async () => {
    while (next < values.length) {
      const value = values[next++];
      await task(value);
    }
  });
  await Promise.all(workers);
}

type Paths = { photo_path?: string; cutout_path?: string };

/** Importe le contenu d'un fichier choisi sur l'écran d'import (zip du dossier Dressing/ ou db.json). */
export async function importPrototypeFile(bytes: Uint8Array, deps: ImportDeps): Promise<ImportOutcome> {
  deps.onProgress?.({ step: 'read' });

  // 1. db.json
  let text: string;
  let zip: { names: string[]; sizes: Map<string, number>; folder: string } | null = null;
  if (isZip(bytes)) {
    let entries: ZipEntry[];
    try {
      entries = listZipEntries(bytes);
    } catch {
      return { ok: false, error: 'Ce zip est illisible.' };
    }
    const names = entries.map((entry) => entry.name);
    // Taille décompressée annoncée par le zip : une entrée trop grosse (zip bomb, dossier abîmé)
    // est refusée avant d'être décompressée en mémoire. Le contrôle après lecture reste en place.
    const sizes = new Map(entries.map((entry) => [entry.name, entry.size]));
    const dbPath = findDbJson(names);
    if (dbPath && (sizes.get(dbPath) ?? 0) > MAX_JSON_BYTES) {
      return { ok: false, error: 'Ce db.json est trop gros pour être importé.' };
    }
    const dbBytes = dbPath ? readZipEntry(bytes, dbPath) : null;
    if (!dbPath || !dbBytes) return { ok: false, error: 'Aucun db.json dans ce zip.' };
    if (dbBytes.length > MAX_JSON_BYTES) return { ok: false, error: 'Ce db.json est trop gros pour être importé.' };
    text = new TextDecoder().decode(dbBytes);
    zip = { names, sizes, folder: folderOf(dbPath) };
  } else {
    if (bytes.length > MAX_JSON_BYTES) return { ok: false, error: 'Ce db.json est trop gros pour être importé.' };
    text = new TextDecoder().decode(bytes);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Ce fichier n’est ni un zip ni un db.json lisible.' };
  }

  // 2. Conversion. Les plans à venir se comptent dans le fuseau du prototype (le serveur revérifie).
  const parsed = parsePrototypeDb(json);
  if (!parsed.ok) return parsed;
  const today = isoDateInTimeZone(deps.now, prototypeTimeZone(parsed.db, DEFAULT_TIME_ZONE));
  const data = mapPrototype(parsed.db, { today });
  if (data.items.length === 0) return { ok: false, error: 'Aucune pièce à importer dans ce db.json.' };

  // 3. Images, directement dans Storage. Refusée ou absente : la fiche est importée sans elle.
  const paths = new Map<string, Paths>();
  let skippedImages = 0;
  let failedUploads = 0;
  if (zip) {
    const { names, sizes, folder } = zip;
    const readImage = (fileName: string | null, check: (bytes: Uint8Array) => ImageCheck) => {
      if (!fileName) return null;
      const entry = findPhotoEntry(names, folder, fileName);
      // Trop lourde d'après le zip : comptée comme refusée, sans être décompressée.
      if (entry && (sizes.get(entry) ?? 0) > MAX_IMAGE_BYTES) {
        skippedImages++;
        return null;
      }
      const image = entry ? readZipEntry(bytes, entry) : null;
      if (!image) {
        skippedImages++;
        return null;
      }
      const result = check(image);
      if (!result.ok) {
        skippedImages++;
        return null;
      }
      return { image, kind: result.kind };
    };

    const withImages = data.items.filter((item) => item.photo_file || item.cutout_file);
    let done = 0;
    deps.onProgress?.({ step: 'photos', done, total: withImages.length });
    await pool(withImages, UPLOAD_CONCURRENCY, async (item: ImportItem) => {
      const itemPaths: Paths = {};
      const photo = readImage(item.photo_file, checkPhoto);
      if (photo) {
        const path = importPhotoPath(deps.userId, item.legacy_id, photo.kind.ext);
        if (await deps.upload(path, photo.image, photo.kind.contentType)) itemPaths.photo_path = path;
        else failedUploads++;
      }
      const cutout = readImage(item.cutout_file, checkCutout);
      if (cutout) {
        const path = importCutoutPath(deps.userId, item.legacy_id);
        if (await deps.upload(path, cutout.image, cutout.kind.contentType)) itemPaths.cutout_path = path;
        else failedUploads++;
      }
      paths.set(item.legacy_id, itemPaths);
      done++;
      deps.onProgress?.({ step: 'photos', done, total: withImages.length });
    });
  }

  // 4. Fiches et chemins, envoi par envoi (les pièces d'abord : l'historique les retrouve en base).
  let batches: ImportBatch[];
  try {
    batches = buildBatches({
      items: data.items.map((item) => toItemPayload(item, paths.get(item.legacy_id) ?? {})),
      history: data.history,
      refusals: data.refusals,
      plans: data.plans,
      city: data.city,
    });
  } catch (error) {
    if (error instanceof ImportTooLargeError) return { ok: false, error: 'Une fiche est trop grosse pour être importée.' };
    throw error;
  }

  let counts = EMPTY_COUNTS;
  for (const [index, batch] of batches.entries()) {
    deps.onProgress?.({ step: 'save', done: index, total: batches.length });
    const result = await deps.send(batch);
    if (!result.ok) return result;
    counts = addCounts(counts, result.counts);
  }
  deps.onProgress?.({ step: 'save', done: batches.length, total: batches.length });

  return { ok: true, counts, ignored: parsed.ignored, skippedImages, failedUploads };
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

/** « 9 pièces importées, 9 photos à refaire. » */
export function summaryLine(counts: ImportCounts): string {
  const pieces = plural(counts.items, 'pièce importée', 'pièces importées');
  if (counts.withoutCutout === 0) return `${pieces}.`;
  return `${pieces}, ${plural(counts.withoutCutout, 'photo à refaire', 'photos à refaire')}.`;
}

/** « 10 jours d'historique, 1 refus, ville : Paris. » (vide s'il n'y a rien d'autre) */
export function detailLine(outcome: Extract<ImportOutcome, { ok: true }>): string {
  const { counts } = outcome;
  const parts: string[] = [];
  if (counts.history > 0) parts.push(plural(counts.history, "jour d'historique", "jours d'historique"));
  if (counts.refusals > 0) parts.push(plural(counts.refusals, 'refus', 'refus'));
  if (counts.plans > 0) parts.push(plural(counts.plans, 'tenue prévue', 'tenues prévues'));
  if (counts.city) parts.push(`ville : ${counts.city}`);
  if (outcome.failedUploads > 0) {
    parts.push(plural(outcome.failedUploads, 'image non envoyée', 'images non envoyées'));
  }
  if (outcome.ignored > 0) parts.push(plural(outcome.ignored, 'fiche illisible ignorée', 'fiches illisibles ignorées'));
  if (parts.length === 0) return '';
  const line = parts.join(', ');
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}
