import { CATEGORIES } from '@/lib/types';
import type { Category, Item, Outfit, OutfitContext, Plan, Refusal } from '@/lib/types';
import { COLOR_CLASH_PENALTY, huesClash, vividHue } from './color';
import { hashSeed } from './hash';
import { categoryMap, lastWornDaysAgo, pairKey, recentPairs } from './history';
import {
  ACCESSORY_MIN_SCORE,
  HIDDEN_VARIETY_PENALTY,
  MAX_PIECES_PER_CATEGORY,
  MAX_SAME_TOP,
  RECENT_PAIR_DAYS,
  RECENT_PAIR_PENALTY,
  TOP_REPEAT_PENALTY,
  VARIETY_PENALTY,
  isRainy,
  jacketTargetWarmth,
  needsJacket,
  normalizeWarmth,
  pieceScore,
  referenceTemperature,
  targetWarmth,
} from './score';
import { outfitTitle } from './title';

// Choix des tenues (docs/conception.md §6) : fonction pure et déterministe, sans horloge ni hasard.
//
// 1. Pièces disponibles = pièces propres (dirty = false), notées une à une (chaleur, pluie, port récent).
// 2. « Cœurs » = pièces principales (haut + bas, ou robe) + veste si < 15 °C, pluie, ou matin
//    sous 12 °C. Sans veste (ou sans chaussures) disponible, la tenue s'en passe ; un haut sans bas
//    n'est jamais proposé. Les cœurs refusés sont écartés.
// 3. Chaque cœur reçoit ses meilleures chaussures et, s'il rapporte, son meilleur accessoire.
//    Score de la tenue = scores des pièces − couleurs qui jurent − duo haut + bas porté récemment.
// 4. Sélection gloutonne de 5 tenues : à chaque tour, la meilleure après pénalité de variété
//    (pièces que la silhouette montre, déjà proposées), jamais deux fois la même image tant qu'une
//    autre existe. Le score renvoyé est ce score de classement.
// 5. Une tenue prévue (outfit_plans) pour la date visée passe en premier, avec planned = true.

/** Pièces principales et veste : ce qu'enregistre un refus (docs/conception.md §6, §11, 4). */
export const CORE_CATEGORIES: readonly Category[] = ['haut', 'bas', 'robe', 'veste'];
/** Ordre d'affichage de `Outfit.item_ids`. */
export const DISPLAY_ORDER: readonly Category[] = ['veste', 'haut', 'robe', 'bas', 'chaussures', 'accessoire'];
/** Ordre des noms dans le titre : « Pull marine, jean brut et trench ». */
const TITLE_ORDER: readonly Category[] = ['haut', 'robe', 'bas', 'veste'];
/** Pièces du dessus : une seule est montrée par la silhouette (visibleTop). */
const UPPER_CATEGORIES: readonly Category[] = ['haut', 'robe', 'veste'];

/** Ids triés joints par « + » : clé d'une tenue (toutes ses pièces) ou d'un refus (son cœur). */
export function outfitKeyOf(ids: readonly string[]): string {
  return [...ids].sort().join('+');
}

/**
 * Pièces principales (haut, bas, robe) et veste d'une tenue, triées et sans doublon : ce
 * qu'enregistraient les refus de l'ancien format (toujours comparés, docs/conception.md §6). Les chaussures, les
 * accessoires et les ids absents de `items` sont ignorés.
 */
