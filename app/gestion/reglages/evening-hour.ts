// Heure de « Préparer demain » (docs/conception.md §4) : bornes de la colonne profile.evening_hour.
export const EVENING_HOUR_MIN = 12;
export const EVENING_HOUR_MAX = 23;
export const EVENING_HOUR_DEFAULT = 18;

export function isEveningHour(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= EVENING_HOUR_MIN && value <= EVENING_HOUR_MAX;
}

export const EVENING_HOURS: number[] = Array.from(
  { length: EVENING_HOUR_MAX - EVENING_HOUR_MIN + 1 },
  (_, i) => EVENING_HOUR_MIN + i,
);
