import { parseAssembly } from '@/lib/assembly/parse';
import { CATEGORIES, type Item } from '@/lib/types';
import { isCategory, isStyle, isWarmth, normalizeColor } from './validate';

// Lecture des lignes `items` (le client Supabase n'est pas typé) et ordre d'affichage.

export const ITEM_COLUMNS =
  'id, name, category, color, warmth, styles, rain_ok, dirty, photo_path, cutout_path, legacy_id, created_at, assembly';

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Ligne `items` → Item, ou null si elle ne ressemble pas à une pièce (lecture défensive). */
export function parseItemRow(row: unknown): Item | null {
  if (!row || typeof row !== 'object') return null;
  const source = row as Record<string, unknown>;
  if (typeof source.id !== 'string' || typeof source.name !== 'string' || !isCategory(source.category)) return null;

  const warmth = Number(source.warmth);
  const styles = Array.isArray(source.styles) ? source.styles.filter(isStyle) : [];

  return {
    id: source.id,
    name: source.name,
    category: source.category,
    color: normalizeColor(source.color),
    warmth: isWarmth(warmth) ? warmth : 2,
    styles: styles.length > 0 ? [...new Set(styles)] : ['decontracte'],
    rain_ok: source.rain_ok === true,
    dirty: source.dirty === true,
    photo_path: textOrNull(source.photo_path),
    cutout_path: textOrNull(source.cutout_path),
    legacy_id: textOrNull(source.legacy_id),
    created_at: typeof source.created_at === 'string' ? source.created_at : '',
    // Repères d'une pièce photographiée portée (docs/conception.md §7) : null s'ils sont absents ou illisibles.
    assembly: parseAssembly(source.assembly),
  };
}

/** Ordre de la garde-robe : catégorie (ordre de CATEGORIES), puis la plus récente d'abord. */
export function sortItems<T extends Pick<Item, 'category' | 'created_at'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const byCategory = CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category);
    if (byCategory !== 0) return byCategory;
    return b.created_at.localeCompare(a.created_at);
  });
}
