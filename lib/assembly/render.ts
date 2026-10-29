import type { ArmsUrls, AssemblyPhoto, Category, Item, Plan } from '@/lib/types';
// Imports relatifs (pas d'alias « @/ ») pour tout ce qui sert à l'exécution : les tests Playwright
// importent ce module pour calculer les pixels attendus.
import { assemblyLayers } from './layers';
import { FEATHER, alignLower, planSplit } from './plan';

// Rendu d'une silhouette assemblée (docs/conception.md §7) : ce qu'on dessine, d'où et où, calculé sans canvas.
// Le dessin lui-même est un fin adaptateur (draw.ts) qui suit ce plan à la lettre.
//
// Repère : la scène (« toile ») est commune à toutes les tenues. La photo du haut y est translatée
// d'un nombre entier de px pour que ses yeux tombent toujours en STAGE_EYE : la silhouette ne saute
// pas d'une tenue à l'autre. La photo du bas suit avec le décalage d'alignLower (px fractionnaires,
// comme le décalage bilinéaire de la préparation Python).
//
// Fondu : comme la préparation, alpha = w·A + (1 − w)·B, avec w = 1 jusqu'à FEATHER px au-dessus de
// la coupe, 0 à FEATHER px en dessous, linéaire entre les deux. Chaque calque est pondéré à part
// puis les deux sont additionnés (globalCompositeOperation « lighter ») : la somme des poids vaut 1.

/** Largeur de la scène, en px des photos (l'échelle reste 1 : l'appareil photo est fixe). */
export const STAGE_WIDTH = 800;
/** Hauteur de la scène : du dessus de la tête jusqu'au bas des photos (≈ 1 220 px sous les yeux). */
export const STAGE_HEIGHT = 1370;
/** Point de la scène où tombent les yeux de la photo du haut, pour toutes les tenues. */
export const STAGE_EYE: readonly [number, number] = [400, 150];

/** Pièces dessinées par la silhouette. Chaussures et accessoires ne le sont pas (docs/conception.md §7). */
export const DRAWN_CATEGORIES: readonly Category[] = ['veste', 'haut', 'robe', 'bas'];

export type Rect = { x: number; y: number; width: number; height: number };
/** Un appel drawImage : rectangle source (px de l'image) → rectangle de destination (px de la scène). */
export type DrawStep = { source: Rect; dest: Rect };
/**
 * Fondu vertical, en px de la scène : le calque du haut a un poids de 1 au centre de pixel `from`
 * et de 0 au centre de pixel `to` (dégradé linéaire de `from` à `to`) ; le calque du bas, l'inverse.
 */
export type Fade = { from: number; to: number };

/**
 * URL signées des couches des bras pliés d'une photo (AssemblyPhoto.arms : bras, corps, manches de
 * la photo), toutes présentes ; `sleeves` est null seulement si la photo n'a pas de couche de manches.
 */
export type LayerUrls = { arms: string; body: string; sleeves: string | null };

/**
 * Une photo de la silhouette : repères et URL de la photo détourée. `layers` est là si et
 * seulement si `photo.arms` l'est : une photo sans bras pliés, ou dont une couche n'est pas signée,
 * arrive sans `arms` ni `layers`, et se dessine comme avant les bras pliés.
 */
export type Picture = { photo: AssemblyPhoto; url: string; layers?: LayerUrls };

/** Ce qu'il faut pour dessiner une silhouette : repères et URL (signées) des images. */
export type SilhouetteSource =
  | { kind: 'single'; piece: Picture }
  | { kind: 'pair'; upper: Picture & { sleevesUrl: string | null }; lower: Picture };

export type RenderPlan = {
  width: number;
  height: number;
  /** Translation entière de la photo du haut (ou de la robe) sur la scène. */
  offset: { x: number; y: number };
  /** Ligne de coupe sur la scène (px), null pour une robe. */
  cut: number | null;
  /** Photo du haut (ou robe) : un ou deux drawImage, puis le fondu s'il y a un bas. */
  upper: { draws: DrawStep[]; fade: Fade | null };
  /** Photo du bas, décalée, avec le fondu inverse. */
  lower: { draw: DrawStep; fade: Fade } | null;
  /** Manches et mains du haut sous son ourlet, dessinées par-dessus (source-over). */
  sleeves: DrawStep | null;
};

