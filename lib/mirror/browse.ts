import { drawnOutfitInputs } from '@/lib/assembly/render';
import { coreIdsOf, drawnIdsOf, outfitKeyOf, outfitTitle, rankByCategory } from '@/lib/outfits';
import type { MirrorItem, MirrorPayload, Outfit, Refusal } from '@/lib/types';
import { buildDeck, sameIds, sortedIds } from './deck';

// Composition libre sur le miroir (docs/conception.md §4) : on change soi-même le
// haut (← →), le bas (↑ ↓) et la veste (une touche), sans limite de propositions. Fonctions pures.

/** Ce qu'on peut parcourir : les hauts (puis les robes), les bas, les vestes, dans l'ordre du jour. */
export type Browse = {
  /** Hauts puis robes, des mieux adaptés aux moins adaptés. */
  tops: MirrorItem[];
  bottoms: MirrorItem[];
  jackets: MirrorItem[];
  /** Point de départ : la tenue prévue, sinon la meilleure tenue de generateOutfits. */
  start: Selection;
  /**
   * Pièces de la tenue prévue d'où vient le point de départ, ou null. Une pièce du plan passée au
   * sale est remplacée (docs/conception.md §6) : le départ reste « Prévue » tant que ce plan ne change pas.
   */
  startPlan: string[] | null;
};

/** Index dans les listes de Browse. `jacket` : 0 = sans veste, i > 0 = jackets[i - 1]. */
export type Selection = { top: number; bottom: number; jacket: number };

export const EMPTY_SELECTION: Selection = { top: 0, bottom: 0, jacket: 0 };

function wrap(index: number, length: number): number {
  return length > 0 ? ((index % length) + length) % length : 0;
}

function topOf(browse: Browse, selection: Selection): MirrorItem | undefined {
  return browse.tops[selection.top];
}

/** Avec une robe, le bas ne compte pas : elle se montre seule. */
export function isDress(browse: Browse, selection: Selection): boolean {
  return topOf(browse, selection)?.category === 'robe';
}

/** Pièces affichées, dans l'ordre d'affichage : veste, haut ou robe, bas. */
export function composedIds(browse: Browse, selection: Selection): string[] {
  const jacket = selection.jacket > 0 ? browse.jackets[selection.jacket - 1] : undefined;
  const top = topOf(browse, selection);
  const bottom = isDress(browse, selection) ? undefined : browse.bottoms[selection.bottom];
  return [jacket, top, bottom].filter((item): item is MirrorItem => item !== undefined).map((item) => item.id);
}

/** Position de ces pièces dans les listes ; ce qui manque garde la valeur de `fallback`. */
export function selectionOf(itemIds: readonly string[], browse: Browse, fallback: Selection = EMPTY_SELECTION): Selection {
  const index = (list: readonly MirrorItem[]) => list.findIndex((item) => itemIds.includes(item.id));
  const top = index(browse.tops);
  const bottom = index(browse.bottoms);
  const jacket = index(browse.jackets);
  return {
    top: top >= 0 ? top : fallback.top,
    bottom: bottom >= 0 ? bottom : fallback.bottom,
    jacket: jacket >= 0 ? jacket + 1 : itemIds.length > 0 ? 0 : fallback.jacket,
  };
}

/**
 * Listes à parcourir pour le jour visé (même score que les tenues, pièces au sale exclues, pas de
 * chaussures ni d'accessoires puisque la silhouette ne les dessine pas), et le point de départ.
 * Une tenue est (haut + bas) ou robe (docs/conception.md §6) : sans bas, les hauts ne sont pas proposés ; sans
 * haut, les bas non plus. Sans haut ni robe, rien à parcourir (« Aucune tenue disponible »).
 */
