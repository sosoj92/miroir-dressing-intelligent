import 'server-only';
import { parseCity } from '@/lib/geocoding/parse';
import { assertOwnPath, StoragePathError } from '@/lib/server/storage';
import { CATEGORIES, STYLES, type Category, type Style, type Warmth } from '@/lib/types';
import { BATCH_LIMITS, type ImportBatch, type ImportItemPayload } from './batches';
import { importCutoutPath, importPhotoPath, PHOTO_EXTS } from './images';
import { LEGACY_ID_PATTERN, NAME_MAX, type ImportHistory, type ImportPlan, type ImportRefusal } from './prototype';

// Validation stricte de ce que la server action importPrototype reçoit du navigateur.
// Rien n'est recopié tel quel : chaque champ est relu, et un seul champ faux refuse l'envoi.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
/** Une tenue du prototype a au plus 3 pièces (haut, veste, bas) ; marge pour les catégories nouvelles. */
const MAX_IDS_PER_ENTRY = 6;

export type ValidationResult = { ok: true; batch: ImportBatch } | { ok: false; error: string };

class Invalid extends Error {}

function fail(): never {
  throw new Invalid();
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}

function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail();
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') fail();
  return value;
}

function legacyId(value: unknown): string {
  if (typeof value !== 'string' || !LEGACY_ID_PATTERN.test(value)) fail();
  return value;
}

function isoDate(value: unknown): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) fail();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail();
  return value;
}

function legacyIds(value: unknown): string[] {
  const ids = list(value, MAX_IDS_PER_ENTRY).map(legacyId);
  if (ids.length === 0 || new Set(ids).size !== ids.length) fail();
  return ids;
}

function name(value: unknown): string {
  if (typeof value !== 'string') fail();
  const trimmed = value.trim();
  const length = Array.from(trimmed).length;
  if (length < 1 || length > NAME_MAX) fail();
  return trimmed;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40) fail();
  const time = Date.parse(value);
  if (Number.isNaN(time)) fail();
  return new Date(time).toISOString();
}

function ownPath(userId: string, value: unknown, allowed: string[]): string {
  if (typeof value !== 'string' || value.length > 300) fail();
  try {
    assertOwnPath(userId, value);
  } catch (error) {
    if (error instanceof StoragePathError) fail();
    throw error;
  }
  // Chemin exact attendu pour cette fiche : une fiche ne peut pas pointer vers le fichier d'une autre.
  if (!allowed.includes(value)) fail();
  return value;
}

function item(userId: string, value: unknown): ImportItemPayload {
  const source = record(value);
  const legacy_id = legacyId(source.legacy_id);
  const category = CATEGORIES.find((c) => c === source.category) as Category | undefined;
  if (!category) fail();
  if (source.color !== null && (typeof source.color !== 'string' || !COLOR_PATTERN.test(source.color))) fail();
  if (source.warmth !== 1 && source.warmth !== 2 && source.warmth !== 3) fail();
  const styles = list(source.styles, STYLES.length).map((style) => {
    const found = STYLES.find((s) => s === style) as Style | undefined;
    if (!found) fail();
    return found;
  });
  if (styles.length === 0 || new Set(styles).size !== styles.length) fail();

  const payload: ImportItemPayload = {
    legacy_id,
    name: name(source.name),
    category,
    color: source.color === null ? null : (source.color as string).toUpperCase(),
    warmth: source.warmth as Warmth,
    styles,
    rain_ok: bool(source.rain_ok),
    dirty: bool(source.dirty),
  };
  if (source.created_at !== undefined) payload.created_at = timestamp(source.created_at);
  if (source.photo_path !== undefined) {
    payload.photo_path = ownPath(
      userId,
      source.photo_path,
      PHOTO_EXTS.map((ext) => importPhotoPath(userId, legacy_id, ext)),
    );
  }
  if (source.cutout_path !== undefined) {
    payload.cutout_path = ownPath(userId, source.cutout_path, [importCutoutPath(userId, legacy_id)]);
  }
  return payload;
}

function unique<T>(entries: T[], key: (entry: T) => string): T[] {
  const keys = entries.map(key);
  if (new Set(keys).size !== keys.length) fail();
  return entries;
}

/**
 * Valide un envoi d'import pour le compte `userId`. Renvoie un message court en français si
 * quelque chose ne va pas, sans dire quel champ (le navigateur n'en a pas besoin).
 */
export function validateImportBatch(input: unknown, userId: string): ValidationResult {
  try {
    const source = record(input);
    const items = unique(
      list(source.items, BATCH_LIMITS.items).map((entry) => item(userId, entry)),
      (entry) => entry.legacy_id,
    );
    const history: ImportHistory[] = unique(
      list(source.history, BATCH_LIMITS.history).map((entry) => {
        const value = record(entry);
        return { date: isoDate(value.date), legacy_ids: legacyIds(value.legacy_ids) };
      }),
      (entry) => entry.date,
    );
    const refusals: ImportRefusal[] = list(source.refusals, BATCH_LIMITS.refusals).map((entry) => ({
      legacy_ids: legacyIds(record(entry).legacy_ids),
    }));
    const plans: ImportPlan[] = unique(
      list(source.plans, BATCH_LIMITS.plans).map((entry) => {
        const value = record(entry);
        return { date: isoDate(value.date), legacy_ids: legacyIds(value.legacy_ids), confirmed: bool(value.confirmed) };
      }),
      (entry) => entry.date,
    );
    let city = null;
    if (source.city !== null) {
      city = parseCity(source.city);
      if (!city) fail();
    }
    return { ok: true, batch: { items, history, refusals, plans, city } };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: "Données d'import invalides." };
    throw error;
  }
}
