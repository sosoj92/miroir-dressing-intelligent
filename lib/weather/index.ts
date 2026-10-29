import type { DayWeather } from '@/lib/types';
import { DAILY_VARIABLES, parseOpenMeteoDaily } from './parse';

// Météo du jour visé, depuis Open-Meteo (sans clé, docs/conception.md §9 : seules les coordonnées de la ville sortent).
// À appeler côté serveur (route handler ou server action, AGENTS.md). Ne lève jamais d'exception :
// en cas d'échec (réseau, délai, réponse inattendue), renvoie null et le miroir s'en passe.
// Aucun journal : rien d'utile à y écrire sans exposer la requête.
// Le cache n'est pas fixé ici : c'est l'appelant qui décide (`connection()` ou 'use cache').

export type Place = { lat: number; lon: number; timezone: string };

export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
/** Délai maximal de la requête à Open-Meteo, en millisecondes. */
export const WEATHER_TIMEOUT_MS = 8000;

export { RAIN_PROBABILITY_THRESHOLD, parseOpenMeteoDaily } from './parse';
export { UNKNOWN_WEATHER_CODE, isRainCode, weatherLabel } from './codes';

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isPlace(place: unknown): place is Place {
  if (!place || typeof place !== 'object') return false;
  const { lat, lon, timezone } = place as Partial<Place>;
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    typeof lon === 'number' &&
    Number.isFinite(lon) &&
    Math.abs(lon) <= 180 &&
    isTimeZone(timezone)
  );
}

/** URL de la prévision journalière d'un seul jour, ou null si le lieu ou la date sont invalides. */
export function forecastUrl(place: Place, date: string): string | null {
  if (!isPlace(place) || !isIsoDate(date)) return null;
  // Virgules en clair dans `daily`, comme le prototype qui l'a utilisé tous les jours ;
  // seul le fuseau est encodé (« Europe/Paris »). La date est déjà validée (chiffres et tirets).
  const params = [
    `latitude=${place.lat}`,
    `longitude=${place.lon}`,
    `daily=${DAILY_VARIABLES.join(',')}`,
    `timezone=${encodeURIComponent(place.timezone)}`,
    `start_date=${date}`,
    `end_date=${date}`,
  ];
  return `${OPEN_METEO_FORECAST_URL}?${params.join('&')}`;
}

/** Météo de `date` (AAAA-MM-JJ, dans le fuseau du lieu) à `place`, ou null si elle est indisponible. */
export async function fetchDayWeather(place: Place, date: string): Promise<DayWeather | null> {
  const url = forecastUrl(place, date);
  if (!url) return null;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return parseOpenMeteoDaily(await response.json(), date);
  } catch {
    return null;
  }
}
