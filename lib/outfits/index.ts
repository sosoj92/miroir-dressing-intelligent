import type { Item, Outfit, OutfitContext } from '@/lib/types';
import { buildOutfits } from './generate';

// Choix des tenues (docs/conception.md §6) : fonction pure et déterministe (mêmes entrées, même date, même
// résultat), sans réseau, sans horloge ni hasard. Utilisable côté serveur comme dans le navigateur.
// Le détail des règles est dans generate.ts, les constantes de score dans score.ts et color.ts.
// Les styles des pièces ne filtrent rien : le choix de l'occasion du jour n'est pas tranché (docs/conception.md §11, 8).

export const MAX_OUTFITS = 5;

/**
 * Jusqu'à MAX_OUTFITS tenues distinctes pour `context.date`, de la meilleure à la moins bonne.
 * Une tenue prévue pour cette date (`context.plan`) passe en premier, avec `planned = true`.
 * Moins de 5 combinaisons possibles : celles qui existent ; aucune : [].
 */
export function generateOutfits(items: Item[], context: OutfitContext): Outfit[] {
  return buildOutfits(items, context, MAX_OUTFITS);
}

export { CORE_CATEGORIES, DISPLAY_ORDER, coreIdsOf, drawnIdsOf, outfitKeyOf, rankByCategory } from './generate';
export { hashSeed } from './hash';
export { daysBetween } from './history';
export { FALLBACK_TITLE, outfitCaption, outfitTitle, type CaptionPiece } from './title';
export { colorHarmony, isNeutral } from './color';
export {
  JACKET_BELOW_C,
  NO_WEATHER_TEMP_C,
  needsJacket,
  referenceTemperature,
  targetWarmth,
} from './score';