export function coreIdsOf(itemIds: readonly string[], items: readonly Item[]): string[] {
  const categoryOf = new Map<string, Category>();
  for (const item of Array.isArray(items) ? items : []) {
    if (item && typeof item.id === 'string') categoryOf.set(item.id, item.category);
  }
  const ids = new Set<string>();
  for (const id of Array.isArray(itemIds) ? itemIds : []) {
    const category = typeof id === 'string' ? categoryOf.get(id) : undefined;
    if (category && CORE_CATEGORIES.includes(category)) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * Ce que montre la silhouette d'une tenue, trié (docs/conception.md §6, §7) : la robe seule, sinon la veste (ou le
 * haut sans veste) et le bas. C'est ce qu'enregistre un refus aujourd'hui : « non » vaut pour ce
 * qu'on voit, quel que soit le haut caché sous la veste. Les ids absents de `items` sont ignorés.
 */
export function drawnIdsOf(itemIds: readonly string[], items: readonly Item[]): string[] {
  const byId = new Map<string, Item>();
  for (const item of Array.isArray(items) ? items : []) {
    if (item && typeof item.id === 'string') byId.set(item.id, item);
  }
  const pieces = (Array.isArray(itemIds) ? itemIds : [])
    .map((id) => (typeof id === 'string' ? byId.get(id) : undefined))
    .filter((piece): piece is Item => piece !== undefined);
  return [...new Set(drawnPieces(pieces).map((piece) => piece.id))].sort();
}

/**
 * Pièces propres de chaque catégorie, des mieux adaptées au jour visé aux moins adaptées : même
 * score que les tenues (chaleur, pluie, port récent), graine du jour puis id en cas d'égalité.
 * C'est l'ordre de défilement du miroir en composition libre (docs/conception.md §4).
 */
export function rankByCategory(items: readonly Item[], context: OutfitContext): Record<Category, Item[]> {
  return prepare(items, context).ranked;
}

// ---------- Préparation ----------

type Prepared = {
  date: string;
  jacketNeeded: boolean;
  /** Toutes les pièces valides (propres ou non), par id. */
  byId: Map<string, Item>;
  /** Pièces propres de chaque catégorie, de la meilleure à la moins bonne (score, graine, id). */
  ranked: Record<Category, Item[]>;
  scores: Map<string, number>;
  hues: Map<string, number | null>;
  pairs: Set<string>;
  refused: Set<string>;
  seed: string;
};

type Candidate = {
  pieces: Item[];
  coreKey: string;
  /**
   * Image de la silhouette (drawnPieces, ids triés) : deux tenues de même image se ressemblent à
   * l'écran. C'est aussi la clé d'un refus (docs/conception.md §6).
   */
  drawn: string;
  key: string;
  score: number;
  tie: number;
};

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isItem(value: unknown): value is Item {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Item>;
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.category === 'string' &&
    (CATEGORIES as readonly string[]).includes(item.category)
  );
}

/** Pièces valides, normalisées (chaleur 1–3, booléens stricts), triées par id, sans doublon. */
function normalizeItems(items: readonly Item[]): Item[] {
  const valid = (Array.isArray(items) ? items : []).filter(isItem).map((item) => ({
    ...item,
    name: typeof item.name === 'string' ? item.name : '',
    warmth: normalizeWarmth(item.warmth),
    rain_ok: item.rain_ok === true,
    dirty: item.dirty === true,
  }));
  valid.sort((a, b) => compareStrings(a.id, b.id));
  const seen = new Set<string>();
  return valid.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

/** Clés (ids triés) des refus valides. Les ids sont re-triés par prudence. */
function refusalKeys(refusals: readonly Refusal[] | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const refusal of Array.isArray(refusals) ? refusals : []) {
    if (!refusal || !Array.isArray(refusal.item_ids)) continue;
    const ids = refusal.item_ids.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length > 0) keys.add(outfitKeyOf(ids));
  }
  return keys;
}

function emptyBuckets(): Record<Category, Item[]> {
  return { haut: [], bas: [], robe: [], veste: [], chaussures: [], accessoire: [] };
}

