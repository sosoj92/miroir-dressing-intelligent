import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logServerError } from '@/components/gestion/action-errors';
import { parseAssembly } from '@/lib/assembly/parse';
import { drawnOutfitInputs } from '@/lib/assembly/render';
import { addDays, isoDateInTimeZone } from '@/lib/dates';
import { ITEM_COLUMNS } from '@/lib/items/rows';
import { choiceDayOf } from '@/lib/mirror/server';
import { generateOutfits } from '@/lib/outfits';
import { displayUrls } from '@/lib/server/display-urls';
import type { HistoryEntry, Item, Plan, Profile, Refusal } from '@/lib/types';
import { fetchDayWeather } from '@/lib/weather';
import { buildTomorrowView, imagePaths, type TomorrowView } from './view';

/** Jours d'historique passés à generateOutfits (pièce pas portée ces 3 derniers jours, etc.). */
const HISTORY_DAYS = 14;

/** Demain dans le fuseau du profil, jamais en UTC (docs/conception.md §6). */
export function tomorrowIn(timeZone: string, now: Date): string {
  return addDays(isoDateInTimeZone(now, timeZone), 1);
}

/**
 * Tout ce que l'écran « Préparer demain » affiche : pièces propres, historique, refus, plan de
 * demain, météo de demain, tenues de generateOutfits et URL signées des détourés et des manches.
 */
export async function loadTomorrow(
  supabase: SupabaseClient,
  userId: string,
  profile: Profile,
  now: Date,
): Promise<TomorrowView> {
  const date = tomorrowIn(profile.timezone, now);
  const place = { lat: profile.lat, lon: profile.lon, timezone: profile.timezone };

  const [itemsResult, historyResult, refusalsResult, planResult, weather] = await Promise.all([
    // Le filtre explicite sur owner double RLS, comme sur le miroir (lib/mirror/server.ts).
    supabase.from('items').select(ITEM_COLUMNS).eq('owner', userId).order('created_at'),
    supabase
      .from('outfit_history')
      .select('date, item_ids, title')
      .eq('owner', userId)
      .gte('date', addDays(date, -HISTORY_DAYS))
      .lt('date', date),
    supabase.from('refusals').select('item_ids, created_at').eq('owner', userId),
    // Seul un plan confirmé est « Prévue pour demain » : un brouillon importé du prototype
    // (confirmed: false) est ignoré, comme sur le miroir (lib/mirror/server.ts).
    supabase
      .from('outfit_plans')
      .select('date, item_ids, confirmed')
      .eq('owner', userId)
      .eq('date', date)
      .eq('confirmed', true)
      .maybeSingle(),
    // La météo peut manquer (réseau, ville) : l'écran s'en passe.
    fetchDayWeather(place, date).catch((error: unknown) => {
      logServerError('demain météo', error);
      return null;
    }),
  ]);
  for (const result of [itemsResult, historyResult, refusalsResult, planResult]) {
    if (result.error) throw result.error;
  }

  // Repères d'assemblage relus (docs/conception.md §7) : une structure invalide donne null (aperçu pièce par pièce).
  const items = ((itemsResult.data ?? []) as Array<Item & { assembly?: unknown }>).map(
    (item): Item => ({ ...item, assembly: parseAssembly(item.assembly) }),
  );
  const history = (historyResult.data ?? []) as HistoryEntry[];
  const refusalRows = (refusalsResult.data ?? []) as Array<Refusal & { created_at?: unknown }>;
  const refusals: Refusal[] = refusalRows.map((row) => ({ item_ids: row.item_ids }));
  // Refus faits pendant le choix de demain (sur le miroir, après l'heure du soir).
  const refusedForDay = refusalRows.filter(
    (row) => choiceDayOf(row.created_at, profile.timezone, profile.evening_hour) === date,
  ).length;
  const savedPlan = (planResult.data ?? null) as Plan | null;

  // Chaussures et accessoires ne sont pas dessinés par la silhouette : ni proposés, ni prévus.
  const clean = items.filter((item) => !item.dirty);
  const drawn = drawnOutfitInputs(clean, savedPlan, items);
  const plan = drawn.plan;
  const outfits = generateOutfits(drawn.items, { date, weather, history, refusals, plan });

  const shown = [...(plan?.item_ids ?? []), ...outfits.flatMap((outfit) => outfit.item_ids)];
  let urls = new Map<string, string>();
  try {
    // Un chemin hors du dossier du compte n'est pas signé : la pièce s'affiche par son nom.
    // URL stables (lib/server/display-urls.ts) : revenir sur la page ne recharge pas les images.
    urls = await displayUrls(supabase, userId, 'items', imagePaths(items, shown));
  } catch (error) {
    // Sans URL signée, chaque pièce s'affiche par son nom.
    logServerError('demain signature', error);
  }

  return buildTomorrowView({ date, weather, items, plan, outfits, urls, refusedForDay });
}
