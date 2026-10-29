import type { ArmSides, ArmSpan, ArmsLayer, Assembly, AssemblyArms, AssemblyPhoto } from '@/lib/types';

// Lecture défensive de `items.assembly` (jsonb) et du manifeste d'import : on ne garde qu'une
// structure complète et plausible, sinon null (la pièce s'affiche alors sans assemblage).
// Les bras pliés (`photo.arms`, facultatifs) sont lus à part : illisibles, ils sont ignorés et la
// photo reste valable (la silhouette se dessine alors sans bras pliés).

const MAX_SIZE = 8000;
const MAX_ROW = 4000;
const MAX_CENTERS = 400;
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Version du champ `arms`, pas et première ligne de ses tableaux (scripts/assemblage/README.md). */
export const ARMS_VERSION = 1;
export const ARMS_STEP = 5;
export const ARMS_FROM = 250;
/** Lignes décrites au plus par tableau (une tous les 5 px : 2 000 px sous les yeux). */
export const MAX_ARM_ROWS = 400;
const MAX_LAYER_PATH = 512;
const SAFE_PATH = /^[A-Za-z0-9._\-/]+$/;

const ARMS_KEYS = ['v', 'arms', 'body', 'sleeves', 'step', 'from', 'L', 'R', 'sleeveL', 'sleeveR', 'wrist', 'cuff'];
const LAYER_KEYS = ['path', 'box'];
const SIDE_KEYS = ['L', 'R'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Exactement ces champs, ni plus ni moins. */
function exactKeys(source: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(source);
  return own.length === keys.length && own.every((key) => keys.includes(key));
}

function finite(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function pair(value: unknown, min: number, max: number): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const a = finite(value[0], min, max);
  const b = finite(value[1], min, max);
  return a === null || b === null ? null : [a, b];
}

function nullableRow(value: unknown, min = -MAX_ROW, max = MAX_ROW): number | null | undefined {
  if (value === null) return null;
  const row = finite(value, min, max);
  return row === null ? undefined : row;
}

// ---------------------------------------------------------------- Bras pliés

/** Chemin d'une couche : WebP, caractères sûrs, sans segment vide, « . » ni « .. ». */
function layerPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_LAYER_PATH || !SAFE_PATH.test(value)) return null;
  if (!value.endsWith('.webp')) return null;
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..') ? value : null;
}

/** Couche : chemin et boîte entière, dans la photo à 1 px près (la marge transparente peut déborder). */
function layer(value: unknown, size: [number, number]): ArmsLayer | null {
  if (!isRecord(value) || !exactKeys(value, LAYER_KEYS)) return null;
  const path = layerPath(value.path);
  const box = value.box;
  if (!path || !Array.isArray(box) || box.length !== 4 || !box.every((entry) => Number.isInteger(entry))) return null;
  const [x, y, width, height] = box as number[];
  if (width < 1 || height < 1 || x < -1 || y < -1 || x + width > size[0] + 1 || y + height > size[1] + 1) return null;
  return { path, box: [x, y, width, height] };
}

/** Bords [xmin, xmax] par ligne, ou null ; colonnes de la photo, xmin ≤ xmax. */
function spans(value: unknown, width: number): ArmSpan[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ARM_ROWS) return null;
  const rows: ArmSpan[] = [];
  for (const entry of value) {
    if (entry === null) {
      rows.push(null);
      continue;
    }
    const span = pair(entry, 0, width);
    if (!span || span[0] > span[1]) return null;
    rows.push(span);
  }
  return rows;
}

/** { L, R } : px sous les yeux, dans la hauteur de la photo, ou null. */
function sides(value: unknown, height: number): ArmSides | null {
  if (!isRecord(value) || !exactKeys(value, SIDE_KEYS)) return null;
  const left = nullableRow(value.L, 0, height);
  const right = nullableRow(value.R, 0, height);
  return left === undefined || right === undefined ? null : { L: left, R: right };
}

