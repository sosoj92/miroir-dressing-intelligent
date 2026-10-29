import { unzipSync } from 'fflate';

// Lecture du dossier Dressing/ zippé, dans le navigateur (docs/conception.md §3.1). Les entrées sont lues une
// par une (filtre de fflate) : on ne garde jamais toutes les photos décompressées en mémoire.

export type ZipEntry = { name: string; size: number };

function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** Entrées parasites : métadonnées macOS (`__MACOSX/`, `._x`) et dossiers. */
function isNoise(path: string): boolean {
  if (path.endsWith('/')) return true;
  return segments(path).some((part) => part === '__MACOSX' || part.startsWith('._'));
}

function basename(path: string): string {
  const parts = segments(path);
  return parts[parts.length - 1] ?? '';
}

/** Liste les fichiers du zip (nom et taille décompressée) sans rien décompresser. */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = [];
  unzipSync(bytes, {
    filter(file) {
      if (!isNoise(file.name)) entries.push({ name: file.name, size: file.originalSize });
      return false;
    },
  });
  return entries;
}

/** Décompresse une seule entrée, ou null si elle n'existe pas. */
export function readZipEntry(bytes: Uint8Array, name: string): Uint8Array | null {
  const files = unzipSync(bytes, { filter: (file) => file.name === name });
  return files[name] ?? null;
}

function depth(path: string): number {
  return segments(path).length;
}

function byDepthThenName(a: string, b: string): number {
  return depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** `db.json` à la racine du zip ou dans un sous-dossier (le moins profond l'emporte). */
export function findDbJson(names: readonly string[]): string | null {
  const candidates = names.filter((name) => !isNoise(name) && basename(name) === 'db.json');
  return candidates.sort(byDepthThenName)[0] ?? null;
}

/** Dossier qui contient db.json, avec la barre finale (« Dressing/ » ou « »). */
export function folderOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index + 1);
}

/**
 * Retrouve une image par son nom de fichier sous un dossier `photos/` : d'abord celui qui est à
 * côté de db.json, sinon n'importe quel `photos/` du zip (jamais `trash/` ni `drafts/`).
 */
export function findPhotoEntry(names: readonly string[], dbFolder: string, fileName: string): string | null {
  if (!fileName || fileName.includes('/')) return null;
  const preferred = `${dbFolder}photos/${fileName}`;
  if (names.includes(preferred)) return preferred;
  const candidates = names.filter((name) => {
    if (isNoise(name)) return false;
    const parts = segments(name);
    return parts.length >= 2 && parts[parts.length - 1] === fileName && parts[parts.length - 2] === 'photos';
  });
  return candidates.sort(byDepthThenName)[0] ?? null;
}
