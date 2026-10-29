import type { DayWeather } from '@/lib/types';
import { UNKNOWN_WEATHER_CODE, isRainCode, weatherLabel } from './codes';

// Lecture d'une réponse Open-Meteo « daily » (fonction pure, testée sans réseau).

/** À partir de cette probabilité de précipitations (%), le jour compte comme pluvieux (prototype). */
export const RAIN_PROBABILITY_THRESHOLD = 50;

/** Variables journalières demandées à Open-Meteo. */
export const DAILY_VARIABLES = [
  'temperature_2m_max',
  'temperature_2m_min',
  'weather_code',
  'precipitation_probability_max',
  'precipitation_sum',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function at(series: unknown, index: number): unknown {
  return Array.isArray(series) ? series[index] : undefined;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Arrondi au degré, sans « -0 » (−0,4 °C s'affiche 0). */
function roundDegrees(value: number): number {
  return Math.round(value) + 0;
}

/**
 * Météo de `date` (AAAA-MM-JJ) dans une réponse Open-Meteo, ou null si la réponse n'a pas ce jour
 * ou pas ses températures minimale et maximale.
 * - `tempMin`, `tempMax` : arrondies au degré, comme à l'affichage ;
 * - `temp` (référence pour la chaleur des pièces et la veste) = maximum du jour arrondi : c'est la
 *   formule du prototype (`dayTemperature` prenait le maximum) ;
 * - `rain` : code WMO de pluie, neige ou orage, ou probabilité de précipitations ≥ RAIN_PROBABILITY_THRESHOLD ;
 * - `code` absent : UNKNOWN_WEATHER_CODE, sans libellé.
 * `precipitation_sum` est demandé mais n'entre dans aucune règle.
 */
export function parseOpenMeteoDaily(json: unknown, date: string): DayWeather | null {
  if (!isRecord(json) || !isRecord(json.daily)) return null;
  const daily = json.daily;
  if (!Array.isArray(daily.time)) return null;
  const index = daily.time.indexOf(date);
  if (index < 0) return null;

  const max = finite(at(daily.temperature_2m_max, index));
  const min = finite(at(daily.temperature_2m_min, index));
  if (max === null || min === null) return null;

  const rawCode = at(daily.weather_code, index);
  const code = typeof rawCode === 'number' && Number.isInteger(rawCode) ? rawCode : UNKNOWN_WEATHER_CODE;
  const probability = finite(at(daily.precipitation_probability_max, index));
  const tempMax = roundDegrees(max);

  return {
    date,
    tempMin: roundDegrees(min),
    tempMax,
    temp: tempMax,
    code,
    rain: isRainCode(code) || (probability !== null && probability >= RAIN_PROBABILITY_THRESHOLD),
    label: weatherLabel(code),
  };
}
