import { upperBodyMayBeDrawn } from '@/lib/assembly/arms-plan';
import { drawnOutfitInputs, silhouetteKey, silhouetteSource, type SilhouetteSource } from '@/lib/assembly/render';
import { coreIdsOf, drawnIdsOf, generateOutfits } from '@/lib/outfits';
import type { Category, MirrorItem, MirrorPayload, Outfit, Refusal } from '@/lib/types';

// Les tenues affichées par le miroir, calculées dans le navigateur à partir des données reçues
// (docs/conception.md §6, §7 bis). Fonctions pures.

export function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = sortedIds(a);
  const right = sortedIds(b);
  return left.every((id, index) => id === right[index]);
}

/** Refus du serveur et refus faits sur la tablette, sans doublon. */
export function mergeRefusals(server: readonly Refusal[], local: readonly Refusal[]): Refusal[] {
  const merged: Refusal[] = [];
  for (const refusal of [...server, ...local]) {
    if (!merged.some((existing) => sameIds(existing.item_ids, refusal.item_ids))) {
      merged.push({ item_ids: sortedIds(refusal.item_ids) });
    }
  }
  return merged;
}

/**
 * Ce qu'enregistre le refus d'une tenue : ce que montre sa silhouette (docs/conception.md §6, §11, 4
 * révisée). `drawn_ids` du contrat, ou recalculé par lib/outfits d'après les catégories.
 */
export function refusalIds(outfit: Outfit, itemsById: ReadonlyMap<string, MirrorItem>): string[] {
  if (outfit.drawn_ids?.length > 0) return sortedIds(outfit.drawn_ids);
  return drawnIdsOf(outfit.item_ids, [...itemsById.values()]);
}

/** Pièces principales et veste : ce qu'enregistraient les refus de l'ancien format, encore valables. */
function coreIds(outfit: Outfit, itemsById: ReadonlyMap<string, MirrorItem>): string[] {
  if (outfit.core_ids.length > 0) return sortedIds(outfit.core_ids);
  return coreIdsOf(outfit.item_ids, [...itemsById.values()]);
}

/** Tenues qu'aucun refus ne vise : ni ce que montre leur silhouette, ni (anciens refus) leur cœur. */
export function withoutRefused(
  outfits: readonly Outfit[],
  refusals: readonly Refusal[],
  itemsById: ReadonlyMap<string, MirrorItem>,
): Outfit[] {
  if (refusals.length === 0) return [...outfits];
  return outfits.filter((outfit) => {
    const drawn = refusalIds(outfit, itemsById);
    const core = coreIds(outfit, itemsById);
    return !refusals.some((refusal) => sameIds(refusal.item_ids, drawn) || sameIds(refusal.item_ids, core));
  });
}

