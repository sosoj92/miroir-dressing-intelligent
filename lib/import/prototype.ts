import { isValidTimeZone, parseCity, type City } from '@/lib/geocoding/parse';
import { STYLES, type Style, type Warmth } from '@/lib/types';

// Import de l'ancien format db.json (docs/conception.md §3.1), qui est aussi celui du zip simple : un dossier
// Dressing/ avec db.json et ses PNG détourés. Fonctions pures, sans réseau :
// - parsePrototypeDb lit et valide db.json ;
// - mapPrototype convertit ses champs vers le nouveau modèle.
// Les photos sont des fichiers à part (dossier photos/) : on ne garde ici que leurs noms.
// Ignorés, propres au prototype : pieces[].align, settings.split, settings.reference,
// settings.weatherOverride, settings.gestures, composites.

/** Identifiant d'une pièce du prototype (`p_` + 8 caractères base 36) : sert aussi dans les chemins Storage. */
export const LEGACY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
export const NAME_MAX = 80;

/** Bornes d'un db.json acceptable (au-delà, le fichier n'est pas celui du prototype). */
export const PROTOTYPE_LIMITS = {
  pieces: 2000,
  wears: 20000,
  refusals: 20000,
  plans: 2000,
} as const;

export const PROTOTYPE_CATEGORIES = ['haut', 'veste', 'bas'] as const;
export type PrototypeCategory = (typeof PROTOTYPE_CATEGORIES)[number];
type PrototypeWarmth = 'leger' | 'moyen' | 'chaud';

export type PrototypePiece = {
  id: string;
  name: string;
  category: PrototypeCategory;
  color: string | null;
  warmth: PrototypeWarmth;
  occasions: string[];
  rain: boolean;
  status: string;
  photo: string | null;
  cutout: string | null;
  createdAt: string | null;
};

type Slots = { haut: string | null; veste: string | null; bas: string | null };
export type PrototypeWear = Slots & { date: string };
export type PrototypeRefusal = Slots;
export type PrototypePlan = Slots & { date: string; confirmed: boolean };

export type PrototypeDb = {
  pieces: PrototypePiece[];
  wears: PrototypeWear[];
  refusals: PrototypeRefusal[];
  plans: PrototypePlan[];
  city: City | null;
};

export type ParseResult =
  | { ok: true; db: PrototypeDb; /** pièces écartées (id ou catégorie invalide, doublon) */ ignored: number }
  | { ok: false; error: string };

// ------------------------------------------------------------------ Lecture

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function legacyId(value: unknown): string | null {
  return typeof value === 'string' && LEGACY_ID_PATTERN.test(value) ? value : null;
}

function fileName(value: unknown): string | null {
  return typeof value === 'string' && FILE_NAME_PATTERN.test(value) && !value.includes('..') ? value : null;
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = value.trim().replace(/\s+/g, ' ');
  return Array.from(name).slice(0, NAME_MAX).join('').trim();
}

function createdAt(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  const year = new Date(time).getUTCFullYear();
  return year >= 2000 && year <= 2100 ? new Date(time).toISOString() : null;
}

const DEFAULT_NAMES: Record<PrototypeCategory, string> = { haut: 'Haut', veste: 'Veste', bas: 'Bas' };

function parsePiece(raw: unknown): PrototypePiece | null {
  if (!isRecord(raw)) return null;
  const id = legacyId(raw.id);
  const category = PROTOTYPE_CATEGORIES.find((c) => c === raw.category);
  if (!id || !category) return null;

  const color = typeof raw.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(raw.color) ? raw.color.toUpperCase() : null;
  const warmth = (['leger', 'moyen', 'chaud'] as const).find((w) => w === raw.warmth) ?? 'moyen';
  const occasions = Array.isArray(raw.occasions)
    ? raw.occasions.filter((o): o is string => typeof o === 'string')
    : [];

  return {
    id,
    name: cleanName(raw.name) || DEFAULT_NAMES[category],
    category,
    color,
    warmth,
    occasions,
    rain: raw.rain === true,
    // Le prototype écrit toujours `status` ; un ancien fichier sans statut vaut « dispo ».
    status: typeof raw.status === 'string' ? raw.status : 'dispo',
    photo: fileName(raw.photo),
    cutout: fileName(raw.cutout),
    createdAt: createdAt(raw.createdAt),
  };
}

