// Réduction de la photo dans le navigateur avant l'envoi (docs/conception.md §4, écran 3) : 1600 px de côté au
// plus, JPEG qualité 0,85. Aucune requête vers Vercel ne porte l'image (limite de 4,5 Mo), et la
// Claude API refuse les images de plus de 5 Mo. Pour une photo PNG déjà détourée, la même réduction
// donne aussi un PNG qui garde la transparence (le JPEG, lui, est posé sur fond blanc).

export const MAX_PHOTO_SIDE = 1600;
export const JPEG_QUALITY = 0.85;

export type Size = { width: number; height: number };

/**
 * Dimensions qui tiennent dans un carré de `max` px, proportions gardées, jamais agrandies.
 * Le grand côté vaut exactement `max` quand l'image est réduite.
 */
export function fitWithin(width: number, height: number, max: number = MAX_PHOTO_SIDE): Size {
  if (![width, height, max].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Dimensions invalides.');
  }
  const long = Math.max(width, height);
  if (long <= max) return { width: Math.round(width), height: Math.round(height) };

  const target = Math.floor(max);
  const short = Math.max(1, Math.round((Math.min(width, height) * target) / long));
  return width >= height ? { width: target, height: short } : { width: short, height: target };
}

/** La photo n'a pas pu être lue (format non pris en charge par le navigateur, fichier abîmé). */
export class PhotoReadError extends Error {
  constructor() {
    super('Cette photo ne peut pas être lue. Essaie une autre photo.');
    this.name = 'PhotoReadError';
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** La photo réduite, sur un fond de couleur, ou sur fond transparent (background null). */
function drawReduced(bitmap: ImageBitmap, max: number, background: string | null): HTMLCanvasElement {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new PhotoReadError();
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

export type ReducedPhoto = {
  /** Photo réduite en JPEG, sur fond blanc : un PNG transparent de la galerie ne devient pas noir. */
  jpeg: Blob;
  /** Même réduction en PNG, transparence gardée ; null si non demandé (ou si l'encodage échoue). */
  png: Blob | null;
};

/**
 * Photo réduite (navigateur seulement), décodée une seule fois. L'orientation EXIF est appliquée.
 * withPng : produit aussi le PNG transparent d'une photo déjà détourée.
 */
export async function reducePhoto(
  file: Blob,
  withPng: boolean,
  max: number = MAX_PHOTO_SIDE,
  quality: number = JPEG_QUALITY,
): Promise<ReducedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoReadError();
  }

  try {
    const jpeg = await canvasToBlob(drawReduced(bitmap, max, '#ffffff'), 'image/jpeg', quality);
    if (!jpeg) throw new PhotoReadError();
    // Un PNG qui ne s'encode pas n'empêche pas l'envoi : la photo suivra le chemin de fal.ai.
    const png = withPng ? await canvasToBlob(drawReduced(bitmap, max, null), 'image/png') : null;
    return { jpeg, png };
  } catch (error) {
    if (error instanceof PhotoReadError) throw error;
    throw new PhotoReadError();
  } finally {
    bitmap.close();
  }
}
