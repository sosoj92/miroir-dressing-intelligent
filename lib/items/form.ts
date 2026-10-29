import { COLD_BELOW_C, MILD_BELOW_C } from '@/lib/outfits/score';
import type { Category, ItemDraft, Warmth } from '@/lib/types';

// Fiche d'un vêtement sur le téléphone (components/wardrobe/item-form.tsx) : repère sous le choix
// de chaleur, interrupteur pluie, et « rien n'a changé » pour griser « Enregistrer ».
// Fonctions pures, sans réseau.

/**
 * Repère sous le choix de chaleur : les températures pour lesquelles le miroir vise cette chaleur
 * (targetWarmth, lib/outfits/score.ts). Calculé depuis les seuils, pour suivre leurs réglages.
 */
export function warmthHint(warmth: Warmth): string {
  if (warmth === 1) return `${MILD_BELOW_C}° et plus`;
  if (warmth === 2) return `${COLD_BELOW_C} à ${MILD_BELOW_C - 1}°`;
  return `moins de ${COLD_BELOW_C}°`;
}

/**
 * Catégories où « Protège de la pluie » pèse vraiment sur le choix (RAIN_OK_BONUS : veste 4,
 * chaussures 1,5, le reste 0,5). Ailleurs l'interrupteur est caché ; la valeur est gardée.
 */
export const RAIN_CATEGORIES: readonly Category[] = ['veste', 'chaussures'];

export function showsRain(category: Category): boolean {
  return RAIN_CATEGORIES.includes(category);
}

function sameName(a: string, b: string): boolean {
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
  return clean(a) === clean(b);
}

/**
 * Même fiche, telle qu'elle serait enregistrée : nom aux espaces près, couleur sans tenir compte
 * de la casse, styles dans n'importe quel ordre.
 */
export function sameDraft(a: ItemDraft, b: ItemDraft): boolean {
  return (
    sameName(a.name, b.name) &&
    a.category === b.category &&
    (a.color?.toUpperCase() ?? null) === (b.color?.toUpperCase() ?? null) &&
    a.warmth === b.warmth &&
    a.styles.length === b.styles.length &&
    a.styles.every((style) => b.styles.includes(style)) &&
    a.rain_ok === b.rain_ok
  );
}
