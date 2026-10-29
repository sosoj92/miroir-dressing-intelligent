import { createClient } from '@/lib/supabase/browser';
import { SupabaseNotConfiguredError } from '@/lib/supabase/config';
import { cutoutPathFor, newUuid, photoPathFor } from '@/lib/items/paths';
import { isTransparentCutout, pngMayHaveAlpha } from './png-alpha';
import { PhotoReadError, reducePhoto } from './resize';

// Envoi d'une photo de vêtement depuis le téléphone (docs/conception.md §4, écran 3, étape 1) : réduite dans le
// navigateur, puis envoyée directement dans le bucket privé `items` avec la session du compte
// (RLS). Le serveur ne reçoit ensuite que les chemins.
// Une photo PNG déjà détourée (fond transparent) part en plus sous le nom d'un détourage
// (`<userId>/<uuid>-cutout.png`) : le serveur la revérifie et s'en sert sans appeler fal.ai.

export type UploadStep = 'reduction' | 'envoi';

export type UploadedPhoto = {
  /** Photo réduite en JPEG : `<userId>/<uuid>.jpg` (fiche automatique, « Relancer le détourage »). */
  photoPath: string;
  /** PNG transparent envoyé comme détourage, ou null (photo opaque : détourage par fal.ai). */
  cutoutPath: string | null;
};

export class PhotoUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoUploadError';
  }
}

/** Début du fichier lu pour l'en-tête PNG : IHDR est en tête, tRNS avant les données. */
const HEADER_BYTES = 256 * 1024;

/** Vrai si l'en-tête du fichier est celui d'un PNG qui peut avoir de la transparence. */
async function mayBeCutout(file: Blob): Promise<boolean> {
  try {
    return pngMayHaveAlpha(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()));
  } catch {
    return false;
  }
}

/** Le PNG réduit, s'il a des pixels vraiment transparents ; sinon null. */
async function transparentPng(png: Blob | null): Promise<Blob | null> {
  if (!png) return null;
  try {
    return isTransparentCutout(new Uint8Array(await png.arrayBuffer())) ? png : null;
  } catch {
    return null;
  }
}

/**
 * Réduit la photo, l'envoie sous `<userId>/<uuid>.jpg`, et, pour un PNG déjà détouré, envoie aussi
 * le PNG réduit comme détourage. Un échec de ce second envoi n'arrête rien : le serveur détourera
 * la photo comme une autre.
 */
export async function uploadItemPhoto(
  file: Blob,
  userId: string,
  onStep?: (step: UploadStep) => void,
): Promise<UploadedPhoto> {
  onStep?.('reduction');
  const { jpeg, png } = await reducePhoto(file, await mayBeCutout(file));
  const cutout = await transparentPng(png);

  onStep?.('envoi');
  const photoPath = photoPathFor(userId, newUuid());
  const supabase = createClient();
  const bucket = supabase.storage.from('items');
  const { error } = await bucket.upload(photoPath, jpeg, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new PhotoUploadError("La photo n'a pas pu être envoyée. Vérifie ta connexion et réessaie.");

  let cutoutPath: string | null = null;
  if (cutout) {
    const path = cutoutPathFor(userId, newUuid());
    try {
      const sent = await bucket.upload(path, cutout, { contentType: 'image/png', upsert: false });
      if (!sent.error) cutoutPath = path;
    } catch {
      // Rien à faire : la photo JPEG est envoyée, le serveur la détourera.
    }
  }
  return { photoPath, cutoutPath };
}

/** Message à afficher pour une erreur de `uploadItemPhoto`. */
export function uploadErrorMessage(error: unknown): string {
  if (error instanceof PhotoReadError || error instanceof PhotoUploadError) return error.message;
  if (error instanceof SupabaseNotConfiguredError) return "L'envoi des photos n'est pas encore configuré.";
  return "La photo n'a pas pu être envoyée. Réessaie.";
}
