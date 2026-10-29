import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { armsLayerPaths, armsLayerUrls } from '@/lib/assembly/arms-files';
import { parseAssembly } from '@/lib/assembly/parse';
import { isDrawn } from '@/lib/assembly/render';
import { addDays, targetDay } from '@/lib/dates';
import { sameIds } from '@/lib/mirror/deck';
import { VERSION_ITEM_COLUMNS, mirrorVersion, versionItemOf, type MirrorResponse, type VersionItem } from '@/lib/mirror/version';
import { ITEM_COLUMNS } from '@/lib/items/rows';
import { assertOwnPath, signedUrls } from '@/lib/server/storage';
import { getProfile } from '@/lib/server/profile';
import { fetchDayWeather } from '@/lib/weather';
import {
  CATEGORIES,
  STYLES,
  type Category,
  type DayWeather,
  type HistoryEntry,
  type MirrorItem,
  type Plan,
  type Profile,
  type Refusal,
  type Style,
  type Warmth,
} from '@/lib/types';

// Lectures et écritures du miroir, avec le client Supabase de la session (RLS : owner = auth.uid()).
// Le filtre explicite sur owner double RLS. Aucune URL signée n'est journalisée.

/** Jours d'historique envoyés à la tablette (« pas portée ces 3 derniers jours », docs/conception.md §6). */
export const HISTORY_DAYS = 14;

type ItemRow = {
  id: string;
  name: string;
  category: string;
  color: string | null;
  warmth: number;
  styles: string[] | null;
  rain_ok: boolean;
  dirty: boolean;
  photo_path: string | null;
  cutout_path: string | null;
  legacy_id: string | null;
  created_at: string;
  assembly?: unknown; // jsonb, relu par parseAssembly
};

type IdsRow = { item_ids: string[] | null };

function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

function isStyle(value: string): value is Style {
  return (STYLES as readonly string[]).includes(value);
}

function toWarmth(value: number): Warmth {
  const warmth = Math.round(Number(value));
  return warmth <= 1 ? 1 : warmth >= 3 ? 3 : 2;
}

function ids(row: IdsRow): string[] {
  return Array.isArray(row.item_ids) ? row.item_ids.map(String) : [];
}

/** Chemin (détourage, manches) rangé sous <userId>/…, ou null. */
function ownPath(userId: string, path: string | null): string | null {
  if (!path) return null;
  try {
    return assertOwnPath(userId, path);
  } catch {
    return null;
  }
}

async function safeWeather(profile: Profile, date: string): Promise<DayWeather | null> {
  try {
    return await fetchDayWeather({ lat: profile.lat, lon: profile.lon, timezone: profile.timezone }, date);
  } catch {
    return null; // La météo ne doit jamais empêcher le miroir de s'afficher.
  }
}

/**
 * Retire du plan les chaussures et accessoires que la silhouette ne dessine pas (docs/conception.md §7), même au
 * sale : la tablette ne reçoit que les pièces propres, et une pièce du plan absente de sa liste
 * compterait comme disparue (generateOutfits ajouterait une veste par temps froid). Même résultat
 * que l'écran Demain, qui filtre avec la liste complète. En cas d'échec, le plan reste tel quel.
 */
async function withoutUndrawnPieces(
  supabase: SupabaseClient,
  userId: string,
  plan: Plan,
  known: ReadonlySet<string>,
): Promise<Plan> {
  const missing = [...new Set(plan.item_ids.filter((id) => !known.has(id)))];
  if (missing.length === 0) return plan;
  try {
    const { data, error } = await supabase.from('items').select('id, category').eq('owner', userId).in('id', missing);
    if (error) throw error;
    const undrawn = new Set(
      ((data ?? []) as Array<{ id: unknown; category: unknown }>)
        .filter((row) => !isDrawn({ category: row.category as Category }))
        .map((row) => String(row.id)),
    );
    if (undrawn.size === 0) return plan;
    return { ...plan, item_ids: plan.item_ids.filter((id) => !undrawn.has(id)) };
  } catch (error) {
    console.error(`Plan du miroir : ${error instanceof Error ? error.name : 'erreur inconnue'}`);
    return plan;
  }
}

async function safeSignedUrls(supabase: SupabaseClient, paths: Array<string | null>): Promise<Map<string, string>> {
  try {
    return await signedUrls(supabase, 'items', paths);
  } catch (error) {
    // Sans URL signée, la tablette affiche le nom des pièces. Seul le type d'erreur est journalisé.
    console.error(`Détourages indisponibles : ${error instanceof Error ? error.name : 'erreur inconnue'}`);
    return new Map();
  }
}

