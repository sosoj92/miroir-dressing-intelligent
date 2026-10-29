// Harmonie des couleurs, en une règle simple :
// - une couleur « neutre » va avec tout : sans couleur connue, peu saturée (gris, beige, camel, jean),
//   très foncée (noir, marine, brun) ou très claire (blanc, écru, pastels) ;
// - deux couleurs vives vont ensemble si elles sont voisines sur le cercle chromatique (camaïeu,
//   rouge et orange) ou opposées (complémentaires, bleu et orange) ;
// - sinon elles jurent (rouge et vert, vert et bleu…), et la tenue perd COLOR_CLASH_PENALTY par paire.

/** En dessous de cette saturation (TSL, 0–1), la couleur est neutre : gris, beige, camel, jean. */
export const NEUTRAL_MAX_SATURATION = 0.45;
/** À cette luminosité (TSL, 0–1) ou en dessous, la couleur est neutre : noir, marine, brun, bordeaux. */
export const DARK_MAX_LIGHTNESS = 0.28;
/** À cette luminosité ou au-dessus, la couleur est neutre : blanc, écru, pastels. */
export const LIGHT_MIN_LIGHTNESS = 0.85;
/** Deux couleurs vives à cet écart de teinte (degrés) ou moins sont voisines : elles vont ensemble. */
export const ANALOGOUS_MAX_DEG = 40;
/** À cet écart ou plus, elles sont complémentaires : elles vont ensemble aussi. */
export const COMPLEMENTARY_MIN_DEG = 150;
/** Points retirés à une tenue pour chaque paire de pièces dont les couleurs jurent. */
export const COLOR_CLASH_PENALTY = 2;

export type Hsl = { h: number; s: number; l: number };

/** Teinte (0–360), saturation et luminosité (0–1) d'une couleur #RRGGBB, null si elle est invalide. */
export function hexToHsl(color: string | null | undefined): Hsl | null {
  if (typeof color !== 'string') return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/** Teinte d'une couleur vive, ou null si elle est neutre (ou absente). */
export function vividHue(color: string | null | undefined): number | null {
  const hsl = hexToHsl(color);
  if (!hsl) return null;
  if (hsl.s < NEUTRAL_MAX_SATURATION) return null;
  if (hsl.l <= DARK_MAX_LIGHTNESS || hsl.l >= LIGHT_MIN_LIGHTNESS) return null;
  return hsl.h;
}

export function isNeutral(color: string | null | undefined): boolean {
  return vividHue(color) === null;
}

/** Écart entre deux teintes sur le cercle chromatique, de 0 à 180 degrés. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Vrai si deux teintes vives jurent : ni voisines, ni complémentaires. */
export function huesClash(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  const d = hueDistance(a, b);
  return d > ANALOGOUS_MAX_DEG && d < COMPLEMENTARY_MIN_DEG;
}

/** 'neutral' si l'une des deux est neutre, 'match' si elles vont ensemble, 'clash' si elles jurent. */
export function colorHarmony(
  a: string | null | undefined,
  b: string | null | undefined,
): 'neutral' | 'match' | 'clash' {
  const ha = vividHue(a);
  const hb = vividHue(b);
  if (ha === null || hb === null) return 'neutral';
  return huesClash(ha, hb) ? 'clash' : 'match';
}