export function itemsById(items: readonly MirrorItem[]): Map<string, MirrorItem> {
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * Les tenues du jour visé, avec les refus faits sur la tablette et pas encore relus. Chaussures et
 * accessoires ne sont pas proposés : la silhouette assemblée ne les dessine pas (docs/conception.md §7).
 */
export function buildDeck(payload: MirrorPayload, localRefusals: readonly Refusal[]): Outfit[] {
  const refusals = mergeRefusals(payload.refusals, localRefusals);
  const drawn = drawnOutfitInputs(payload.items, payload.plan);
  const outfits = generateOutfits(drawn.items, {
    date: payload.targetDate,
    weather: payload.weather,
    history: payload.history,
    refusals,
    plan: drawn.plan,
  });
  return withoutRefused(outfits, refusals, itemsById(payload.items));
}

/** Ce haut (ou cette veste) étire-t-il sa bande de ventre, bras nus, avec l'un de ces bas ? */
function upperBodyUsed(upper: MirrorItem, bottoms: readonly MirrorItem[]): boolean {
  return bottoms.some((bottom) => {
    const pair = new Map([
      [upper.id, upper],
      [bottom.id, bottom],
    ]);
    const source = silhouetteSource([upper.id, bottom.id], pair);
    return source !== null && upperBodyMayBeDrawn(source);
  });
}

/**
 * Images d'une pièce que le miroir peut dessiner, pour le préchargement en arrière-plan : photo
 * détourée, manches de la pièce (rendu actuel, et repli s'il manque une couche) et, avec les bras
 * pliés (docs/conception.md §7), les couches que ses paires avec `bottoms` (les bas du jeu) dessinent : un bas
 * prête ses bras et son corps ; un haut ou une veste ses manches de la photo (manches longues) et
 * son corps seulement si une paire étire sa bande de ventre, bras nus (upperBodyMayBeDrawn). La
 * couche bras d'un haut et les manches de la photo d'un bas ne servent jamais.
 */
export function itemImageUrls(item: MirrorItem, bottoms: readonly MirrorItem[]): string[] {
  const urls = [item.cutout_url, item.sleeves_url];
  const layers = item.assembly?.photo.arms ? item.arms_urls : undefined;
  if (layers && item.category === 'bas') urls.push(layers.arms, layers.body);
  if (layers && (item.category === 'haut' || item.category === 'veste')) {
    if (upperBodyUsed(item, bottoms)) urls.push(layers.body);
    urls.push(layers.sleeves);
  }
  return urls.filter((url): url is string => Boolean(url));
}

/**
 * URL des détourages et des manches à précharger pour ces tenues, sans doublon, dans l'ordre
 * d'affichage. Les couches des bras pliés n'y sont pas : le pré-rendu de chaque silhouette charge
 * exactement celles que son plan dessine (prepareSilhouette, lib/assembly/draw.ts).
 */
export function outfitImageUrls(outfits: readonly Outfit[], items: readonly MirrorItem[]): string[] {
  const byId = itemsById(items);
  const urls: string[] = [];
  for (const outfit of outfits) {
    for (const id of outfit.item_ids) {
      const item = byId.get(id);
      for (const url of [item?.cutout_url, item?.sleeves_url]) {
        if (url && !urls.includes(url)) urls.push(url);
      }
    }
  }
  return urls;
}

/** Silhouette assemblée d'une tenue, ou null si elle s'affiche pièce par pièce (docs/conception.md §4). */
export function outfitSilhouette(outfit: Outfit, byId: ReadonlyMap<string, MirrorItem>): SilhouetteSource | null {
  return silhouetteSource(outfit.item_ids, byId);
}

/** Silhouettes à pré-rendre pour ces tenues, sans doublon. */
export function outfitSilhouettes(outfits: readonly Outfit[], items: readonly MirrorItem[]): SilhouetteSource[] {
  const byId = itemsById(items);
  const sources = new Map<string, SilhouetteSource>();
  for (const outfit of outfits) {
    const source = outfitSilhouette(outfit, byId);
    if (source) sources.set(silhouetteKey(source), source);
  }
  return [...sources.values()];
}

/** Disposition d'une tenue, de haut en bas : veste et haut (ou robe), bas, chaussures, accessoires. */
export type OutfitLayout = {
  upper: MirrorItem[];
  lower: MirrorItem[];
  feet: MirrorItem[];
  extras: MirrorItem[];
};

const ROW_OF: Record<Category, keyof OutfitLayout> = {
  veste: 'upper',
  haut: 'upper',
  robe: 'upper',
  bas: 'lower',
  chaussures: 'feet',
  accessoire: 'extras',
};

const UPPER_ORDER: Record<Category, number> = {
  veste: 0,
  haut: 1,
  robe: 1,
  bas: 2,
  chaussures: 3,
  accessoire: 4,
};

export function outfitLayout(outfit: Outfit, byId: ReadonlyMap<string, MirrorItem>): OutfitLayout {
  const layout: OutfitLayout = { upper: [], lower: [], feet: [], extras: [] };
  for (const id of outfit.item_ids) {
    const item = byId.get(id);
    const row = item ? ROW_OF[item.category] : undefined;
    if (item && row) layout[row].push(item);
  }
  layout.upper.sort((a, b) => UPPER_ORDER[a.category] - UPPER_ORDER[b.category]);
  return layout;
}