/** Tout ce que la tablette garde en mémoire (GET /api/miroir), avec l'empreinte de ces données. */
export async function loadMirrorPayload(supabase: SupabaseClient, userId: string, now: Date): Promise<MirrorResponse> {
  const profile = await getProfile(supabase);
  const { today, targetDate, isTomorrow } = targetDay(now, profile.timezone, profile.evening_hour);

  const [itemsResult, historyResult, refusalsResult, planResult, weather] = await Promise.all([
    supabase.from('items').select(ITEM_COLUMNS).eq('owner', userId).eq('dirty', false).order('created_at'),
    supabase
      .from('outfit_history')
      .select('date, item_ids, title')
      .eq('owner', userId)
      .gte('date', addDays(today, -HISTORY_DAYS))
      .order('date', { ascending: false }),
    supabase.from('refusals').select('item_ids, created_at').eq('owner', userId),
    // Seul un plan confirmé passe en premier : un brouillon importé du prototype
    // (confirmed: false) est ignoré, comme sur le téléphone (app/gestion/demain/data.ts).
    supabase
      .from('outfit_plans')
      .select('date, item_ids, confirmed')
      .eq('owner', userId)
      .eq('date', targetDate)
      .eq('confirmed', true)
      .maybeSingle(),
    safeWeather(profile, targetDate),
  ]);
  if (itemsResult.error) throw itemsResult.error;
  if (historyResult.error) throw historyResult.error;
  if (refusalsResult.error) throw refusalsResult.error;
  if (planResult.error) throw planResult.error;

  const allRows = (itemsResult.data ?? []) as ItemRow[];
  const rows = allRows.filter((row) => isCategory(row.category));
  // Repères d'assemblage (docs/conception.md §7) : une structure invalide donne null, la pièce s'affiche alors
  // sans assemblage. Détourages, manches et couches des bras pliés sont signés ensemble (1 h).
  const assemblies = rows.map((row) => parseAssembly(row.assembly));
  const cutoutPaths = rows.map((row) => ownPath(userId, row.cutout_path));
  const sleevesPaths = assemblies.map((assembly) => ownPath(userId, assembly?.sleevesPath ?? null));
  const armsPaths = assemblies.flatMap((assembly) =>
    armsLayerPaths(assembly?.photo).map((path) => ownPath(userId, path)),
  );
  const urls = await safeSignedUrls(supabase, [...cutoutPaths, ...sleevesPaths, ...armsPaths]);
  // Une couche hors du dossier du compte n'est jamais signée : URL null.
  const urlOf = (path: string) => {
    const own = ownPath(userId, path);
    return own ? (urls.get(own) ?? null) : null;
  };

  const items: MirrorItem[] = rows.map((row, index) => {
    const cutout = cutoutPaths[index];
    const sleeves = sleevesPaths[index];
    // Seulement pour une photo qui a des bras pliés : une pièce sans bras pliés ne change pas.
    const armsUrls = armsLayerUrls(assemblies[index]?.photo, urlOf);
    return {
      id: row.id,
      name: row.name,
      category: row.category as Category,
      color: row.color,
      warmth: toWarmth(row.warmth),
      styles: (row.styles ?? []).filter(isStyle),
      rain_ok: Boolean(row.rain_ok),
      dirty: Boolean(row.dirty),
      photo_path: row.photo_path,
      cutout_path: row.cutout_path,
      legacy_id: row.legacy_id ?? null,
      created_at: row.created_at,
      assembly: assemblies[index],
      cutout_url: cutout ? (urls.get(cutout) ?? null) : null,
      sleeves_url: sleeves ? (urls.get(sleeves) ?? null) : null,
      ...(armsUrls ? { arms_urls: armsUrls } : {}),
    };
  });

  const history: HistoryEntry[] = ((historyResult.data ?? []) as Array<IdsRow & { date: string; title: string | null }>).map(
    (row) => ({ date: row.date, item_ids: ids(row), title: row.title ?? null }),
  );
  // Chaque refus porte le jour visé quand il a été fait : « Recommencer » efface ceux de son jour
  // sur la tablette aussi, sans attendre le réseau.
  const refusals: Refusal[] = ((refusalsResult.data ?? []) as Array<IdsRow & { created_at?: unknown }>).map((row) => {
    const day = choiceDayOf(row.created_at, profile.timezone, profile.evening_hour);
    return day ? { item_ids: ids(row).sort(), day } : { item_ids: ids(row).sort() };
  });
  const planRow = planResult.data as (IdsRow & { date: string; confirmed: boolean }) | null;
  const plan: Plan | null = planRow
    ? await withoutUndrawnPieces(
        supabase,
        userId,
        { date: planRow.date, item_ids: ids(planRow), confirmed: Boolean(planRow.confirmed) },
        new Set(items.map((item) => item.id)),
      )
    : null;

  return {
    today,
    targetDate,
    isTomorrow,
    timezone: profile.timezone,
    eveningHour: profile.evening_hour,
    weather,
    items,
    history,
    refusals,
    plan,
    keyMap: profile.key_map,
    // Des lignes lues ici, comme les relit GET /api/miroir/touches (loadMirrorVersion).
    version: mirrorVersion({ items: allRows.map(versionItemOf), plan: planRow, profile }),
  };
}

