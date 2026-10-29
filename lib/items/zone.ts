import { centerAt } from '@/lib/assembly/plan';
import type { AssemblyPhoto, Category, Item } from '@/lib/types';

// Vignette d'une pièce assemblée (docs/conception.md §4, écran 2) : la zone de sa photo portée détourée qui la
// montre. Fonctions pures ; le rendu se fait en CSS (components/wardrobe/item-image.tsx), sans canvas.
// Les lignes du manifeste sont en px sous le milieu des yeux ; la zone est en px de la photo.

/** Haut de la tête, au-dessus du milieu des yeux. */
export const HEAD_ABOVE_EYES = 170;
/** Marge sous le point le plus bas d'un haut (topLow). */
export const TOP_HEM_MARGIN = 12;
/** Bas de la zone d'un haut plus long que la zone mesurée (topLow null), sous les yeux. */
export const TOP_FALLBACK_BELOW_EYES = 620;
/** Marge au-dessus du bord supérieur d'un bas (bottomHigh). */
export const WAIST_MARGIN = 8;
/** Haut de la zone d'un bas dont la ceinture est cachée (bottomHigh null), sous les yeux. */
export const BOTTOM_FALLBACK_BELOW_EYES = 450;

export type Zone = { x: number; y: number; width: number; height: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function whole(photo: AssemblyPhoto): Zone {
  return { x: 0, y: 0, width: photo.size[0], height: photo.size[1] };
}

/**
 * Bande horizontale [top, bottom] recadrée en carré autour de `centerX` (la personne est au milieu
 * d'une photo plus large qu'elle), bornée à la photo. Bande vide : la photo entière.
 */
function band(photo: AssemblyPhoto, top: number, bottom: number, centerX: number): Zone {
  const [width, height] = photo.size;
  const y = clamp(Math.round(top), 0, height);
  const end = clamp(Math.round(bottom), 0, height);
  if (end - y < 1) return whole(photo);
  const side = Math.min(width, end - y);
  const x = clamp(Math.round(centerX - side / 2), 0, width - side);
  return { x, y, width: side, height: end - y };
}

/**
 * Zone qui montre la pièce : haut ou veste, du haut de la tête jusque sous l'ourlet ; bas, de la
 * ceinture au bas de la photo ; robe, chaussures et accessoire, la photo entière.
 */
export function itemZone(category: Category, photo: AssemblyPhoto): Zone {
  const eyeY = photo.eye[1];
  if (category === 'haut' || category === 'veste') {
    const below = photo.topLow === null ? TOP_FALLBACK_BELOW_EYES : photo.topLow + TOP_HEM_MARGIN;
    return band(photo, eyeY - HEAD_ABOVE_EYES, eyeY + below, photo.eye[0]);
  }
  if (category === 'bas') {
    const above = photo.bottomHigh === null ? BOTTOM_FALLBACK_BELOW_EYES : photo.bottomHigh - WAIST_MARGIN;
    const top = eyeY + above;
    const middleRow = (top + photo.size[1]) / 2 - eyeY;
    return band(photo, top, photo.size[1], centerAt(photo, middleRow));
  }
  return whole(photo);
}

/** Zone d'une pièce et taille de sa photo portée, en px. */
export type PhotoZone = { zone: Zone; size: readonly [number, number] };

/** Zone à montrer pour une pièce assemblée, ou null (pièce sans photo portée). */
export function photoZone(item: Pick<Item, 'category' | 'assembly'>): PhotoZone | null {
  const photo = item.assembly?.photo;
  return photo ? { zone: itemZone(item.category, photo), size: photo.size } : null;
}

const percent = (value: number) => `${Math.round(value * 10000) / 100}%`;

export type ZoneLayout = {
  /** Cadre au rapport de la zone, centré dans une vignette carrée. */
  frame: { width: string; height: string };
  /** Photo entière, placée et mise à l'échelle dans le cadre. */
  image: { left: string; top: string; width: string; height: string };
};

/** Pourcentages CSS qui n'affichent que `zone` dans une vignette carrée (rendu en `contain`). */
export function zoneLayout(zone: Zone, size: readonly [number, number]): ZoneLayout {
  const landscape = zone.width >= zone.height;
  return {
    frame: landscape
      ? { width: '100%', height: percent(zone.height / zone.width) }
      : { width: percent(zone.width / zone.height), height: '100%' },
    image: {
      left: percent(-zone.x / zone.width),
      top: percent(-zone.y / zone.height),
      width: percent(size[0] / zone.width),
      height: percent(size[1] / zone.height),
    },
  };
}
