import type { Category, HistoryEntry, Item } from '@/lib/types';

// Historique des tenues portées, comparé à la date visée (context.date), jamais à l'horloge.
// Calcul sur le calendrier seul (jours civils), sans objet Date : pas de fuseau, pas de changement d'heure.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Numéro de jour civil (0 = 1970-01-01) d'une date AAAA-MM-JJ valide, sinon null. */
export function dayNumber(isoDate: unknown): number | null {
  if (typeof isoDate !== 'string') return null;
  const match = ISO_DATE.exec(isoDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  // Algorithme « days from civil » (calendrier grégorien proleptique).
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Nombre de jours de `from` à `to` (positif si `to` est plus tard), null si une date est invalide. */
export function daysBetween(from: string, to: string): number | null {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? null : b - a;
}

/** Entrées strictement antérieures à `date`, avec leur ancienneté en jours (1 = la veille). */
function pastEntries(history: readonly HistoryEntry[], date: string): { daysAgo: number; ids: string[] }[] {
  const out: { daysAgo: number; ids: string[] }[] = [];
  if (!Array.isArray(history)) return out;
  for (const entry of history) {
    if (!entry || !Array.isArray(entry.item_ids)) continue;
    const daysAgo = daysBetween(entry.date, date);
    // Une tenue portée le jour visé (acceptée ce matin) ne change pas les propositions de ce jour.
    if (daysAgo === null || daysAgo < 1) continue;
    out.push({ daysAgo, ids: entry.item_ids.filter((id: unknown): id is string => typeof id === 'string') });
  }
  return out;
}

/** Pour chaque pièce portée avant `date` : il y a combien de jours, au plus récent. */
export function lastWornDaysAgo(history: readonly HistoryEntry[], date: string): Map<string, number> {
  const last = new Map<string, number>();
  for (const { daysAgo, ids } of pastEntries(history, date)) {
    for (const id of ids) {
      const known = last.get(id);
      if (known === undefined || daysAgo < known) last.set(id, daysAgo);
    }
  }
  return last;
}

/** Clé d'un duo haut + bas. */
export function pairKey(topId: string, bottomId: string): string {
  return `${topId}+${bottomId}`;
}

/**
 * Duos haut + bas portés ensemble dans les `withinDays` jours avant `date`.
 * La catégorie de chaque pièce est lue dans `categoryOf` (les pièces inconnues sont ignorées).
 */
export function recentPairs(
  history: readonly HistoryEntry[],
  date: string,
  categoryOf: ReadonlyMap<string, Category>,
  withinDays: number,
): Set<string> {
  const pairs = new Set<string>();
  for (const { daysAgo, ids } of pastEntries(history, date)) {
    if (daysAgo > withinDays) continue;
    const tops = ids.filter((id) => categoryOf.get(id) === 'haut');
    const bottoms = ids.filter((id) => categoryOf.get(id) === 'bas');
    for (const top of tops) for (const bottom of bottoms) pairs.add(pairKey(top, bottom));
  }
  return pairs;
}

/** Pièces dont la catégorie est connue, indexées par id. */
export function categoryMap(items: readonly Item[]): Map<string, Category> {
  return new Map(items.map((item) => [item.id, item.category]));
}
