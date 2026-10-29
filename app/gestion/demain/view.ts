import { armsLayerPaths, armsLayerUrls } from '@/lib/assembly/arms-files';
import { silhouetteSource, type SignedItem, type SilhouetteSource } from '@/lib/assembly/render';
import { photoZone, type PhotoZone } from '@/lib/items/zone';
import { MAX_OUTFITS, outfitCaption, outfitTitle } from '@/lib/outfits';
import type { Category, DayWeather, Item, Outfit, Plan } from '@/lib/types';
import { weatherSummary } from '@/lib/weather/format';

// « Préparer demain » sur le téléphone (docs/conception.md §4) : ce que l'écran affiche, calculé sans réseau.

/** `zone` : pièce photographiée portée, seule la zone de la photo qui la montre est affichée. */
export type PreviewPiece = {
  id: string;
  name: string;
  category: Category;
  cutoutUrl: string | null;
  zone: PhotoZone | null;
};

export type PreviewOutfit = {
  key: string;
  /** Titre simple (outfitTitle) : nom de la silhouette pour un lecteur d'écran. */
  title: string;
  item_ids: string[];
  pieces: PreviewPiece[];
  /** Silhouette assemblée (docs/conception.md §7), ou null : l'aperçu se fait alors pièce par pièce. */
  silhouette: SilhouetteSource | null;
  /** Légende, comme sur le miroir : ce que l'on voit, une pièce par ligne, puis la pièce cachée. */
  caption: { lines: string[]; note: string | null };
};

export type TomorrowView = {
  date: string; // demain, AAAA-MM-JJ dans profile.timezone
  weather: DayWeather | null;
  /** Tenue déjà gardée pour demain (plan confirmé), affichée en premier. */
  planned: PreviewOutfit | null;
  /** Les autres tenues, de la meilleure à la moins bonne : 5 en tout avec la tenue prévue. */
  suggestions: PreviewOutfit[];
  /** Pièces de la tenue prévue passées au sale depuis, et ce qui les remplace (planChanges). */
  planNotes: string[];
  hasItems: boolean;
  /**
   * Ce que « Recommencer le choix » effacerait : la tenue gardée, les refus faits pendant le choix
   * de demain. null s'il n'y a rien à effacer (pas de bouton).
   */
  restart: { hasPlan: boolean; refused: number } | null;
};

/** Clé d'une tenue : ids triés joints par « + » (même règle que Outfit.key). */
export function outfitKey(itemIds: string[]): string {
  return [...itemIds].sort().join('+');
}

/** Pièces principales : la remplaçante de l'une peut être d'une autre catégorie (robe, haut et bas). */
const MAIN_CATEGORIES: readonly Category[] = ['haut', 'bas', 'robe'];

type NotedItem = Pick<Item, 'name' | 'category' | 'dirty'>;

/**
 * Pièces de la tenue prévue passées au sale depuis qu'elle a été gardée, une phrase par pièce :
 * « Pull en lin au sale : remplacé par Chemise blanche. » (docs/conception.md §4). generateOutfits remplace une
 * pièce au sale par une pièce de la même catégorie, ou une robe par un haut et un bas (et
 * inversement) ; sans remplaçante (veste plus nécessaire, tenue prévue montrée telle quelle),
 * « Veste en jean au sale. ». Une pièce supprimée depuis n'a plus de nom : elle n'est pas citée.
 */
export function planChanges(
  planIds: readonly string[],
  shownIds: readonly string[],
  byId: ReadonlyMap<string, NotedItem>,
): string[] {
  const planned = new Set(planIds);
  const dirty = [...planned].map((id) => byId.get(id)).filter((item): item is NotedItem => Boolean(item?.dirty));
  // Pièces ajoutées à la tenue (absentes du plan), à attribuer aux pièces au sale.
  const added = shownIds
    .filter((id) => !planned.has(id))
    .map((id) => byId.get(id))
    .filter((item): item is NotedItem => item !== undefined);

  const replacement = new Map<NotedItem, NotedItem>();
  for (const piece of dirty) {
    const index = added.findIndex((item) => item.category === piece.category);
    if (index >= 0) replacement.set(piece, added.splice(index, 1)[0]);
  }
  // Pièces principales sans remplaçante de leur catégorie : elles partagent les pièces principales
  // restantes, en une seule phrase (« Robe noire au sale : remplacé par Pull marine et jean brut. »).
  const unmatched = dirty.filter((piece) => !replacement.has(piece) && MAIN_CATEGORIES.includes(piece.category));
  const others = added.filter((item) => MAIN_CATEGORIES.includes(item.category));
  const grouped = unmatched.length > 0 && others.length > 0;

  const notes: string[] = [];
  for (const piece of dirty) {
    const instead = replacement.get(piece);
    if (instead) {
      notes.push(`${piece.name.trim()} au sale : remplacé par ${instead.name.trim()}.`);
    } else if (grouped && unmatched.includes(piece)) {
      if (piece !== unmatched[0]) continue; // phrase écrite à la place de la première pièce du groupe
      const subject = outfitTitle(unmatched.map((item) => item.name));
      const verb = unmatched.length > 1 ? 'remplacés' : 'remplacé';
      notes.push(`${subject} au sale : ${verb} par ${outfitTitle(others.map((item) => item.name))}.`);
    } else {
      notes.push(`${piece.name.trim()} au sale.`);
    }
  }
  return notes;
}