export function buildBrowse(payload: MirrorPayload, localRefusals: readonly Refusal[]): Browse {
  const drawn = drawnOutfitInputs(payload.items, payload.plan);
  const ranked = rankByCategory(drawn.items, {
    date: payload.targetDate,
    weather: payload.weather,
    history: payload.history,
    refusals: payload.refusals,
    plan: drawn.plan,
  }) as unknown as Record<string, MirrorItem[]>;
  const bas = ranked.bas ?? [];
  const haut = bas.length > 0 ? (ranked.haut ?? []) : [];
  const tops = [...haut, ...(ranked.robe ?? [])];
  const lists = {
    tops,
    bottoms: haut.length > 0 ? bas : [],
    jackets: tops.length > 0 ? (ranked.veste ?? []) : [],
    start: EMPTY_SELECTION,
    startPlan: null,
  };
  const first = buildDeck(payload, localRefusals)[0];
  return {
    ...lists,
    start: first ? selectionOf(first.item_ids, lists) : EMPTY_SELECTION,
    startPlan: first?.planned && payload.plan ? payload.plan.item_ids : null,
  };
}

export function moveTop(browse: Browse, selection: Selection, step: 1 | -1): Selection {
  return { ...selection, top: wrap(selection.top + step, browse.tops.length) };
}

/** ↑ ↓ : sans effet avec une robe, ou sans bas. */
export function moveBottom(browse: Browse, selection: Selection, step: 1 | -1): Selection {
  if (isDress(browse, selection) || browse.bottoms.length === 0) return selection;
  return { ...selection, bottom: wrap(selection.bottom + step, browse.bottoms.length) };
}

/** Sans veste, puis chaque veste, puis de nouveau sans veste. */
export function cycleJacket(browse: Browse, selection: Selection): Selection {
  return { ...selection, jacket: wrap(selection.jacket + 1, browse.jackets.length + 1) };
}

function allItems(browse: Browse): MirrorItem[] {
  return [...browse.tops, ...browse.bottoms, ...browse.jackets];
}

/** Clé de ce que montre la silhouette (veste ou haut, et bas ; ou la robe seule). */
function drawnKey(browse: Browse, selection: Selection): string {
  return outfitKeyOf(drawnIdsOf(composedIds(browse, selection), allItems(browse)));
}

/**
 * La tenue a changé, mais pas ce que montre la silhouette : seule la pièce cachée a changé (le
 * haut sous une veste, ou la veste sur une robe). La légende « Sous la veste : … » ou « Par-dessus :
 * … » est alors le seul changement visible (docs/conception.md §4).
 */
export function changesOnlyHidden(browse: Browse, before: Selection, after: Selection): boolean {
  return (
    outfitKeyOf(composedIds(browse, before)) !== outfitKeyOf(composedIds(browse, after)) &&
    drawnKey(browse, before) === drawnKey(browse, after)
  );
}

/**
 * Après « non » : montrer autre chose, c'est-à-dire une autre image. Une veste cache le haut :
 * on passe au bas suivant, sinon à la veste suivante (ou sans veste) ; sinon (haut visible, ou
 * robe), au haut suivant, sinon au bas suivant, sinon à une veste (un seul haut et un seul bas).
 * Si rien ne change l'image (une robe seule), la sélection reste.
 */
export function afterRefusal(browse: Browse, selection: Selection): Selection {
  const jacketShown = selection.jacket > 0 && !isDress(browse, selection);
  const candidates = jacketShown
    ? [moveBottom(browse, selection, 1), cycleJacket(browse, selection)]
    : [moveTop(browse, selection, 1), moveBottom(browse, selection, 1), cycleJacket(browse, selection)];
  const refused = drawnKey(browse, selection);
  return candidates.find((candidate) => drawnKey(browse, candidate) !== refused) ?? selection;
}

