import { prerenderSilhouettes } from '@/components/assembly/silhouette-store';
import { outfitImageUrls, outfitSilhouettes } from '@/lib/mirror/deck';
import type { MirrorItem, Outfit } from '@/lib/types';

// Préchargement (docs/conception.md §7 bis) : défiler n'affiche que ce qui est déjà en mémoire. Les objets Image
// restent référencés tant que leur URL sert, pour garder l'image décodée ; les silhouettes
// assemblées sont dessinées d'avance, hors écran (components/assembly/silhouette-store).

const images = new Map<string, HTMLImageElement>();
/** Images en échec (coupure du Wi-Fi, erreur passagère) : redemandées après RETRY_FAILED_MS. */
const failedAt = new Map<string, number>();
export const RETRY_FAILED_MS = 30_000;

function imageFor(url: string): HTMLImageElement {
  let image = images.get(url);
  const failed = failedAt.get(url);
  // Un élément img ne relance jamais seul un chargement raté : on en crée un neuf.
  if (image && failed !== undefined && Date.now() - failed > RETRY_FAILED_MS) {
    failedAt.delete(url);
    image = undefined;
  }
  if (!image) {
    image = new Image();
    image.decoding = 'async';
    image.src = url;
    images.set(url, image);
  }
  return image;
}

function markFailed(url: string, image: HTMLImageElement) {
  if (images.get(url) === image && !failedAt.has(url)) failedAt.set(url, Date.now());
}

function decodeOne(url: string): Promise<void> {
  // Une image introuvable ne bloque rien : la pièce s'affichera par son nom.
  const image = imageFor(url);
  return image.decode().catch(() => markFailed(url, image));
}

/** L'image décodée de cette URL (la même que celle du préchargement) ; rejette si elle est introuvable. */
export async function decodedImage(url: string): Promise<HTMLImageElement> {
  const image = imageFor(url);
  try {
    await image.decode();
  } catch (error) {
    markFailed(url, image);
    throw error;
  }
  return image;
}

function withTimeout(work: Promise<unknown>, timeoutMs: number): Promise<void> {
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  return Promise.race([work.then(() => undefined), timeout]);
}

/** Téléchargements simultanés du préchargement en arrière-plan : les premières URL passent d'abord. */
const BACKGROUND_CONCURRENCY = 4;
/** Chaque nouveau préchargement en arrière-plan arrête le précédent (ses URL ne servent plus). */
let backgroundRun = 0;

/**
 * Charge et décode ces images en arrière-plan, dans l'ordre donné (les plus proches de la tenue
 * affichée d'abord), quelques-unes à la fois pour laisser passer celles qu'on demande ailleurs
 * (preloadOutfits). N'attend pas plus de `timeoutMs`. Un nouvel appel arrête celui-ci.
 */
export function preloadImages(urls: readonly string[], timeoutMs: number): Promise<void> {
  const run = ++backgroundRun;
  if (urls.length === 0) return Promise.resolve();
  let next = 0;
  const worker = async () => {
    while (run === backgroundRun && next < urls.length) await decodeOne(urls[next++]);
  };
  const workers = Array.from({ length: Math.min(BACKGROUND_CONCURRENCY, urls.length) }, worker);
  return withTimeout(Promise.all(workers), timeoutMs);
}

/**
 * Prépare ces tenues : détourages et manches chargés et décodés, silhouettes assemblées dessinées
 * hors écran. N'attend pas plus de `timeoutMs` ; ce qui n'est pas prêt continue en arrière-plan.
 */
export function preloadOutfits(outfits: readonly Outfit[], items: readonly MirrorItem[], timeoutMs: number): Promise<void> {
  const urls = outfitImageUrls(outfits, items);
  const sources = outfitSilhouettes(outfits, items);
  if (urls.length === 0 && sources.length === 0) return Promise.resolve();
  return withTimeout(Promise.all([...urls.map(decodeOne), prerenderSilhouettes(sources, decodedImage)]), timeoutMs);
}

/** Oublie les images qui ne servent plus (les URL signées changent à chaque lecture). */
export function retainImages(urls: readonly string[]) {
  const keep = new Set(urls);
  for (const url of images.keys()) {
    if (!keep.has(url)) images.delete(url);
  }
  for (const url of failedAt.keys()) {
    if (!keep.has(url)) failedAt.delete(url);
  }
}
