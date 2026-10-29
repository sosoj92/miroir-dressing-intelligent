import type { AssemblyPhoto } from '@/lib/types';

// Géométrie de l'assemblage (docs/conception.md §7) : où couper entre la photo du haut et celle du bas, s'il faut
// étirer le ventre de la photo du haut, et comment placer la photo du bas. Fonctions pures, testées
// contre les valeurs de référence de la préparation Python (fixtures/reference.json, générée en local
// à partir de photos portées personnelles, hors dépôt).
// Toutes les positions verticales sont en px sous le milieu des yeux de la photo concernée.

/** Marge sous la ligne mesurée, pour que l'ourlet ou le haut rentré soient entièrement visibles. */
export const ASSEMBLY_MARGIN = 6;
/** Étirement maximal de la bande de ventre (au-delà, on coupe à la ceinture de la photo du haut). */
export const MAX_STRETCH = 3;
/** Coupe d'un haut plus long que la zone mesurée (chemise longue) : seules les jambes viennent du bas. */
export const LONG_SPLIT = 866;
/** Ligne où l'on compare les milieux des silhouettes, sauf si la coupe est plus haute. */
export const ALIGN_ROW = 500;
/** Fondu de part et d'autre de la coupe, en px. */
export const FEATHER = 10;
/** Marge retirée au-dessus de la ceinture de la photo du haut pour la bande étirée. */
const STRETCH_BOTTOM_INSET = 3;
/** Hauteur minimale de la bande de ventre pour qu'on accepte de l'étirer. */
const MIN_STRETCH_BAND = 6;

export type SplitPlan = {
  /** Ligne de coupe, en px sous les yeux de la photo du haut. */
  split: number;
  /** Bande de ventre de la photo du haut [début, fin] à étirer jusqu'à `split`, ou null. */
  stretch: [number, number] | null;
};

/** Ligne de coupe entre la photo du haut (`upper`) et celle du bas (`lower`). */
export function planSplit(upper: AssemblyPhoto, lower: AssemblyPhoto): SplitPlan {
  const lowerTop = lower.topLow ?? 0;

  if (upper.tucked && upper.bottomHigh !== null) {
    return { split: Math.max(upper.bottomHigh, lowerTop) + ASSEMBLY_MARGIN, stretch: null };
  }
  if (upper.topLow === null) return { split: LONG_SPLIT, stretch: null };
  // Haut long porté seul (t-shirt long : rien que les jambes sous l'ourlet, bottomHigh null) : le
  // fondu reste dans le vêtement, sinon on voit à moitié les cuisses de sa photo sous l'ourlet. La
  // photo du bas doit quand même montrer son bas partout où elle compte.
  if (upper.bottomHigh === null && upper.topLow > lowerTop) {
    return { split: Math.max(upper.topLow - 2 * FEATHER, lowerTop + ASSEMBLY_MARGIN + FEATHER), stretch: null };
  }

  const split = Math.max(upper.topLow, lowerTop) + ASSEMBLY_MARGIN;
  const waist = upper.bottomHigh;
  if (waist !== null && upper.topLow < waist && split > waist) {
    const from = upper.topLow + ASSEMBLY_MARGIN;
    const to = waist - STRETCH_BOTTOM_INSET;
    if (to - from >= MIN_STRETCH_BAND && (split - from) / (to - from) <= MAX_STRETCH) {
      return { split, stretch: [from, to] };
    }
    return { split: Math.min(split, waist), stretch: null };
  }
  return { split, stretch: null };
}

/** Milieu de la silhouette à `row` px sous les yeux (interpolé, borné aux lignes mesurées). */
export function centerAt(photo: AssemblyPhoto, row: number): number {
  const centers = photo.centers;
  if (centers.length === 0) return photo.eye[0];
  if (row <= centers[0][0]) return centers[0][1];
  const last = centers[centers.length - 1];
  if (row >= last[0]) return last[1];
  for (let i = 1; i < centers.length; i += 1) {
    const [r1, x1] = centers[i];
    if (row <= r1) {
      const [r0, x0] = centers[i - 1];
      return r1 === r0 ? x1 : x0 + ((x1 - x0) * (row - r0)) / (r1 - r0);
    }
  }
  return last[1];
}

/** Décalage (px) à appliquer à la photo du bas pour la poser sous celle du haut. */
export function alignLower(upper: AssemblyPhoto, lower: AssemblyPhoto, split: number): { dx: number; dy: number } {
  const row = Math.min(ALIGN_ROW, split);
  return {
    dx: centerAt(upper, row) - centerAt(lower, row),
    dy: upper.eye[1] - lower.eye[1],
  };
}