function prepare(items: readonly Item[], context: OutfitContext): Prepared {
  const all = normalizeItems(items);
  const date = typeof context?.date === 'string' ? context.date : '';
  const weather = context?.weather ?? null;
  const history = Array.isArray(context?.history) ? context.history : [];
  const lastWorn = lastWornDaysAgo(history, date);
  const pieceContext = {
    target: targetWarmth(referenceTemperature(weather)),
    jacketTarget: jacketTargetWarmth(weather),
    rain: isRainy(weather),
    lastWorn,
  };
  const seed = `${date}|`;

  const scores = new Map<string, number>();
  const hues = new Map<string, number | null>();
  const ties = new Map<string, number>();
  const ranked = emptyBuckets();
  for (const item of all) {
    if (item.dirty) continue;
    scores.set(item.id, pieceScore(item, pieceContext));
    hues.set(item.id, vividHue(item.color));
    ties.set(item.id, hashSeed(seed + item.id));
    ranked[item.category].push(item);
  }
  for (const category of CATEGORIES) {
    ranked[category].sort(
      (a, b) =>
        scores.get(b.id)! - scores.get(a.id)! || ties.get(a.id)! - ties.get(b.id)! || compareStrings(a.id, b.id),
    );
  }

  return {
    date,
    jacketNeeded: needsJacket(weather),
    byId: new Map(all.map((item) => [item.id, item])),
    ranked,
    scores,
    hues,
    pairs: recentPairs(history, date, categoryMap(all), RECENT_PAIR_DAYS),
    refused: refusalKeys(context?.refusals),
    seed,
  };
}

// ---------- Score d'une tenue ----------

/** Ce que rapporte `piece` ajoutée à `base` : son score, moins couleurs qui jurent et duo récent. */
function gainOf(p: Prepared, piece: Item, base: readonly Item[]): number {
  let gain = p.scores.get(piece.id) ?? 0;
  const hue = p.hues.get(piece.id) ?? null;
  for (const other of base) {
    if (huesClash(hue, p.hues.get(other.id) ?? null)) gain -= COLOR_CLASH_PENALTY;
    if (piece.category === 'haut' && other.category === 'bas' && p.pairs.has(pairKey(piece.id, other.id))) {
      gain -= RECENT_PAIR_PENALTY;
    }
    if (piece.category === 'bas' && other.category === 'haut' && p.pairs.has(pairKey(other.id, piece.id))) {
      gain -= RECENT_PAIR_PENALTY;
    }
  }
  return gain;
}

function outfitScore(p: Prepared, pieces: readonly Item[]): number {
  let score = 0;
  for (let i = 0; i < pieces.length; i++) score += gainOf(p, pieces[i], pieces.slice(0, i));
  return score;
}

function coreOf(pieces: readonly Item[]): Item[] {
  return pieces.filter((piece) => CORE_CATEGORIES.includes(piece.category));
}

/**
 * Une tenue est écartée si un refus vaut exactement ce que montre sa silhouette (refus
 * d'aujourd'hui), ou exactement ses pièces principales et sa veste (ancien format, toujours valable).
 */
function isRefused(p: Prepared, pieces: readonly Item[]): boolean {
  return (
    p.refused.has(outfitKeyOf(drawnPieces(pieces).map((piece) => piece.id))) ||
    p.refused.has(outfitKeyOf(coreOf(pieces).map((piece) => piece.id)))
  );
}

function makeCandidate(p: Prepared, pieces: Item[]): Candidate {
  const key = outfitKeyOf(pieces.map((piece) => piece.id));
  return {
    pieces,
    coreKey: outfitKeyOf(coreOf(pieces).map((piece) => piece.id)),
    drawn: outfitKeyOf(drawnPieces(pieces).map((piece) => piece.id)),
    key,
    score: outfitScore(p, pieces),
    tie: hashSeed(p.seed + key),
  };
}

function compareCandidates(a: Candidate, b: Candidate): number {
  return b.score - a.score || a.tie - b.tie || compareStrings(a.key, b.key);
}

/** Meilleure pièce de `category` à ajouter à `base` (graine puis id en cas d'égalité), ou null. */
function bestAddition(p: Prepared, category: Category, base: readonly Item[]): { piece: Item; gain: number } | null {
  let best: { piece: Item; gain: number } | null = null;
  // `ranked` est déjà trié par score, graine et id : à gain égal, la première rencontrée gagne.
  for (const piece of p.ranked[category]) {
    const gain = gainOf(p, piece, base);
    if (!best || gain > best.gain) best = { piece, gain };
  }
  return best;
}