/**
 * Empreinte des données du miroir (lib/mirror/version.ts) : les mêmes lignes que loadMirrorPayload
 * (pièces propres, tenue prévue confirmée du jour visé), sans les tableaux de repères d'assemblage
 * ni les URL signées. null si la lecture échoue.
 */
async function readMirrorVersion(
  supabase: SupabaseClient,
  userId: string,
  profile: Profile,
  now: Date,
): Promise<string | null> {
  try {
    const { targetDate } = targetDay(now, profile.timezone, profile.evening_hour);
    const [itemsResult, planResult] = await Promise.all([
      supabase.from('items').select(VERSION_ITEM_COLUMNS).eq('owner', userId).eq('dirty', false),
      supabase
        .from('outfit_plans')
        .select('date, item_ids')
        .eq('owner', userId)
        .eq('date', targetDate)
        .eq('confirmed', true)
        .maybeSingle(),
    ]);
    if (itemsResult.error) throw itemsResult.error;
    if (planResult.error) throw planResult.error;
    const plan = planResult.data as { date: unknown; item_ids: unknown } | null;
    return mirrorVersion({ items: (itemsResult.data ?? []) as unknown as VersionItem[], plan, profile });
  } catch (error) {
    console.error(`Empreinte du miroir : ${error instanceof Error ? error.name : 'erreur inconnue'}`);
    return null;
  }
}

/** Nombre de refus enregistrés, compté sans lire les lignes ; null si le comptage échoue. */
async function countRefusals(supabase: SupabaseClient, userId: string): Promise<number | null> {
  try {
    const { count, error } = await supabase.from('refusals').select('id', { count: 'exact', head: true }).eq('owner', userId);
    if (error) throw error;
    return typeof count === 'number' ? count : null;
  } catch (error) {
    console.error(`Refus du miroir : ${error instanceof Error ? error.name : 'erreur inconnue'}`);
    return null;
  }
}

/** Ce que GET /api/miroir/touches renvoie pour savoir s'il faut relire les données. */
export type MirrorVersionCheck = {
  /** Empreinte (lib/mirror/version.ts), ou null si la lecture a échoué. */
  version: string | null;
  /**
   * Nombre de refus, ou null : s'il baisse, le téléphone en a effacé (« Remettre », « Recommencer
   * le choix »), ce que l'empreinte ne voit pas.
   */
  refusals: number | null;
};

/**
 * Pour GET /api/miroir/touches : l'empreinte et le nombre de refus. En cas d'échec, null : la
 * tablette ne relit rien et réessaiera dans 30 s.
 */
export async function loadMirrorVersion(
  supabase: SupabaseClient,
  userId: string,
  profile: Profile,
  now: Date,
): Promise<MirrorVersionCheck> {
  const [version, refusals] = await Promise.all([
    readMirrorVersion(supabase, userId, profile, now),
    countRefusals(supabase, userId),
  ]);
  return { version, refusals };
}

/** Toutes ces pièces appartiennent-elles au compte ? (ids déjà validés et dédoublonnés) */
export async function ownsAllItems(supabase: SupabaseClient, userId: string, itemIds: string[]): Promise<boolean> {
  const { data, error } = await supabase.from('items').select('id').eq('owner', userId).in('id', itemIds);
  if (error) throw error;
  const found = new Set(((data ?? []) as Array<{ id: string }>).map((row) => String(row.id).toLowerCase()));
  return itemIds.every((id) => found.has(id));
}

