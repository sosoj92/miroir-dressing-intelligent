// Ids reçus du navigateur pour « Garder pour demain » : des uuid, sans doublon, 6 au plus
// (veste, haut ou robe, bas, chaussures, accessoire).

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_OUTFIT_ITEMS = 6;

/** Ids en minuscules, dans l'ordre reçu, ou null si la liste est invalide. */
export function parseOutfitIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_OUTFIT_ITEMS) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !UUID_PATTERN.test(entry)) return null;
    ids.push(entry.toLowerCase());
  }
  return new Set(ids).size === ids.length ? ids : null;
}