/** Ajoute au cœur ses meilleures chaussures et, s'il rapporte, son meilleur accessoire. */
function complete(p: Prepared, core: readonly Item[]): Item[] {
  const pieces = [...core];
  const shoes = bestAddition(p, 'chaussures', pieces);
  if (shoes) pieces.push(shoes.piece);
  const accessory = bestAddition(p, 'accessoire', pieces);
  if (accessory && accessory.gain > ACCESSORY_MIN_SCORE) pieces.push(accessory.piece);
  return pieces;
}

// ---------- Cœurs ----------

function shortlist(p: Prepared, category: Category): Item[] {
  return p.ranked[category].slice(0, MAX_PIECES_PER_CATEGORY);
}

/**
 * Pièces principales possibles : chaque haut avec chaque bas, et chaque robe (docs/conception.md §6 : une tenue
 * = (haut + bas) ou robe). Un haut sans bas, ou un bas sans haut, n'est pas une tenue : seules les
 * chaussures et la veste peuvent manquer.
 */
function mainOptions(p: Prepared): Item[][] {
  const options: Item[][] = [];
  for (const top of shortlist(p, 'haut')) {
    for (const bottom of shortlist(p, 'bas')) options.push([top, bottom]);
  }
  for (const dress of shortlist(p, 'robe')) options.push([dress]);
  return options;
}

/** Vestes possibles : toutes si une veste est nécessaire et qu'il y en a, sinon « pas de veste ». */
function jacketOptions(p: Prepared): (Item | null)[] {
  const jackets = shortlist(p, 'veste');
  return p.jacketNeeded && jackets.length > 0 ? jackets : [null];
}

function enumerateCandidates(p: Prepared): Candidate[] {
  const candidates: Candidate[] = [];
  const jackets = jacketOptions(p);
  for (const main of mainOptions(p)) {
    for (const jacket of jackets) {
      const core = jacket ? [...main, jacket] : main;
      if (isRefused(p, core)) continue;
      candidates.push(makeCandidate(p, complete(p, core)));
    }
  }
  return candidates.sort(compareCandidates);
}

// ---------- Tenue prévue ----------

/** (haut + bas) ou robe (docs/conception.md §6). */
function hasMain(pieces: readonly Item[]): boolean {
  const has = (category: Category) => pieces.some((piece) => piece.category === category);
  return has('robe') || (has('haut') && has('bas'));
}

/**
 * Tenue prévue pour la date visée (« Préparer demain »). Les pièces présentes et propres sont gardées.
 * Une pièce au sale est remplacée par la meilleure de sa catégorie. Une pièce absente de `items`
 * (supprimée, ou au sale si l'appelant n'envoie que les pièces propres) n'a plus de catégorie connue :
 * on complète alors ce qui manque à la tenue (pièces principales, chaussures, et veste si la météo
 * en demande une). Une tenue prévue sans veste alors que rien ne manque reste sans veste : c'était
 * voulu. Le plan est gardé même si son cœur a été refusé ; les remplacements, eux, évitent les refus.
 * Si aucune pièce du plan n'est encore disponible, ou si le haut ou le bas manquant n'a pas de
 * remplaçant (un haut seul n'est pas une tenue), il n'y a pas de tenue prévue (null).
 */