/** Les compositions d'une touche de distance : à préparer d'avance (docs/conception.md §7 bis). */
export function neighbours(browse: Browse, selection: Selection): Selection[] {
  const candidates = [
    moveTop(browse, selection, 1),
    moveTop(browse, selection, -1),
    moveBottom(browse, selection, 1),
    moveBottom(browse, selection, -1),
    cycleJacket(browse, selection),
  ];
  const seen = new Set([outfitKeyOf(composedIds(browse, selection))]);
  return candidates.filter((candidate) => {
    const key = outfitKeyOf(composedIds(browse, candidate));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** La tenue affichée, sous la forme d'une Outfit (titre, cœur, ce que montre la silhouette). */
export function composedOutfit(browse: Browse, selection: Selection, payload: MirrorPayload): Outfit | null {
  // (Haut + bas) ou robe (docs/conception.md §6) : jamais une pièce seule, ni une veste sur un bas.
  if (!topOf(browse, selection) || (!isDress(browse, selection) && !browse.bottoms[selection.bottom])) return null;
  const ids = composedIds(browse, selection);
  const pieces = ids.map((id) => allItems(browse).find((item) => item.id === id)!);
  const plan = payload.plan && payload.plan.date === payload.targetDate ? payload.plan : null;
  // La tenue prévue telle quelle, ou le point de départ qui la complète (pièce passée au sale).
  const planned = Boolean(
    plan &&
      (sameIds(drawnPlanIds(plan.item_ids, payload.items), ids) ||
        (browse.startPlan !== null && sameIds(plan.item_ids, browse.startPlan) && sameIds(ids, composedIds(browse, browse.start)))),
  );
  // Titre : haut ou robe, bas, puis veste (comme generateOutfits).
  const order = ['haut', 'robe', 'bas', 'veste'];
  const named = [...pieces].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  return {
    key: outfitKeyOf(ids),
    item_ids: ids,
    core_ids: coreIdsOf(ids, pieces),
    drawn_ids: drawnIdsOf(ids, pieces),
    title: outfitTitle(named.map((piece) => piece.name)),
    planned,
    score: 0,
  };
}

/**
 * Pièces d'une tenue enregistrée (plan, tenue portée) que le miroir compose : sans chaussures ni
 * accessoires, triées. Une pièce absente des données (au sale) n'y est plus.
 */
export function drawnPlanIds(itemIds: readonly string[], items: readonly MirrorItem[]): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return sortedIds(itemIds.filter((id) => ['haut', 'robe', 'bas', 'veste'].includes(byId.get(id)?.category ?? '')));
}

const refusalKeyCache = new WeakMap<readonly Refusal[], Set<string>>();

/** Clés des refus, calculées une fois par liste : le test se fait à chaque touche (« Écartée »). */
function refusalKeys(refusals: readonly Refusal[]): Set<string> {
  let keys = refusalKeyCache.get(refusals);
  if (!keys) {
    keys = new Set(refusals.map((refusal) => outfitKeyOf(refusal.item_ids)));
    refusalKeyCache.set(refusals, keys);
  }
  return keys;
}

/** Combinaison déjà refusée : ce que montre sa silhouette, ou (refus de l'ancien format) son cœur. */
export function isRefused(outfit: Outfit, refusals: readonly Refusal[]): boolean {
  const keys = refusalKeys(refusals);
  return keys.has(outfitKeyOf(outfit.drawn_ids)) || keys.has(outfitKeyOf(outfit.core_ids));
}

/**
 * Pièces à précharger, les plus proches de la sélection d'abord, dans l'ordre où elle les fera
 * défiler (docs/conception.md §7 bis) : haut, bas et veste à une touche, puis à deux touches, etc.
 */
export function itemsByProximity(browse: Browse, selection: Selection): MirrorItem[] {
  const lists: Array<[readonly MirrorItem[], number]> = [
    [browse.tops, selection.top],
    [browse.bottoms, selection.bottom],
    [browse.jackets, Math.max(0, selection.jacket - 1)],
  ];
  const longest = Math.max(0, ...lists.map(([list]) => list.length));
  const ordered: MirrorItem[] = [];
  const seen = new Set<string>();
  for (let distance = 0; distance < longest; distance++) {
    for (const [list, at] of lists) {
      for (const index of distance === 0 ? [at] : [at + distance, at - distance]) {
        const item = list[wrap(index, list.length)];
        if (item && !seen.has(item.id)) {
          seen.add(item.id);
          ordered.push(item);
        }
      }
    }
  }
  return ordered;
}