function slots(raw: Record<string, unknown>): Slots {
  // Une case vide vaut null ; un id illisible aussi (la pièce ne pourra pas être retrouvée).
  return { haut: legacyId(raw.haut), veste: legacyId(raw.veste), bas: legacyId(raw.bas) };
}

function arrayField(source: Record<string, unknown>, key: string): unknown[] | null | 'invalid' {
  const value = source[key];
  if (value === undefined || value === null) return null;
  return Array.isArray(value) ? value : 'invalid';
}

/**
 * Lit db.json. Refuse un fichier qui n'a pas la forme du prototype (pas d'objet, `pieces` absent,
 * listes trop longues). Une pièce sans id lisible ou d'une catégorie inconnue est écartée et comptée
 * dans `ignored` ; les autres champs illisibles prennent la valeur par défaut du prototype.
 */
export function parsePrototypeDb(json: unknown): ParseResult {
  if (!isRecord(json)) return { ok: false, error: "Ce fichier n'est pas un db.json du prototype." };

  const pieces = arrayField(json, 'pieces');
  const wears = arrayField(json, 'wears');
  const refusals = arrayField(json, 'refusals');
  if (pieces === null || pieces === 'invalid' || wears === 'invalid' || refusals === 'invalid') {
    return { ok: false, error: "Ce fichier n'est pas un db.json du prototype." };
  }
  if (json.plans !== undefined && json.plans !== null && !isRecord(json.plans)) {
    return { ok: false, error: "Ce fichier n'est pas un db.json du prototype." };
  }
  const plans = isRecord(json.plans) ? json.plans : {};
  const planDates = Object.keys(plans);
  if (
    pieces.length > PROTOTYPE_LIMITS.pieces ||
    (wears?.length ?? 0) > PROTOTYPE_LIMITS.wears ||
    (refusals?.length ?? 0) > PROTOTYPE_LIMITS.refusals ||
    planDates.length > PROTOTYPE_LIMITS.plans
  ) {
    return { ok: false, error: 'Ce db.json est trop gros pour être importé.' };
  }

  const parsedPieces: PrototypePiece[] = [];
  const seen = new Set<string>();
  let ignored = 0;
  for (const raw of pieces) {
    const piece = parsePiece(raw);
    if (!piece || seen.has(piece.id)) {
      ignored++;
      continue;
    }
    seen.add(piece.id);
    parsedPieces.push(piece);
  }

  const parsedWears: PrototypeWear[] = [];
  for (const raw of wears ?? []) {
    if (isRecord(raw) && isIsoDate(raw.date)) parsedWears.push({ date: raw.date, ...slots(raw) });
  }

  const parsedRefusals: PrototypeRefusal[] = [];
  for (const raw of refusals ?? []) {
    if (isRecord(raw)) parsedRefusals.push(slots(raw));
  }

  const parsedPlans: PrototypePlan[] = [];
  for (const date of planDates.sort()) {
    const raw = plans[date];
    if (isIsoDate(date) && isRecord(raw)) {
      parsedPlans.push({ date, ...slots(raw), confirmed: raw.confirmed === true });
    }
  }

  const settings = isRecord(json.settings) ? json.settings : {};
  const rawCity = isRecord(settings.city) ? settings.city : null;
  const city = rawCity
    ? parseCity({ name: rawCity.name, lat: rawCity.lat, lon: rawCity.lon, timezone: rawCity.timezone })
    : null;

  return {
    ok: true,
    db: { pieces: parsedPieces, wears: parsedWears, refusals: parsedRefusals, plans: parsedPlans, city },
    ignored,
  };
}

// ------------------------------------------------------------------ Conversion

/** Une pièce convertie (docs/conception.md §3.1), avec les noms de ses fichiers dans photos/. */
export type ImportItem = {
  legacy_id: string;
  name: string;
  category: PrototypeCategory;
  color: string | null;
  warmth: Warmth;
  styles: Style[];
  rain_ok: boolean;
  dirty: boolean;
  /** ISO 8601, ou null si le prototype n'en donne pas (la base met alors la date du jour). */
  created_at: string | null;
  photo_file: string | null;
  cutout_file: string | null;
};

