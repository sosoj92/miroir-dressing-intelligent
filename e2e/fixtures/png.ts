import { deflateSync } from 'node:zlib';

// Petites images PNG de test, générées à la volée (aucun fichier binaire dans le dépôt) :
// des formes opaques sur fond transparent, comme un détourage.

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

type Rgba = readonly [number, number, number, number];

/** Encode une image RGBA 8 bits dont chaque pixel est donné par `pixel(x, y)`. */
function encodePng(width: number, height: number, pixel: (x: number, y: number) => Rgba): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits par composante
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    rows[row] = 0; // filtre « None »
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 4;
      const [r, g, b, a] = pixel(x, y);
      rows[i] = r;
      rows[i + 1] = g;
      rows[i + 2] = b;
      rows[i + 3] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const TRANSPARENT: Rgba = [0, 0, 0, 0];

/** PNG RGBA : un rectangle de `gray` (0–255) au centre, entouré de transparence. */
export function cutoutPng(width = 120, height = 160, gray = 217): Buffer {
  const marginX = Math.round(width * 0.15);
  const marginY = Math.round(height * 0.1);
  const fill: Rgba = [gray, gray, gray, 255];
  return encodePng(width, height, (x, y) =>
    x >= marginX && x < width - marginX && y >= marginY && y < height - marginY ? fill : TRANSPARENT,
  );
}

export type Rgb = readonly [number, number, number];
export type PaintedRect = { x: number; y: number; width: number; height: number; rgb: Rgb };

/**
 * PNG RGBA transparent où chaque rectangle est peint d'une couleur opaque (le dernier par-dessus) :
 * une fausse photo portée détourée, avec des repères connus au pixel près.
 */
export function paintedPng(width: number, height: number, rects: readonly PaintedRect[]): Buffer {
  return encodePng(width, height, (x, y) => {
    for (let i = rects.length - 1; i >= 0; i--) {
      const rect = rects[i];
      if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) {
        return [rect.rgb[0], rect.rgb[1], rect.rgb[2], 255];
      }
    }
    return TRANSPARENT;
  });
}
