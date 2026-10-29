import { CATEGORIES, STYLES, type Category, type ItemDraft, type Style, type Warmth } from '@/lib/types';

// Validation d'une fiche de vêtement (docs/conception.md §3 et §4, écran 3). Fonctions pures, sans réseau :
// elles servent pour la fiche proposée par la Claude API comme pour ce que renvoie le navigateur.
// Règles : nom tronqué à 80 caractères, couleur en #RRGGBB majuscules (sinon aucune),
// styles dédoublonnés et au moins un, toute valeur inconnue refusée.

/** Longueur maximale du nom (contrainte `char_length(name) between 1 and 80` de la base). */
export const MAX_NAME_LENGTH = 80;

export class ItemValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemValidationError';
  }
}

/** Nom nettoyé (espaces regroupés) et tronqué à 80 caractères. Refuse un nom vide. */
export function normalizeName(value: unknown): string {
  if (typeof value !== 'string') throw new ItemValidationError('Donne un nom au vêtement.');
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned === '') throw new ItemValidationError('Donne un nom au vêtement.');
  // Tronque par caractère (et non par unité UTF-16) pour ne jamais couper un caractère en deux.
  const characters = Array.from(cleaned);
  if (characters.length <= MAX_NAME_LENGTH) return cleaned;
  return characters.slice(0, MAX_NAME_LENGTH).join('').trimEnd();
}

const HEX6 = /^#?([0-9a-f]{6})$/i;
const HEX3 = /^#?([0-9a-f]{3})$/i;

/** Couleur au format #RRGGBB en majuscules, ou null si la valeur n'est pas une couleur. */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const long = HEX6.exec(text);
  if (long) return `#${long[1].toUpperCase()}`;
  const short = HEX3.exec(text);
  if (short) {
    const [r, g, b] = short[1].toUpperCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

export function isStyle(value: unknown): value is Style {
  return typeof value === 'string' && (STYLES as readonly string[]).includes(value);
}

export function isWarmth(value: unknown): value is Warmth {
  return value === 1 || value === 2 || value === 3;
}

/** Styles dédoublonnés, dans l'ordre de STYLES. Refuse une liste vide ou un style inconnu. */
export function normalizeStyles(value: unknown): Style[] {
  if (!Array.isArray(value)) throw new ItemValidationError('Choisis au moins un style.');
  for (const style of value) {
    if (!isStyle(style)) throw new ItemValidationError('Style inconnu.');
  }
  const chosen = new Set<unknown>(value);
  const styles = STYLES.filter((style) => chosen.has(style));
  if (styles.length === 0) throw new ItemValidationError('Choisis au moins un style.');
  return styles;
}

/**
 * Fiche validée et normalisée. Lève ItemValidationError (message français court) si un champ
 * manque ou porte une valeur inconnue. Les champs en trop sont ignorés.
 */
export function normalizeDraft(input: unknown): ItemDraft {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ItemValidationError('Fiche illisible.');
  }
  const source = input as Record<string, unknown>;

  const name = normalizeName(source.name);
  if (!isCategory(source.category)) throw new ItemValidationError('Catégorie inconnue.');
  if (!isWarmth(source.warmth)) throw new ItemValidationError('Chaleur inconnue.');
  const styles = normalizeStyles(source.styles);
  if (typeof source.rain_ok !== 'boolean') throw new ItemValidationError('Indique si le vêtement supporte la pluie.');

  return {
    name,
    category: source.category,
    color: normalizeColor(source.color),
    warmth: source.warmth,
    styles,
    rain_ok: source.rain_ok,
  };
}

export type DraftCheck = { ok: true; draft: ItemDraft } | { ok: false; error: string };

/** Variante sans exception de `normalizeDraft`. */
export function checkDraft(input: unknown): DraftCheck {
  try {
    return { ok: true, draft: normalizeDraft(input) };
  } catch (error) {
    if (error instanceof ItemValidationError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Fiche de départ quand la Claude API n'a rien proposé. */
export const EMPTY_DRAFT: ItemDraft = {
  name: '',
  category: 'haut',
  color: null,
  warmth: 2,
  styles: ['decontracte'],
  rain_ok: false,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vrai pour un uuid (id d'une pièce). À vérifier avant toute requête : Postgres refuse un id mal formé. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