type BuildInput = {
  date: string;
  weather: DayWeather | null;
  /** Toutes les pièces (une pièce prévue peut être passée au sale depuis). */
  items: Item[];
  plan: Plan | null;
  outfits: Outfit[];
  /** Chemin Storage (détourage ou manches) → URL signée. */
  urls: Map<string, string>;
  /** Refus faits pendant le choix de `date` (choiceDayOf). */
  refusedForDay?: number;
};

function preview(key: string, title: string, itemIds: string[], byId: Map<string, SignedItem>): PreviewOutfit {
  const pieces: PreviewPiece[] = [];
  for (const id of itemIds) {
    const item = byId.get(id);
    if (!item) continue;
    pieces.push({ id, name: item.name, category: item.category, cutoutUrl: item.cutout_url, zone: photoZone(item) });
  }
  const silhouette = silhouetteSource(itemIds, byId);
  // Sans silhouette, les pièces sont montrées l'une sous l'autre : chacune a sa ligne, sans note.
  return { key, title, item_ids: itemIds, pieces, silhouette, caption: outfitCaption(pieces, silhouette === null) };
}

/** Chaque pièce avec les URL signées de son détourage, de ses manches et des couches des bras pliés. */
function signed(items: Item[], urls: Map<string, string>): Map<string, SignedItem> {
  const url = (path: string | null | undefined) => (path ? (urls.get(path) ?? null) : null);
  return new Map(
    items.map((item) => {
      const signedItem: SignedItem = { ...item, cutout_url: url(item.cutout_path), sleeves_url: url(item.assembly?.sleevesPath) };
      // Seulement pour une photo qui a des bras pliés : une pièce sans bras pliés ne change pas.
      const armsUrls = armsLayerUrls(item.assembly?.photo, url);
      if (armsUrls) signedItem.arms_urls = armsUrls;
      return [item.id, signedItem];
    }),
  );
}

export function buildTomorrowView({ date, weather, items, plan, outfits, urls, refusedForDay = 0 }: BuildInput): TomorrowView {
  const byId = signed(items, urls);

  let planned: PreviewOutfit | null = null;
  // Le point de départ du miroir : la tenue prévue telle que generateOutfits la rend,
  // pièces passées au sale remplacées (docs/conception.md §6). À défaut (toutes ses pièces au sale), les pièces
  // du plan telles quelles.
  const generatedPlan = plan?.confirmed ? outfits.find((outfit) => outfit.planned) : undefined;
  if (generatedPlan) {
    planned = preview(generatedPlan.key, generatedPlan.title, generatedPlan.item_ids, byId);
  } else if (plan?.confirmed) {
    const known = plan.item_ids.filter((id) => byId.has(id));
    if (known.length > 0) {
      const key = outfitKey(known);
      const generated = outfits.find((outfit) => outfit.key === key);
      const title = generated?.title || outfitTitle(known.map((id) => byId.get(id)!.name));
      planned = preview(key, title, known, byId);
    }
  }

  const suggestions = outfits
    // La tenue gardée n'est pas reproposée ; generateOutfits la met en tête avec planned: true.
    .filter((outfit) => !(planned && (outfit.planned || outfit.key === planned.key)))
    // 5 tenues en tout, la tenue prévue comprise (la première est le point de départ du miroir).
    .slice(0, planned ? MAX_OUTFITS - 1 : MAX_OUTFITS)
    .map((outfit) => preview(outfit.key, outfit.title, outfit.item_ids, byId))
    .filter((outfit) => outfit.pieces.length > 0);

  return {
    date,
    weather,
    planned,
    suggestions,
    planNotes: planned && plan ? planChanges(plan.item_ids, planned.item_ids, byId) : [],
    hasItems: items.length > 0,
    restart: plan?.confirmed || refusedForDay > 0 ? { hasPlan: Boolean(plan?.confirmed), refused: refusedForDay } : null,
  };
}

/** Chemins à signer pour l'écran : détourés, manches et couches des bras pliés des pièces affichées. */
export function imagePaths(items: Item[], itemIds: string[]): string[] {
  const wanted = new Set(itemIds);
  return items
    .filter((item) => wanted.has(item.id))
    .flatMap((item) => [item.cutout_path, item.assembly?.sleevesPath ?? null, ...armsLayerPaths(item.assembly?.photo)])
    .filter((path): path is string => Boolean(path));
}

/** « Pluie · 9° à 15° », comme sur le miroir (lib/weather/format.ts). */
export function weatherLine(weather: DayWeather): string {
  return weatherSummary(weather);
}
