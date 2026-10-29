import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ownPathOrNull } from './own-path';
import { DISPLAY_URL_SECONDS, signedUrls, type Bucket } from './storage';

// URL signées d'affichage du téléphone (grille, fiche, Demain), stables par chemin : une URL déjà
// signée est resservie telle quelle, et le navigateur garde l'image en cache (Storage répond avec
// Cache-Control 1 h) au lieu de la retélécharger à chaque rendu (« Au sale », retour sur la grille).
// Cache en mémoire du serveur, jamais envoyé au navigateur. Seul un chemin rangé sous
// `<userId>/` y entre et en sort (ownPathOrNull) : aucune URL ne passe d'un compte à un autre.
// Le miroir garde signedUrls (lib/mirror/server.ts), qui signe à chaque lecture.

/**
 * Une URL n'est resservie que pendant la première moitié de sa vie : chaque URL envoyée reste
 * valable au moins 30 min, le temps qu'une vignette chargée en différé (loading="lazy") s'affiche.
 */
export const REUSE_SECONDS = DISPLAY_URL_SECONDS / 2;

type Entry = { url: string; reuseUntil: number };

const cache = new Map<string, Entry>();

function keyOf(bucket: Bucket, path: string): string {
  return `${bucket}:${path}`;
}

/** Retire les URL qui ne doivent plus être resservies (le cache ne grossit pas sans fin). */
function dropExpired(now: number) {
  for (const [key, entry] of cache) if (entry.reuseUntil <= now) cache.delete(key);
}

/**
 * URL signées des fichiers du compte : chemin → URL. Les chemins absents ou hors de son
 * dossier sont ignorés ; seuls les chemins sans URL en cours sont signés, en un seul appel.
 */
export async function displayUrls(
  supabase: SupabaseClient,
  userId: string,
  bucket: Bucket,
  paths: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const now = Date.now();
  dropExpired(now);

  const own = [...new Set(paths.map((path) => ownPathOrNull(userId, path)))].filter(
    (path): path is string => path !== null,
  );
  const urls = new Map<string, string>();
  const missing: string[] = [];
  for (const path of own) {
    const entry = cache.get(keyOf(bucket, path));
    if (entry) urls.set(path, entry.url);
    else missing.push(path);
  }
  if (missing.length === 0) return urls;

  // Une erreur remonte à l'appelant, sans rien garder en cache.
  const signed = await signedUrls(supabase, bucket, missing, DISPLAY_URL_SECONDS);
  const reuseUntil = now + REUSE_SECONDS * 1000;
  for (const path of missing) {
    const url = signed.get(path);
    if (!url) continue;
    cache.set(keyOf(bucket, path), { url, reuseUntil });
    urls.set(path, url);
  }
  return urls;
}

/**
 * Oublie les URL des fichiers du compte : après un import qui réécrit des fichiers aux
 * mêmes chemins, une nouvelle URL force le navigateur à recharger l'image. Sans `userId`, vide tout.
 */
export function forgetDisplayUrls(userId?: string) {
  if (userId === undefined) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    const path = key.slice(key.indexOf(':') + 1);
    if (path.startsWith(`${userId}/`)) cache.delete(key);
  }
}
