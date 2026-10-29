import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// Accès aux buckets privés (AGENTS.md, Données et vie privée) : chaque fichier est rangé sous
// <user_id>/…, et ne s'affiche que par URL signée à durée limitée.

export type Bucket = 'items' | 'profile' | 'tryon';

/** Durée des URL signées pour l'affichage sur la tablette ou le téléphone (docs/conception.md §8). */
export const DISPLAY_URL_SECONDS = 3600;
/** Durée des URL signées envoyées à fal.ai ou à la Claude API (docs/conception.md §7, §9). */
export const EXTERNAL_URL_SECONDS = 600;

export class StoragePathError extends Error {
  constructor() {
    super('Chemin de fichier refusé.');
    this.name = 'StoragePathError';
  }
}

const SAFE_PATH = /^[A-Za-z0-9._\-/]+$/;

/**
 * Vérifie qu'un chemin reçu du navigateur appartient bien au compte : il commence par
 * `<userId>/`, sans segment vide, « . » ni « .. ». Renvoie le chemin, ou lève StoragePathError.
 */
export function assertOwnPath(userId: string, path: string): string {
  const parts = path.split('/');
  const valid =
    SAFE_PATH.test(path) &&
    parts.length >= 2 &&
    parts[0] === userId &&
    parts.every((part) => part !== '' && part !== '.' && part !== '..');
  if (!valid) throw new StoragePathError();
  return path;
}

/** URL signées de plusieurs fichiers d'un bucket : chemin → URL. Les chemins absents sont ignorés. */
export async function signedUrls(
  supabase: SupabaseClient,
  bucket: Bucket,
  paths: Array<string | null | undefined>,
  expiresIn: number = DISPLAY_URL_SECONDS,
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  const urls = new Map<string, string>();
  if (unique.length === 0) return urls;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(unique, expiresIn);
  if (error) throw error;
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl && !entry.error) urls.set(entry.path, entry.signedUrl);
  }
  return urls;
}

/** URL signée d'un seul fichier. */
export async function signedUrl(
  supabase: SupabaseClient,
  bucket: Bucket,
  path: string,
  expiresIn: number = DISPLAY_URL_SECONDS,
): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) throw error ?? new Error('URL signée indisponible.');
  return data.signedUrl;
}