/**
 * Champ `arms` d'une photo de taille `size`, relu strictement : version, champs exacts, boîtes
 * entières, quatre tableaux de même longueur qui ne dépassent pas la photo. null sinon.
 * Les chemins ne sont vérifiés que sur leur forme : l'import les compare aux noms attendus.
 */
export function parseAssemblyArms(value: unknown, size: [number, number]): AssemblyArms | null {
  if (!isRecord(value) || !exactKeys(value, ARMS_KEYS)) return null;
  if (value.v !== ARMS_VERSION || value.step !== ARMS_STEP || value.from !== ARMS_FROM) return null;
  const [width, height] = size;

  const arms = layer(value.arms, size);
  const body = layer(value.body, size);
  if (!arms || !body) return null;
  let sleeves: ArmsLayer | null = null;
  if (value.sleeves !== null) {
    sleeves = layer(value.sleeves, size);
    if (!sleeves) return null;
  }

  const L = spans(value.L, width);
  const R = spans(value.R, width);
  const sleeveL = spans(value.sleeveL, width);
  const sleeveR = spans(value.sleeveR, width);
  if (!L || !R || !sleeveL || !sleeveR) return null;
  const rows = L.length;
  if (R.length !== rows || sleeveL.length !== rows || sleeveR.length !== rows) return null;
  if (ARMS_FROM + (rows - 1) * ARMS_STEP > height) return null; // lignes sous le bas de la photo

  const wrist = sides(value.wrist, height);
  const cuff = sides(value.cuff, height);
  if (!wrist || !cuff) return null;

  return { v: ARMS_VERSION, arms, body, sleeves, step: ARMS_STEP, from: ARMS_FROM, L, R, sleeveL, sleeveR, wrist, cuff };
}

/** Vrai si cette photo (brute) annonce des bras pliés : l'import refuse alors des données illisibles. */
export function declaresArms(photo: unknown): boolean {
  return isRecord(photo) && photo.arms !== undefined && photo.arms !== null;
}

// ---------------------------------------------------------------- Photo et colonne assembly

export function parseAssemblyPhoto(value: unknown): AssemblyPhoto | null {
  if (!isRecord(value)) return null;
  const source = value;
  if (typeof source.key !== 'string' || !KEY_PATTERN.test(source.key)) return null;

  const size = pair(source.size, 1, MAX_SIZE);
  const eye = pair(source.eye, 0, MAX_SIZE);
  if (!size || !eye || eye[0] > size[0] || eye[1] > size[1]) return null;

  if (!Array.isArray(source.centers) || source.centers.length > MAX_CENTERS) return null;
  const centers: Array<[number, number]> = [];
  for (const entry of source.centers) {
    const point = pair(entry, -MAX_ROW, MAX_SIZE);
    if (!point) return null;
    if (centers.length > 0 && point[0] <= centers[centers.length - 1][0]) return null; // lignes croissantes
    centers.push(point);
  }

  const topLow = nullableRow(source.topLow);
  const bottomHigh = nullableRow(source.bottomHigh);
  if (topLow === undefined || bottomHigh === undefined) return null;
  if (typeof source.onePiece !== 'boolean' || typeof source.tucked !== 'boolean') return null;

  const photo: AssemblyPhoto = {
    key: source.key,
    size,
    eye,
    centers,
    topLow,
    bottomHigh,
    onePiece: source.onePiece,
    tucked: source.tucked,
  };
  // Pas de clé `arms` du tout sans données lisibles : une pièce sans bras pliés reste identique.
  const arms = declaresArms(source) ? parseAssemblyArms(source.arms, size) : null;
  if (arms) photo.arms = arms;
  return photo;
}

export function parseAssembly(value: unknown): Assembly | null {
  if (!isRecord(value)) return null;
  const source = value;
  if (source.v !== 1) return null;
  const photo = parseAssemblyPhoto(source.photo);
  if (!photo) return null;
  const sleevesPath = source.sleevesPath;
  if (sleevesPath !== null && (typeof sleevesPath !== 'string' || sleevesPath.length === 0 || sleevesPath.length > 512)) {
    return null;
  }
  return { v: 1, photo, sleevesPath };
}