function resolvePlan(p: Prepared, plan: Plan | null | undefined): Candidate | null {
  if (!plan || typeof plan !== 'object' || plan.date !== p.date || !Array.isArray(plan.item_ids)) return null;

  const kept: Item[] = [];
  const toReplace = new Set<Category>();
  let unknown = 0;
  const seen = new Set<string>();
  for (const id of plan.item_ids) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const item = p.byId.get(id);
    if (!item) unknown += 1;
    else if (item.dirty) toReplace.add(item.category);
    else kept.push(item);
  }
  if (kept.length === 0) return null;

  const has = (category: Category) => kept.some((piece) => piece.category === category);
  const orNone = (list: Item[]): (Item | null)[] => (list.length > 0 ? list : [null]);

  let mains: (Item | null)[][];
  if (has('robe')) {
    mains = [[]];
  } else if (has('haut') || has('bas')) {
    // Le haut ou le bas manquant est remplacé ; sans remplaçant disponible, aucune option.
    mains = [];
    for (const top of has('haut') ? [null] : shortlist(p, 'haut')) {
      for (const bottom of has('bas') ? [null] : shortlist(p, 'bas')) mains.push([top, bottom]);
    }
  } else if (toReplace.has('robe') && shortlist(p, 'robe').length > 0) {
    mains = shortlist(p, 'robe').map((dress) => [dress]);
  } else {
    const all = mainOptions(p);
    const pairsOnly = all.filter((option) => option.every((piece) => piece.category !== 'robe'));
    const wantsPair = (toReplace.has('haut') || toReplace.has('bas')) && pairsOnly.length > 0;
    mains = wantsPair ? pairsOnly : all.length > 0 ? all : [[]];
  }

  const jacketSlotOpen = !has('veste') && (toReplace.has('veste') || (unknown > 0 && p.jacketNeeded));
  const jackets = jacketSlotOpen ? orNone(shortlist(p, 'veste')) : [null];

  let best: { pieces: Item[]; refused: boolean; score: number; tie: number; key: string } | null = null;
  for (const main of mains) {
    for (const jacket of jackets) {
      const additions = [...main, jacket].filter((piece): piece is Item => piece !== null);
      const pieces = [...kept, ...additions];
      const key = outfitKeyOf(pieces.map((piece) => piece.id));
      const option = {
        pieces,
        refused: isRefused(p, pieces),
        score: outfitScore(p, pieces),
        tie: hashSeed(p.seed + key),
        key,
      };
      const better =
        !best ||
        (option.refused !== best.refused
          ? !option.refused
          : option.score !== best.score
            ? option.score > best.score
            : option.tie !== best.tie
              ? option.tie < best.tie
              : option.key < best.key);
      if (better) best = option;
    }
  }
  if (!best) return null;

  const pieces = [...best.pieces];
  if (!has('chaussures') && (toReplace.has('chaussures') || unknown > 0)) {
    const shoes = bestAddition(p, 'chaussures', pieces);
    if (shoes) pieces.push(shoes.piece);
  }
  if (!has('accessoire') && toReplace.has('accessoire')) {
    const accessory = bestAddition(p, 'accessoire', pieces);
    if (accessory) pieces.push(accessory.piece);
  }
  if (!hasMain(pieces)) return null;
  return makeCandidate(p, pieces);
}

// ---------- Sélection variée ----------

/** Le dessus que montre la silhouette : la robe, sinon la veste, sinon le haut (lib/assembly/layers.ts). */
function visibleTop(pieces: readonly Item[]): Item | null {
  const of = (category: Category) => pieces.find((piece) => piece.category === category);
  return of('robe') ?? of('veste') ?? of('haut') ?? null;
}

/** Ce que montre la silhouette : la robe seule, sinon le dessus visible et le bas. */
function drawnPieces(pieces: readonly Item[]): Item[] {
  const top = visibleTop(pieces);
  if (top?.category === 'robe') return [top];
  const bottom = pieces.find((piece) => piece.category === 'bas');
  return [top, bottom].filter((piece): piece is Item => piece !== null && piece !== undefined);
}

/**
 * Pénalité de variété, sur ce que montre la silhouette (docs/conception.md §6) : le dessus visible et le bas
 * comptent pleinement, et le même dessus visible ne revient pas plus de MAX_SAME_TOP fois ; un haut
 * caché sous une veste (ou une veste sur une robe) compte moins.
 */
