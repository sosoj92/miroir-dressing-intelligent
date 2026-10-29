// Dates du miroir. La date du jour se calcule dans le fuseau du profil
// (profile.timezone, Europe/Paris par défaut), jamais en UTC : Vercel tourne en UTC (docs/conception.md §6).

export const DEFAULT_TIME_ZONE = 'Europe/Paris';

const isoDateFormatters = new Map<string, Intl.DateTimeFormat>();

/** Date du jour au format AAAA-MM-JJ, dans le fuseau donné. */
export function isoDateInTimeZone(instant: Date, timeZone: string): string {
  let formatter = isoDateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    isoDateFormatters.set(timeZone, formatter);
  }
  return formatter.format(instant);
}

const dayLabelFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** « Samedi 24 octobre » pour 2026-10-24. */
export function formatDayLabel(isoDate: string): string {
  const label = dayLabelFormatter.format(new Date(`${isoDate}T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const DAY_MS = 86_400_000;

/** 2026-10-24 + 1 → 2026-10-25 (calcul sur le calendrier, sans fuseau). */
export function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T12:00:00Z`) + days * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

/** Heure (0 à 23) dans le fuseau donné. */
export function hourInTimeZone(instant: Date, timeZone: string): number {
  let formatter = hourFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' });
    hourFormatters.set(timeZone, formatter);
  }
  return Number(formatter.format(instant));
}

export type TargetDay = { today: string; targetDate: string; isTomorrow: boolean };

/**
 * Jour visé par le miroir (docs/conception.md §4, « Préparer demain ») : aujourd'hui, ou demain à partir de
 * `eveningHour` (18 h par défaut), toujours dans le fuseau du profil.
 */
export function targetDay(instant: Date, timeZone: string, eveningHour: number): TargetDay {
  const today = isoDateInTimeZone(instant, timeZone);
  const isTomorrow = hourInTimeZone(instant, timeZone) >= eveningHour;
  return { today, targetDate: isTomorrow ? addDays(today, 1) : today, isTomorrow };
}
