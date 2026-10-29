// Vêtements foncés derrière le miroir sans tain (docs/conception.md §12) : un jean brut ou un pull marine
// disparaissent. On les éclaircit avec un filtre CSS calculé d'après `items.color`.
// Pas de contour lumineux ni d'ombre : seulement brightness() et contrast(), qui ne touchent
// pas à la transparence du détourage.

/** En dessous de cette luminance relative (WCAG, 0 à 1), la pièce est éclaircie. #616161 ≈ 0,12. */
export const DARK_LUMINANCE_THRESHOLD = 0.12;
/** Éclaircissement maximal, pour une pièce noire. */
export const MAX_BRIGHTNESS = 1.9;
/** Contraste minimal, pour une pièce noire : relève les noirs, que brightness() seul laisse noirs. */
export const MIN_CONTRAST = 0.75;

const HEX_COLOR = /^#([0-9a-f]{6})$/i;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG d'une couleur #RRGGBB, ou null si la couleur est absente ou invalide. */
export function relativeLuminance(color: string | null | undefined): number | null {
  const match = color ? HEX_COLOR.exec(color.trim()) : null;
  if (!match) return null;
  const hex = match[1];
  const r = channel(parseInt(hex.slice(0, 2), 16));
  const g = channel(parseInt(hex.slice(2, 4), 16));
  const b = channel(parseInt(hex.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Filtre CSS pour une pièce de cette couleur, ou null si elle est assez claire (ou de couleur
 * inconnue). Plus la pièce est foncée, plus elle est éclaircie.
 */
export function brightnessFilter(color: string | null | undefined): string | null {
  const luminance = relativeLuminance(color);
  if (luminance === null || luminance >= DARK_LUMINANCE_THRESHOLD) return null;
  const strength = (DARK_LUMINANCE_THRESHOLD - luminance) / DARK_LUMINANCE_THRESHOLD;
  const contrast = round(1 - strength * (1 - MIN_CONTRAST));
  const brightness = round(1 + strength * (MAX_BRIGHTNESS - 1));
  return `contrast(${contrast}) brightness(${brightness})`;
}

/**
 * Silhouette assemblée (docs/conception.md §7, §12) : éclaircissement léger et constant de toute l'image, pour
 * que les vêtements foncés restent visibles derrière le miroir. Un filtre brightness() laisse le
 * noir noir et la transparence transparente : aucun halo ni fond allumé. [À mesurer] derrière la vitre.
 */
export const SILHOUETTE_BRIGHTNESS = 1.2;

export function silhouetteFilter(): string {
  return `brightness(${SILHOUETTE_BRIGHTNESS})`;
}
