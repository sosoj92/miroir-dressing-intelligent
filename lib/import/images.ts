// Images de l'import (docs/conception.md §3.1) : type détecté par les octets, jamais par le nom du fichier,
// et chemins Storage fixes pour que l'import soit rejouable (upsert sur le même chemin).

export type ImageKind =
  | { ext: 'jpg'; contentType: 'image/jpeg' }
  | { ext: 'png'; contentType: 'image/png' }
  | { ext: 'webp'; contentType: 'image/webp' };

/** Limite du bucket `items` (supabase/migrations : file_size_limit). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

/** JPEG, PNG ou WebP d'après les octets magiques ; null pour tout le reste (SVG, GIF, HEIC…). */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ext: 'jpg', contentType: 'image/jpeg' };
  if (startsWith(bytes, PNG_SIGNATURE)) return { ext: 'png', contentType: 'image/png' };
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

export type ImageCheck = { ok: true; kind: ImageKind } | { ok: false; reason: 'type' | 'size' };

/** Photo portée : JPEG, PNG ou WebP. */
export function checkPhoto(bytes: Uint8Array): ImageCheck {
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'size' };
  const kind = sniffImage(bytes);
  return kind ? { ok: true, kind } : { ok: false, reason: 'type' };
}

/** Détourage : PNG seulement, pour la transparence. */
export function checkCutout(bytes: Uint8Array): ImageCheck {
  const check = checkPhoto(bytes);
  if (check.ok && check.kind.ext !== 'png') return { ok: false, reason: 'type' };
  return check;
}

export type PhotoExt = ImageKind['ext'];
export const PHOTO_EXTS: readonly PhotoExt[] = ['jpg', 'png', 'webp'];

/** `<userId>/import/<legacy_id>-photo.<ext>` dans le bucket `items`. */
export function importPhotoPath(userId: string, legacyId: string, ext: PhotoExt): string {
  return `${userId}/import/${legacyId}-photo.${ext}`;
}

/** `<userId>/import/<legacy_id>-cutout.png` dans le bucket `items`. */
export function importCutoutPath(userId: string, legacyId: string): string {
  return `${userId}/import/${legacyId}-cutout.png`;
}
