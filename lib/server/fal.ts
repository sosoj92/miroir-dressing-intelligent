import 'server-only';
import { falKey } from './env';

// Appels à fal.ai, côté serveur uniquement (AGENTS.md). Réutilisé en phase 5 pour FASHN.
// Règles du docs/conception.md §7 et §9 :
// - l'image d'entrée est une URL signée Supabase de 10 min, jamais un envoi par fal.storage ;
// - `X-Fal-Store-IO: 0` (sinon fal.ai garde les requêtes 90 jours) et une expiration d'1 h pour
//   les images produites : le serveur doit donc copier le résultat dans le bucket privé tout de suite.
// Rien n'est journalisé ici : ni la clé, ni les URL (l'URL signée contient un jeton).

/** Détourage Bria RMBG 2.0 (docs/conception.md §4, §11, 5). Endpoint synchrone. */
export const FAL_BRIA_ENDPOINT = 'https://fal.run/fal-ai/bria/background/remove';
/** Prix d'un détourage, en dollars, tel que facturé par fal.ai. */
export const BRIA_COST_USD = 0.018;

/** Durée de vie des images produites sur le CDN de fal.ai (docs/conception.md §7). */
export const FAL_OUTPUT_LIFETIME_SECONDS = 3600;
/** Délai maximal d'un appel au modèle. */
export const FAL_REQUEST_TIMEOUT_MS = 45_000;
/** Délai maximal du téléchargement de l'image produite. */
export const FAL_DOWNLOAD_TIMEOUT_MS = 20_000;
/** Taille maximale d'une image produite (limite du bucket `items`). */
export const FAL_MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
/** Types acceptés par les buckets privés. */
export const FAL_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** En-têtes de chaque appel à fal.ai. Lève EnvError si FAL_KEY est absente. */
export function falHeaders(): Record<string, string> {
  return {
    Authorization: `Key ${falKey()}`,
    'Content-Type': 'application/json',
    'X-Fal-Store-IO': '0',
    'X-Fal-Object-Lifecycle-Preference': JSON.stringify({ expiration_duration_seconds: FAL_OUTPUT_LIFETIME_SECONDS }),
  };
}

export type FalErrorReason = 'requete' | 'reponse' | 'telechargement' | 'delai';

const FAL_ERROR_MESSAGES: Record<FalErrorReason, string> = {
  requete: 'fal.ai a refusé la demande',
  reponse: 'Réponse inattendue de fal.ai',
  telechargement: "L'image produite par fal.ai n'a pas pu être récupérée",
  delai: 'fal.ai a mis trop de temps à répondre',
};

/** Erreur d'un appel à fal.ai. Le message ne contient ni URL, ni clé, ni corps de réponse. */
export class FalError extends Error {
  readonly reason: FalErrorReason;
  readonly status: number | null;

  constructor(reason: FalErrorReason, status: number | null = null) {
    super(status === null ? `${FAL_ERROR_MESSAGES[reason]}.` : `${FAL_ERROR_MESSAGES[reason]} (HTTP ${status}).`);
    this.name = 'FalError';
    this.reason = reason;
    this.status = status;
  }
}

export type FalImage = { data: ArrayBuffer; contentType: string };

export type FalCallOptions = {
  /** Appelée dès que fal.ai a facturé l'appel, même si le téléchargement échoue ensuite. */
  onCost?: (costUsd: number) => unknown;
};

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Rien à faire : la connexion sera fermée de toute façon.
  }
}

/** URL de l'image produite : `image.url` (format documenté), ou `images[0].url`. */
export function readFalImageUrl(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const { image, images } = body as { image?: unknown; images?: unknown };
  const candidate =
    (image && typeof image === 'object' ? (image as { url?: unknown }).url : undefined) ??
    (Array.isArray(images) && images[0] && typeof images[0] === 'object'
      ? (images[0] as { url?: unknown }).url
      : undefined);
  if (typeof candidate !== 'string') return null;
  try {
    return new URL(candidate).protocol === 'https:' ? candidate : null;
  } catch {
    return null;
  }
}

/** POST JSON vers un modèle fal.ai (endpoint synchrone fal.run). */
export async function callFal(endpoint: string, input: Record<string, unknown>): Promise<unknown> {
  const headers = falHeaders(); // EnvError avant tout appel réseau si la clé manque
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(FAL_REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!response.ok) {
      await discardBody(response); // le corps n'est ni lu ni journalisé (il peut citer l'URL signée)
      throw new FalError('requete', response.status);
    }
    try {
      return await response.json();
    } catch (error) {
      if (isTimeout(error)) throw new FalError('delai');
      throw new FalError('reponse');
    }
  } catch (error) {
    if (error instanceof FalError) throw error;
    if (isTimeout(error)) throw new FalError('delai');
    throw new FalError('requete');
  }
}

/**
 * Télécharge une image produite par fal.ai (sans la clé : c'est un autre hôte). Refuse ce qui
 * n'est pas une image PNG, JPEG ou WebP, ou dépasse la taille d'un fichier du bucket.
 */
export async function downloadFalImage(url: string): Promise<FalImage> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FAL_DOWNLOAD_TIMEOUT_MS), cache: 'no-store' });
    if (!response.ok) {
      await discardBody(response);
      throw new FalError('telechargement', response.status);
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const declared = Number(response.headers.get('content-length'));
    if (
      !(FAL_IMAGE_TYPES as readonly string[]).includes(contentType) ||
      (Number.isFinite(declared) && declared > FAL_MAX_DOWNLOAD_BYTES)
    ) {
      await discardBody(response);
      throw new FalError('telechargement');
    }

    const data = await response.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > FAL_MAX_DOWNLOAD_BYTES) throw new FalError('telechargement');
    return { data, contentType };
  } catch (error) {
    if (error instanceof FalError) throw error;
    if (isTimeout(error)) throw new FalError('delai');
    throw new FalError('telechargement');
  }
}

/**
 * Détourage d'une photo à plat (Bria) : renvoie le PNG transparent, à copier aussitôt dans le
 * bucket privé (fal.ai l'efface au bout d'1 h).
 */
export async function removeBackground(imageUrl: string, options: FalCallOptions = {}): Promise<FalImage> {
  const body = await callFal(FAL_BRIA_ENDPOINT, { image_url: imageUrl });
  const resultUrl = readFalImageUrl(body);
  if (!resultUrl) throw new FalError('reponse');

  try {
    await options.onCost?.(BRIA_COST_USD);
  } catch {
    // Le suivi de la dépense ne doit pas faire échouer le détourage.
  }

  const image = await downloadFalImage(resultUrl);
  if (image.contentType !== 'image/png') throw new FalError('reponse'); // un détourage est un PNG transparent
  return image;
}
