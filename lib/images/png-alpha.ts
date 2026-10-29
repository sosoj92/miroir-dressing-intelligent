import { unzlibSync } from 'fflate';

// Une photo PNG déjà détourée (fond transparent : « Copier le sujet » sur iPhone, « Effacer
// l'arrière-plan » sur Android) sert directement de détourage, sans fal.ai (docs/conception.md §4, écran 3).
// Module pur, utilisé par le navigateur (choisir le chemin) et par le serveur (revérifier le PNG
// reçu avant de l'enregistrer comme détourage). Aucune dépendance au canvas.
//
// Deux niveaux :
// - pngMayHaveAlpha lit seulement l'en-tête : un PNG qui PEUT avoir de la transparence (canal
//   alpha, ou bloc tRNS). Rapide, même sur une très grande photo ;
// - isTransparentCutout décode les pixels (zlib par fflate, puis filtres PNG) et exige des pixels
//   vraiment transparents : au moins MIN_TRANSPARENT_SHARE de pixels d'alpha nul, et au moins un
//   pixel opaque. Gère les PNG 8 ou 16 bits, gris + alpha ou RGBA, non entrelacés (ce que produit
//   le canvas du navigateur) ; tout autre PNG est traité comme opaque (chemin fal.ai).

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Part minimale de pixels entièrement transparents pour parler de détourage (1 %). */
export const MIN_TRANSPARENT_SHARE = 0.01;
/** Côté maximal décodé : bien plus que les 1600 px envoyés par le téléphone, borne la mémoire. */
export const MAX_DECODED_SIDE = 4096;

type Header = { width: number; height: number; bitDepth: number; colorType: number; interlace: number };

type Chunks = { header: Header; transparency: boolean; data: Uint8Array[] };

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function hasSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/**
 * Parcourt les blocs du PNG. `full` : jusqu'à IEND en gardant les données IDAT ; sinon on s'arrête
 * au premier IDAT (tRNS doit le précéder). null si ce n'est pas un PNG lisible.
 */
function readChunks(bytes: Uint8Array, full: boolean): Chunks | null {
  if (!hasSignature(bytes)) return null;
  let offset = 8;
  let header: Header | null = null;
  let transparency = false;
  const data: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = chunkType(bytes, offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) return full ? null : header ? { header, transparency, data } : null;
    if (type === 'IHDR') {
      if (length !== 13 || header) return null;
      header = {
        width: readUint32(bytes, start),
        height: readUint32(bytes, start + 4),
        bitDepth: bytes[start + 8],
        colorType: bytes[start + 9],
        interlace: bytes[start + 12],
      };
    } else if (!header) {
      return null; // IHDR doit être le premier bloc
    } else if (type === 'tRNS') {
      transparency = true;
    } else if (type === 'IDAT') {
      if (!full) return { header, transparency, data };
      data.push(bytes.subarray(start, end));
    } else if (type === 'IEND') {
      return { header, transparency, data };
    }
    offset = end + 4; // + CRC
  }
  return full || !header ? null : { header, transparency, data };
}

/** Vrai pour un PNG dont l'en-tête annonce de la transparence possible (canal alpha ou tRNS). */
export function pngMayHaveAlpha(bytes: Uint8Array): boolean {
  const chunks = readChunks(bytes, false);
  if (!chunks) return false;
  const { colorType } = chunks.header;
  return colorType === 4 || colorType === 6 || chunks.transparency;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Vrai si le PNG a des pixels vraiment transparents : au moins MIN_TRANSPARENT_SHARE de pixels
 * d'alpha nul et au moins un pixel opaque. Faux pour tout le reste (JPEG, PNG opaque, PNG abîmé,
 * entrelacé, palette, trop grand) : ces photos suivent le chemin du détourage par fal.ai.
 */
export function isTransparentCutout(bytes: Uint8Array): boolean {
  const chunks = readChunks(bytes, true);
  if (!chunks) return false;
  const { width, height, bitDepth, colorType, interlace } = chunks.header;
  if (colorType !== 4 && colorType !== 6) return false;
  if (bitDepth !== 8 && bitDepth !== 16) return false;
  if (interlace !== 0) return false;
  if (width < 1 || height < 1 || width > MAX_DECODED_SIDE || height > MAX_DECODED_SIDE) return false;
  if (chunks.data.length === 0) return false;

  const channels = colorType === 6 ? 4 : 2;
  const bytesPerSample = bitDepth / 8;
  const bpp = channels * bytesPerSample; // octets par pixel
  const rowBytes = width * bpp;
  const expected = height * (rowBytes + 1);

  // Tampon de sortie fourni (un octet de plus que prévu) : fflate n'écrit jamais au-delà, ce qui
  // borne la mémoire même si les données se décompressent en bien plus (fichier piégé).
  let raw: Uint8Array;
  try {
    raw = unzlibSync(concat(chunks.data), { out: new Uint8Array(expected + 1) });
  } catch {
    return false;
  }
  if (raw.length !== expected) return false;

  const alphaOffset = (channels - 1) * bytesPerSample; // octet de poids fort de l'alpha
  const needed = Math.max(1, Math.ceil(width * height * MIN_TRANSPARENT_SHARE));
  let transparent = 0;
  let opaque = false;
  let previous = new Uint8Array(rowBytes);
  let current = new Uint8Array(rowBytes);

  for (let y = 0; y < height; y++) {
    const start = y * (rowBytes + 1);
    const filter = raw[start];
    if (filter > 4) return false;
    for (let i = 0; i < rowBytes; i++) {
      const x = raw[start + 1 + i];
      const a = i >= bpp ? current[i - bpp] : 0;
      const b = previous[i];
      const c = i >= bpp ? previous[i - bpp] : 0;
      let value: number;
      if (filter === 0) value = x;
      else if (filter === 1) value = x + a;
      else if (filter === 2) value = x + b;
      else if (filter === 3) value = x + ((a + b) >> 1);
      else value = x + paeth(a, b, c);
      current[i] = value & 0xff;
    }
    for (let p = alphaOffset; p < rowBytes; p += bpp) {
      const high = current[p];
      const low = bytesPerSample === 2 ? current[p + 1] : high;
      if (high === 0 && low === 0) transparent++;
      else if (high === 0xff && low === 0xff) opaque = true;
    }
    if (transparent >= needed && opaque) return true;
    [previous, current] = [current, previous];
  }
  return false;
}