function varietyPenalty(candidate: Candidate, usage: ReadonlyMap<string, number>): number {
  const top = visibleTop(candidate.pieces);
  let penalty = 0;
  for (const piece of candidate.pieces) {
    const uses = usage.get(piece.id) ?? 0;
    if (uses === 0) continue;
    if (piece === top) {
      penalty += uses * VARIETY_PENALTY[piece.category];
      if (uses >= MAX_SAME_TOP) penalty += TOP_REPEAT_PENALTY;
    } else if (UPPER_CATEGORIES.includes(piece.category)) {
      penalty += uses * HIDDEN_VARIETY_PENALTY;
    } else {
      penalty += uses * VARIETY_PENALTY[piece.category];
    }
  }
  return penalty;
}

type Ranked = { candidate: Candidate; rank: number };

/**
 * Sélection gloutonne : à chaque tour, la meilleure tenue après pénalité de variété. Deux tenues ne
 * donnent jamais la même image (même dessus visible, même bas, ou même robe) tant qu'une autre existe.
 */
function selectVaried(candidates: Candidate[], chosen: Ranked[], limit: number): Ranked[] {
  const usage = new Map<string, number>();
  const shown = new Set<string>();
  const count = (candidate: Candidate) => {
    for (const piece of candidate.pieces) usage.set(piece.id, (usage.get(piece.id) ?? 0) + 1);
    shown.add(candidate.drawn);
  };
  chosen.forEach(({ candidate }) => count(candidate));

  const remaining = [...candidates];
  const result = [...chosen];
  while (result.length < limit && remaining.length > 0) {
    const fresh = remaining.some((candidate) => !shown.has(candidate.drawn));
    let bestIndex = -1;
    let bestRank = -Infinity;
    // `remaining` est trié (score, graine, clé) : à rang égal, le premier gagne.
    for (let i = 0; i < remaining.length; i++) {
      if (fresh && shown.has(remaining[i].drawn)) continue;
      const rank = remaining[i].score - varietyPenalty(remaining[i], usage);
      if (bestIndex < 0 || rank > bestRank) {
        bestRank = rank;
        bestIndex = i;
      }
    }
    const [picked] = remaining.splice(bestIndex, 1);
    result.push({ candidate: picked, rank: bestRank });
    count(picked);
  }
  return result;
}

// ---------- Sortie ----------

function byCategoryOrder(order: readonly Category[]) {
  return (a: Item, b: Item) => order.indexOf(a.category) - order.indexOf(b.category);
}

function toOutfit({ candidate, rank }: Ranked, planned: boolean): Outfit {
  // Array.prototype.sort est stable : dans une même catégorie, l'ordre d'origine est gardé.
  const displayed = [...candidate.pieces].sort(byCategoryOrder(DISPLAY_ORDER));
  const named = coreOf(candidate.pieces).sort(byCategoryOrder(TITLE_ORDER));
  return {
    key: candidate.key,
    item_ids: displayed.map((piece) => piece.id),
    core_ids: coreOf(candidate.pieces)
      .map((piece) => piece.id)
      .sort(),
    drawn_ids: drawnPieces(candidate.pieces)
      .map((piece) => piece.id)
      .sort(),
    title: outfitTitle(named.map((piece) => piece.name)),
    planned,
    score: rank,
  };
}

/** Jusqu'à `limit` tenues distinctes, de la meilleure à la moins bonne (tenue prévue en tête). */
export function buildOutfits(items: readonly Item[], context: OutfitContext, limit: number): Outfit[] {
  const max = Math.floor(limit);
  if (!(max > 0)) return [];
  const p = prepare(items, context);

  const planned = resolvePlan(p, context?.plan);
  const chosen: Ranked[] = planned ? [{ candidate: planned, rank: planned.score }] : [];
  // Après la tenue prévue, pas d'autre tenue avec les mêmes pièces principales et la même veste.
  const candidates = planned
    ? enumerateCandidates(p).filter((candidate) => candidate.coreKey !== planned.coreKey)
    : enumerateCandidates(p);

  return selectVaried(candidates, chosen, max).map((ranked, index) => toOutfit(ranked, planned !== null && index === 0));
}