/** Ids du prototype dans l'ordre d'affichage d'une tenue : veste, haut, bas. */
export type ImportHistory = { date: string; legacy_ids: string[] };
export type ImportRefusal = { legacy_ids: string[] };
export type ImportPlan = { date: string; legacy_ids: string[]; confirmed: boolean };

export type PrototypeImport = {
  items: ImportItem[];
  history: ImportHistory[];
  refusals: ImportRefusal[];
  plans: ImportPlan[];
  city: City | null;
};

const WARMTH: Record<PrototypeWarmth, Warmth> = { leger: 1, moyen: 2, chaud: 3 };

const OCCASION_STYLES: Record<string, Style> = {
  quotidien: 'decontracte',
  detente: 'decontracte',
  habille: 'habille',
  sport: 'sport',
};

/** quotidien et detente → decontracte ; habille et sport gardés ; sans doublon ; ['decontracte'] si vide. */
export function occasionsToStyles(occasions: readonly string[]): Style[] {
  const found = new Set(occasions.map((o) => OCCASION_STYLES[o]).filter(Boolean));
  const styles = STYLES.filter((style) => found.has(style));
  return styles.length > 0 ? styles : ['decontracte'];
}

function slotIds(entry: Slots): string[] {
  return [entry.veste, entry.haut, entry.bas].filter((id): id is string => id !== null);
}

export type MapOptions = {
  /** Aujourd'hui (AAAA-MM-JJ, fuseau du profil). */
  today: string;
};

/**
 * Convertit le prototype vers le nouveau modèle (docs/conception.md §3.1).
 * - Historique et plans : seules les pièces importées sont gardées (le prototype garde dans
 *   l'historique l'id des pièces supprimées) ; une entrée sans pièce est écartée.
 * - Refus : écarté si une de ses pièces manque, sinon il bloquerait une autre combinaison.
 * - Plans : seules les dates à venir sont importées, **aujourd'hui compris** (date ≥ today) :
 *   la tenue prévue hier soir pour ce matin doit encore être proposée.
 */
export function mapPrototype(db: PrototypeDb, { today }: MapOptions): PrototypeImport {
  const items: ImportItem[] = db.pieces.map((piece) => ({
    legacy_id: piece.id,
    name: piece.name,
    category: piece.category,
    color: piece.color,
    warmth: WARMTH[piece.warmth],
    styles: occasionsToStyles(piece.occasions),
    rain_ok: piece.rain,
    dirty: piece.status !== 'dispo',
    created_at: piece.createdAt,
    photo_file: piece.photo,
    cutout_file: piece.cutout,
  }));
  const known = new Set(items.map((item) => item.legacy_id));
  const knownIds = (entry: Slots) => slotIds(entry).filter((id) => known.has(id));

  // Une entrée par date : la dernière l'emporte, comme dans le prototype.
  const historyByDate = new Map<string, ImportHistory>();
  for (const wear of db.wears) {
    const legacy_ids = knownIds(wear);
    if (legacy_ids.length > 0) historyByDate.set(wear.date, { date: wear.date, legacy_ids });
    else historyByDate.delete(wear.date);
  }
  const history = [...historyByDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const refusalKeys = new Set<string>();
  const refusals: ImportRefusal[] = [];
  for (const refusal of db.refusals) {
    const ids = slotIds(refusal);
    if (ids.length === 0 || !ids.every((id) => known.has(id))) continue;
    const key = [...ids].sort().join('|');
    if (refusalKeys.has(key)) continue;
    refusalKeys.add(key);
    refusals.push({ legacy_ids: ids });
  }

  const plans: ImportPlan[] = [];
  for (const plan of db.plans) {
    if (plan.date < today) continue;
    const legacy_ids = knownIds(plan);
    if (legacy_ids.length > 0) plans.push({ date: plan.date, legacy_ids, confirmed: plan.confirmed });
  }

  return { items, history, refusals, plans, city: db.city };
}

/** Fuseau à utiliser pour « aujourd'hui » pendant l'import : celui du prototype, s'il est valide. */
export function prototypeTimeZone(db: PrototypeDb, fallback: string): string {
  return db.city && isValidTimeZone(db.city.timezone) ? db.city.timezone : fallback;
}
