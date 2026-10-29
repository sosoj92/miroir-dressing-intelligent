// Codes météo WMO renvoyés par Open-Meteo (`weather_code`), portés du prototype (shared/logic.js).
// Fonctions pures, utilisables côté serveur comme dans le navigateur.

/** Code utilisé quand Open-Meteo ne donne pas de code pour le jour : pas de libellé, pas de pluie. */
export const UNKNOWN_WEATHER_CODE = -1;

/** Libellé français d'un code WMO, '' s'il est inconnu. */
export function weatherLabel(code: number | null | undefined): string {
  if (typeof code !== 'number' || !Number.isInteger(code)) return '';
  if (code === 0) return 'Ciel dégagé';
  if (code === 1 || code === 2) return 'Éclaircies';
  if (code === 3) return 'Couvert';
  if (code === 45 || code === 48) return 'Brouillard';
  if (code >= 51 && code <= 57) return 'Bruine';
  if (code >= 61 && code <= 67) return 'Pluie';
  if (code >= 71 && code <= 77) return 'Neige';
  if (code >= 80 && code <= 82) return 'Averses';
  if (code >= 85 && code <= 86) return 'Averses de neige';
  if (code >= 95 && code <= 99) return 'Orage';
  return '';
}

/**
 * Vrai pour un temps qui mouille : bruine, pluie (y compris verglaçante), averses, neige, averses de
 * neige et orage. Contrairement au prototype, la neige compte : pour s'habiller, elle demande la même
 * veste « ok pluie » (la tâche fixe rain = pluie, neige ou orage).
 */
export function isRainCode(code: number | null | undefined): boolean {
  if (typeof code !== 'number' || !Number.isInteger(code)) return false;
  return (
    (code >= 51 && code <= 67) ||
    (code >= 71 && code <= 77) ||
    (code >= 80 && code <= 82) ||
    (code >= 85 && code <= 86) ||
    (code >= 95 && code <= 99)
  );
}