/** Arrondi au pair le plus proche, comme round() de Python : la coupe tombe sur la même ligne. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

/** Translation entière qui pose les yeux de cette photo en STAGE_EYE. */
export function stageOffset(photo: AssemblyPhoto): { x: number; y: number } {
  return { x: Math.round(STAGE_EYE[0] - photo.eye[0]), y: Math.round(STAGE_EYE[1] - photo.eye[1]) };
}

function whole(photo: AssemblyPhoto, x: number, y: number): DrawStep {
  const [width, height] = photo.size;
  return { source: rect(0, 0, width, height), dest: rect(x, y, width, height) };
}

/** Rectangles source / destination, fondu et translation d'une silhouette. */
export function planRender(source: SilhouetteSource): RenderPlan {
  if (source.kind === 'single') {
    const photo = source.piece.photo;
    const offset = stageOffset(photo);
    return {
      width: STAGE_WIDTH,
      height: STAGE_HEIGHT,
      offset,
      cut: null,
      upper: { draws: [whole(photo, offset.x, offset.y)], fade: null },
      lower: null,
      sleeves: null,
    };
  }

  const upper = source.upper.photo;
  const lower = source.lower.photo;
  const { split, stretch } = planSplit(upper, lower);
  const { dx, dy } = alignLower(upper, lower, split);
  const offset = stageOffset(upper);
  const [width, height] = upper.size;

  // Ligne de coupe dans la photo du haut, arrondie comme la préparation (int(round(œil + s))).
  const cutRow = roundHalfEven(upper.eye[1] + split);
  // Le haut doit couvrir tout le fondu (jusqu'à FEATHER px sous la coupe), sinon la somme des
  // poids n'atteint pas 1 et une bande à moitié transparente apparaît.
  const fadeEnd = cutRow + FEATHER;

  const draws: DrawStep[] = [];
  const bandStart = stretch ? roundHalfEven(upper.eye[1] + stretch[0]) : null;
  const bandEnd = stretch ? roundHalfEven(upper.eye[1] + stretch[1]) : null;
  if (bandStart !== null && bandEnd !== null && cutRow > bandStart && bandEnd > bandStart) {
    // Ventre [début, fin[ étiré sur [début, coupe[, prolongé au même rapport jusqu'à la fin du
    // fondu : les lignes de la photo sous la coupe ne sont jamais reprises telles quelles.
    const ratio = (bandEnd - bandStart) / (cutRow - bandStart);
    const sourceEnd = bandStart + (fadeEnd - bandStart) * ratio;
    draws.push({ source: rect(0, 0, width, bandStart), dest: rect(offset.x, offset.y, width, bandStart) });
    draws.push({
      source: rect(0, bandStart, width, sourceEnd - bandStart),
      dest: rect(offset.x, offset.y + bandStart, width, fadeEnd - bandStart),
    });
  } else {
    const end = Math.min(fadeEnd, height);
    draws.push({ source: rect(0, 0, width, end), dest: rect(offset.x, offset.y, width, end) });
  }

  // Poids 1 au centre de la ligne coupe − FEATHER, 0 au centre de la ligne coupe + FEATHER :
  // w(ligne) = (coupe + FEATHER − ligne) / (2·FEATHER), la formule de la préparation.
  const cut = offset.y + cutRow;
  const fade: Fade = { from: cut - FEATHER + 0.5, to: cut + FEATHER + 0.5 };

  return {
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    offset,
    cut,
    upper: { draws, fade },
    lower: { draw: whole(lower, offset.x + dx, offset.y + dy), fade },
    sleeves: source.upper.sleevesUrl ? whole(upper, offset.x, offset.y) : null,
  };
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/** Poids du calque du haut pour la ligne `row` de la scène (évalué au centre du pixel). */
export function upperWeight(fade: Fade, row: number): number {
  return clamp01((fade.to - (row + 0.5)) / (fade.to - fade.from));
}

/** Poids du calque du bas pour la ligne `row` de la scène : toujours 1 − poids du haut. */
export function lowerWeight(fade: Fade, row: number): number {
  return clamp01((row + 0.5 - fade.from) / (fade.to - fade.from));
}

function layerUrls(picture: Picture): string[] {
  const layers = picture.layers;
  if (!layers) return [];
  return [layers.arms, layers.body, ...(layers.sleeves ? [layers.sleeves] : [])];
}

/**
 * URL des images d'une silhouette, dans l'ordre : haut (ou robe), bas, manches, puis les couches
 * des bras pliés du haut et du bas (bras, corps, manches de la photo) quand elles existent.
 */
export function silhouetteUrls(source: SilhouetteSource): string[] {
  if (source.kind === 'single') return [source.piece.url, ...layerUrls(source.piece)];
  return [
    source.upper.url,
    source.lower.url,
    ...(source.upper.sleevesUrl ? [source.upper.sleevesUrl] : []),
    ...layerUrls(source.upper),
    ...layerUrls(source.lower),
  ];
}

/**
 * Clé de cache d'un rendu : repères et URL (une URL signée change à chaque lecture), couches des
 * bras pliés comprises. Sans bras pliés, la source (donc la clé) est celle d'avant les bras pliés.
 */
export function silhouetteKey(source: SilhouetteSource): string {
  return JSON.stringify(source);
}

/** Pièce avec les URL signées de sa photo détourée, de ses manches et des couches des bras pliés. */
export type SignedItem = Item & { cutout_url: string | null; sleeves_url?: string | null; arms_urls?: ArmsUrls };

/**
 * Photo de la silhouette avec les URL de ses couches. Si une couche que la photo annonce n'est pas
 * signée, les bras pliés sont retirés : la photo se dessine alors comme avant les bras pliés, au lieu de
 * ne pas se dessiner du tout (contrairement aux manches, sans lesquelles le rendu serait faux).
 */
function picture(photo: AssemblyPhoto, url: string, urls: ArmsUrls | undefined): Picture {
  const arms = photo.arms;
  if (!arms) return { photo, url };
  if (urls?.arms && urls.body && (arms.sleeves === null || urls.sleeves)) {
    return { photo, url, layers: { arms: urls.arms, body: urls.body, sleeves: arms.sleeves ? urls.sleeves : null } };
  }
  const bare: AssemblyPhoto = { ...photo };
  delete bare.arms;
  return { photo: bare, url };
}

/**
 * Silhouette d'une tenue, ou null si elle ne s'assemble pas (docs/conception.md §4 : pièces empilées ou noms) :
 * pièce sans photo portée, URL absente, ou manches prévues mais non signées.
 */
export function silhouetteSource<T extends SignedItem>(
  itemIds: readonly string[],
  itemsById: ReadonlyMap<string, T>,
): SilhouetteSource | null {
  const layers = assemblyLayers(itemIds, itemsById);
  if (!layers) return null;
  if (layers.kind === 'single') {
    const { piece } = layers;
    return piece.cutout_url
      ? { kind: 'single', piece: picture(piece.assembly.photo, piece.cutout_url, piece.arms_urls) }
      : null;
  }
  const { upper, lower } = layers;
  if (!upper.cutout_url || !lower.cutout_url) return null;
  const sleevesUrl = upper.assembly.sleevesPath ? (upper.sleeves_url ?? null) : null;
  if (upper.assembly.sleevesPath && !sleevesUrl) return null;
  return {
    kind: 'pair',
    upper: { ...picture(upper.assembly.photo, upper.cutout_url, upper.arms_urls), sleevesUrl },
    lower: picture(lower.assembly.photo, lower.cutout_url, lower.arms_urls),
  };
}

export function isDrawn(item: Pick<Item, 'category'>): boolean {
  return DRAWN_CATEGORIES.includes(item.category);
}

/**
 * Entrées de generateOutfits sans chaussures ni accessoires : la silhouette ne les dessine pas,
 * une tenue ne doit donc pas les proposer. Les pièces non dessinées d'un plan en sont retirées
 * (sinon elles compteraient comme des pièces disparues à remplacer).
 */
export function drawnOutfitInputs<T extends Item>(
  items: readonly T[],
  plan: Plan | null,
  allItems: readonly Item[] = items,
): { items: T[]; plan: Plan | null } {
  const undrawn = new Set(allItems.filter((item) => !isDrawn(item)).map((item) => item.id));
  return {
    items: items.filter(isDrawn),
    plan: plan ? { ...plan, item_ids: plan.item_ids.filter((id) => !undrawn.has(id)) } : null,
  };
}
