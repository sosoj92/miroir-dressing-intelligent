import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MAX_DECODED_SIDE, MIN_TRANSPARENT_SHARE, isTransparentCutout, pngMayHaveAlpha } from './png-alpha';

// PNG fabriqués à la volée (aucun fichier binaire dans le dépôt), avec chacun des cinq filtres
// PNG, pour vérifier le décodage des pixels sans canvas.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

type Options = {
  /** 2 = RGB, 4 = gris + alpha, 6 = RGBA. */
  colorType?: 2 | 4 | 6;
  bitDepth?: 8 | 16;
  /** Filtre de chaque ligne (0 à 4), ou fonction de la ligne. */
  filter?: number | ((y: number) => number);
  interlace?: 0 | 1;
  /** Ajoute un bloc tRNS (transparence d'une couleur). */
  trns?: boolean;
  /** Remplace les données compressées. */
  idat?: Buffer;
};

/** PNG dont l'alpha (0–255) de chaque pixel est donné par `alpha(x, y)` ; couleur grise. */
function png(width: number, height: number, alpha: (x: number, y: number) => number, options: Options = {}): Buffer {
  const { colorType = 6, bitDepth = 8, filter = 0, interlace = 0 } = options;
  const channels = colorType === 6 ? 4 : colorType === 4 ? 2 : 3;
  const bps = bitDepth / 8;
  const bpp = channels * bps;
  const rowBytes = width * bpp;
  const rows: Buffer[] = [];
  let previous = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < width; x++) {
      const a = alpha(x, y);
      const samples = channels === 3 ? [120, 90, 60] : channels === 2 ? [128, a] : [120, 90, 60, a];
      samples.forEach((value, s) => {
        // 16 bits : même valeur sur les deux octets (0 → 0x0000, 255 → 0xffff).
        for (let k = 0; k < bps; k++) row[x * bpp + s * bps + k] = value;
      });
    }
    const type = typeof filter === 'function' ? filter(y) : filter;
    const out = Buffer.alloc(rowBytes + 1);
    out[0] = type;
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= bpp ? row[i - bpp] : 0;
      const up = previous[i];
      const corner = i >= bpp ? previous[i - bpp] : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, corner)][type];
      out[i + 1] = (row[i] - predictor) & 0xff;
    }
    rows.push(out);
    previous = row;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = colorType;
  header[12] = interlace;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    ...(options.trns ? [chunk('tRNS', Buffer.from([0, 0, 0, 0, 0, 0]))] : []),
    chunk('IDAT', options.idat ?? deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Un vêtement opaque au centre, fond transparent autour (« Copier le sujet »). */
const garment = (width: number, height: number) => (x: number, y: number) =>
  x > width * 0.2 && x < width * 0.8 && y > height * 0.1 && y < height * 0.9 ? 255 : 0;

const bytes = (buffer: Buffer) => new Uint8Array(buffer);

describe('isTransparentCutout', () => {
  it.each([0, 1, 2, 3, 4])('PNG RGBA détouré, filtre %i sur chaque ligne : transparent', (filter) => {
    expect(isTransparentCutout(bytes(png(40, 50, garment(40, 50), { filter })))).toBe(true);
  });

  it('filtres mélangés d’une ligne à l’autre, bords semi-transparents : transparent', () => {
    const soft = (x: number, y: number) => (x === 10 ? 128 : garment(40, 50)(x, y));
    expect(isTransparentCutout(bytes(png(40, 50, soft, { filter: (y) => y % 5 })))).toBe(true);
  });

  it('gris + alpha, et 16 bits par composante : transparent', () => {
    expect(isTransparentCutout(bytes(png(30, 30, garment(30, 30), { colorType: 4, filter: 4 })))).toBe(true);
    expect(isTransparentCutout(bytes(png(30, 30, garment(30, 30), { bitDepth: 16, filter: 3 })))).toBe(true);
    expect(isTransparentCutout(bytes(png(30, 30, garment(30, 30), { colorType: 4, bitDepth: 16, filter: 1 })))).toBe(true);
  });

  it('canal alpha mais tout opaque (capture d’écran) : pas un détourage', () => {
    expect(isTransparentCutout(bytes(png(40, 40, () => 255, { filter: 4 })))).toBe(false);
  });

  it('entièrement transparent (rien à montrer) : pas un détourage', () => {
    expect(isTransparentCutout(bytes(png(40, 40, () => 0)))).toBe(false);
  });

  it(`au moins ${MIN_TRANSPARENT_SHARE * 100} % de pixels d’alpha nul`, () => {
    // 100 × 100 : 99 pixels transparents ne suffisent pas, 100 suffisent.
    const corner = (count: number) => (x: number, y: number) => (y * 100 + x < count ? 0 : 255);
    expect(isTransparentCutout(bytes(png(100, 100, corner(99), { filter: 2 })))).toBe(false);
    expect(isTransparentCutout(bytes(png(100, 100, corner(100), { filter: 2 })))).toBe(true);
    // Coins arrondis presque opaques (alpha 1) : pas transparents.
    expect(isTransparentCutout(bytes(png(100, 100, (x) => (x < 20 ? 1 : 255))))).toBe(false);
  });

  it('PNG sans canal alpha (RGB), même avec tRNS : pas un détourage (chemin fal.ai)', () => {
    expect(isTransparentCutout(bytes(png(20, 20, () => 255, { colorType: 2 })))).toBe(false);
    expect(isTransparentCutout(bytes(png(20, 20, () => 255, { colorType: 2, trns: true })))).toBe(false);
  });

  it('refuse l’entrelacé, le tronqué, le trop grand, le piégé et ce qui n’est pas un PNG', () => {
    const good = png(40, 50, garment(40, 50));
    expect(isTransparentCutout(bytes(png(40, 50, garment(40, 50), { interlace: 1 })))).toBe(false);
    expect(isTransparentCutout(bytes(good.subarray(0, good.length - 20)))).toBe(false);
    expect(isTransparentCutout(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]))).toBe(false);
    expect(isTransparentCutout(new Uint8Array())).toBe(false);
    // En-tête plus grand que la borne : refusé avant toute décompression.
    const huge = png(2, 2, () => 0);
    huge.writeUInt32BE(MAX_DECODED_SIDE + 1, 16);
    expect(isTransparentCutout(bytes(huge))).toBe(false);
    // 10 × 10 annoncés, mais des données qui se décompressent en 50 Mo : refusé sans tout écrire.
    const bomb = png(10, 10, () => 0, { idat: deflateSync(Buffer.alloc(50 * 1024 * 1024)) });
    expect(isTransparentCutout(bytes(bomb))).toBe(false);
    // Filtre inconnu (5).
    expect(isTransparentCutout(bytes(png(10, 10, garment(10, 10), { filter: () => 5 })))).toBe(false);
  });
});

describe('pngMayHaveAlpha (en-tête seulement)', () => {
  it('vrai pour un PNG à canal alpha, même opaque, ou avec tRNS', () => {
    expect(pngMayHaveAlpha(bytes(png(20, 20, () => 255)))).toBe(true);
    expect(pngMayHaveAlpha(bytes(png(20, 20, () => 255, { colorType: 4 })))).toBe(true);
    expect(pngMayHaveAlpha(bytes(png(20, 20, () => 255, { colorType: 2, trns: true })))).toBe(true);
  });

  it('faux pour un PNG RGB sans tRNS, un JPEG ou des octets quelconques', () => {
    expect(pngMayHaveAlpha(bytes(png(20, 20, () => 255, { colorType: 2 })))).toBe(false);
    expect(pngMayHaveAlpha(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]))).toBe(false);
    expect(pngMayHaveAlpha(new Uint8Array(100))).toBe(false);
  });

  it('se contente du début du fichier (en-tête avant les données)', () => {
    const file = png(200, 200, garment(200, 200));
    expect(pngMayHaveAlpha(bytes(file.subarray(0, 60)))).toBe(true);
  });
});
