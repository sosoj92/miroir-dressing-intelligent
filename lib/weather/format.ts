import type { DayWeather } from '@/lib/types';
import { isRainCode } from './codes';

// La météo en une ligne, la même sur le miroir et le téléphone (docs/conception.md §4) : « Pluie · 9° à 14° ».
// Fonction pure, utilisable dans le navigateur.

/** Pluie seulement d'après la probabilité, alors que le temps prévu est sec. */
export const LIKELY_RAIN_LABEL = 'Pluie probable';

function degrees(value: number): string {
  const rounded = Math.round(value);
  return `${rounded === 0 ? 0 : rounded}°`; // jamais « -0° »
}

/**
 * Le libellé, puis le minimum et le maximum du jour : on s'habille au plus frais, on vit au plus
 * chaud. La pluie qui ne vient que de la probabilité (≥ 50 %) se lit « Pluie probable ».
 */
export function weatherSummary(weather: DayWeather): string {
  const label = weather.rain && !isRainCode(weather.code) ? LIKELY_RAIN_LABEL : weather.label;
  const low = degrees(weather.tempMin);
  const high = degrees(weather.tempMax);
  const range = low === high ? high : `${low} à ${high}`;
  return label ? `${label} · ${range}` : range;
}