/** Tenue portée aujourd'hui : une entrée par jour (unique owner, date). */
export async function saveHistory(
  supabase: SupabaseClient,
  userId: string,
  entry: { date: string; item_ids: string[]; title: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('outfit_history')
    .upsert({ owner: userId, date: entry.date, item_ids: entry.item_ids, title: entry.title }, { onConflict: 'owner,date' });
  if (error) throw error;
}

/** « Préparer demain » : la tenue gardée pour demain (docs/conception.md §4). */
export async function savePlan(
  supabase: SupabaseClient,
  userId: string,
  plan: { date: string; item_ids: string[] },
  now: Date,
): Promise<void> {
  const { error } = await supabase.from('outfit_plans').upsert(
    {
      owner: userId,
      date: plan.date,
      item_ids: plan.item_ids,
      confirmed: true,
      updated_at: now.toISOString(),
    },
    { onConflict: 'owner,date' },
  );
  if (error) throw error;
}

/**
 * Jour visé par le miroir à l'instant `createdAt` (aujourd'hui, ou demain après evening_hour,
 * dans le fuseau du profil) : le choix pendant lequel un refus a été fait. Un refus du matin
 * appartient au choix du jour, un refus du soir au choix du lendemain. null si l'horodatage manque.
 */
export function choiceDayOf(createdAt: unknown, timeZone: string, eveningHour: number): string | null {
  if (typeof createdAt !== 'string') return null;
  const instant = new Date(createdAt);
  if (Number.isNaN(instant.getTime())) return null;
  return targetDay(instant, timeZone, eveningHour).targetDate;
}

/** Refus relus par « Recommencer » : ceux du choix en cours ont moins de 3 jours. */
export const RESTART_LOOKBACK_MS = 3 * 24 * 3_600_000;

export type RestartChoice = {
  /** Jour visé dont on efface le choix. */
  date: string;
  /** « Aujourd'hui » de l'appui : la tenue portée n'est effacée que si `date` est ce jour-là. */
  today: string;
  timeZone: string;
  eveningHour: number;
  /**
   * Refus faits sur la tablette pendant ce choix (ids triés), envoyés par elle : un refus resté en
   * file hors ligne arrive au serveur plus tard, son created_at ne dit plus à quel choix il appartenait.
   */
  refused?: string[][];
};

/**
 * « Recommencer » (docs/conception.md §4, §5) : comme si rien n'avait été choisi pour `date`. Efface la tenue
 * prévue pour `date`, la tenue portée si `date` est `today` (« Bonne journée »), et les refus faits
 * pendant ce choix : ceux dont le jour visé (choiceDayOf) est `date`, plus ceux que la tablette
 * nomme. Les autres refus restent.
 */
export async function restartChoice(
  supabase: SupabaseClient,
  userId: string,
  choice: RestartChoice,
  now: Date,
): Promise<void> {
  const plan = await supabase.from('outfit_plans').delete().eq('owner', userId).eq('date', choice.date);
  if (plan.error) throw plan.error;
  if (choice.date === choice.today) {
    const worn = await supabase.from('outfit_history').delete().eq('owner', userId).eq('date', choice.date);
    if (worn.error) throw worn.error;
  }
  // Le jour visé d'un refus se calcule dans le fuseau (heure d'été comprise) : on relit les refus
  // récents, puis on les efface par id.
  const since = new Date(now.getTime() - RESTART_LOOKBACK_MS).toISOString();
  const { data, error } = await supabase
    .from('refusals')
    .select('id, item_ids, created_at')
    .eq('owner', userId)
    .gte('created_at', since);
  if (error) throw error;
  const named = choice.refused ?? [];
  const toDelete = ((data ?? []) as Array<IdsRow & { id: unknown; created_at: unknown }>)
    .filter(
      (row) =>
        typeof row.id === 'string' &&
        (choiceDayOf(row.created_at, choice.timeZone, choice.eveningHour) === choice.date ||
          named.some((refused) => sameIds(refused, ids(row)))),
    )
    .map((row) => row.id as string);
  if (toDelete.length === 0) return;
  const removed = await supabase.from('refusals').delete().eq('owner', userId).in('id', toDelete);
  if (removed.error) throw removed.error;
}

/** Refus (ids triés) : un refus déjà connu est ignoré. */
export async function saveRefusal(supabase: SupabaseClient, userId: string, itemIds: string[]): Promise<void> {
  const { error } = await supabase
    .from('refusals')
    .upsert({ owner: userId, item_ids: itemIds }, { onConflict: 'owner,item_ids', ignoreDuplicates: true });
  if (error) throw error;
}
