import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isoDateInTimeZone } from '@/lib/dates';
import { getProfile, updateProfile } from '@/lib/server/profile';
import type { ImportBatch, ImportCounts, ImportItemPayload } from './batches';

// Écriture d'un envoi d'import en base (docs/conception.md §3.1), après validateImportBatch.
// Rejouable : les pièces sont retrouvées par (owner, legacy_id), l'historique et les plans par
// (owner, date), les refus par (owner, item_ids trié). Rejouer l'import ne crée aucun doublon.

/** Taille des listes passées à `.in()` (elles partent dans l'URL de PostgREST). */
const LOOKUP_CHUNK = 100;
/** created_at des refus importés du prototype : bien avant tout choix fait avec le miroir. */
export const IMPORTED_REFUSAL_CREATED_AT = '2000-01-01T00:00:00Z';

type ItemRow = ImportItemPayload & { owner: string };

/**
 * Regroupe les lignes qui ont exactement les mêmes colonnes. supabase-js annonce à PostgREST
 * l'union des colonnes d'un upsert groupé, et PostgREST les met toutes à jour : une ligne sans
 * `photo_path` mélangée à d'autres l'effacerait. Chaque groupe part donc dans son propre upsert,
 * et les clés `undefined` sont retirées (elles compteraient comme colonnes).
 */
export function groupByColumns<T extends object>(rows: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const clean = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T;
    const key = Object.keys(clean).sort().join(',');
    const group = groups.get(key);
    if (group) group.push(clean);
    else groups.set(key, [clean]);
  }
  return [...groups.values()];
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

function resolve(ids: Map<string, string>, legacyIds: string[]): string[] {
  return legacyIds.map((legacy) => ids.get(legacy)).filter((id): id is string => Boolean(id));
}

/** Ids triés comme le fait Postgres pour uuid[] (minuscules, ordre des octets). */
export function sortIds(ids: string[]): string[] {
  return ids.map((id) => id.toLowerCase()).sort();
}

export async function runImport(
  supabase: SupabaseClient,
  userId: string,
  batch: ImportBatch,
  now: Date,
): Promise<ImportCounts> {
  const counts: ImportCounts = {
    items: 0,
    withoutCutout: 0,
    history: 0,
    refusals: 0,
    plans: 0,
    city: null,
  };

  // Ville du profil : getProfile crée la ligne si elle n'existe pas encore, puis updateProfile.
  let timeZone: string | null = null;
  if (batch.city) {
    await getProfile(supabase);
    const { name, lat, lon, timezone } = batch.city;
    await updateProfile(supabase, userId, { city: name, lat, lon, timezone });
    timeZone = timezone;
    counts.city = name;
  }

  // Pièces : upsert sur (owner, legacy_id), owner passé explicitement.
  const ids = new Map<string, string>();
  const rows: ItemRow[] = batch.items.map((item) => ({ owner: userId, ...item }));
  for (const group of groupByColumns(rows)) {
    const { data, error } = await supabase
      .from('items')
      .upsert(group, { onConflict: 'owner,legacy_id' })
      .select('id, legacy_id, cutout_path');
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ id: string; legacy_id: string; cutout_path: string | null }>) {
      ids.set(row.legacy_id, row.id);
      counts.items++;
      if (!row.cutout_path) counts.withoutCutout++;
    }
  }

  // Correspondance legacy_id → id pour les pièces enregistrées par un envoi précédent.
  const referenced = new Set(
    [...batch.history, ...batch.refusals, ...batch.plans].flatMap((entry) => entry.legacy_ids),
  );
  const missing = [...referenced].filter((legacy) => !ids.has(legacy));
  for (const chunk of chunks(missing, LOOKUP_CHUNK)) {
    const { data, error } = await supabase
      .from('items')
      .select('id, legacy_id')
      .eq('owner', userId)
      .in('legacy_id', chunk);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ id: string; legacy_id: string }>) ids.set(row.legacy_id, row.id);
  }

  // Historique : une entrée par date, titre vide. Les pièces introuvables sont retirées.
  const history = batch.history
    .map((entry) => ({ owner: userId, date: entry.date, item_ids: resolve(ids, entry.legacy_ids), title: null }))
    .filter((row) => row.item_ids.length > 0);
  if (history.length > 0) {
    const { error } = await supabase.from('outfit_history').upsert(history, { onConflict: 'owner,date' });
    if (error) throw error;
    counts.history = history.length;
  }

  // Refus : item_ids trié ; un refus dont une pièce manque est écarté (il bloquerait autre chose).
  const refusalKeys = new Set<string>();
  // created_at fixe et ancien : un refus importé n'appartient à aucun choix du jour, « Recommencer »
  // (docs/conception.md §4) ne l'efface jamais.
  const refusals: Array<{ owner: string; item_ids: string[]; created_at: string }> = [];
  for (const entry of batch.refusals) {
    const resolved = resolve(ids, entry.legacy_ids);
    if (resolved.length !== entry.legacy_ids.length) continue;
    const item_ids = sortIds(resolved);
    const key = item_ids.join(',');
    if (refusalKeys.has(key)) continue;
    refusalKeys.add(key);
    refusals.push({ owner: userId, item_ids, created_at: IMPORTED_REFUSAL_CREATED_AT });
  }
  if (refusals.length > 0) {
    const { error } = await supabase
      .from('refusals')
      .upsert(refusals, { onConflict: 'owner,item_ids', ignoreDuplicates: true });
    if (error) throw error;
    counts.refusals = refusals.length;
  }

  // Plans : dates à venir seulement, aujourd'hui compris, recalculées ici dans le fuseau de la
  // ville importée (sinon celui du profil) : on ne se fie pas à la date du navigateur.
  if (batch.plans.length > 0) {
    timeZone ??= (await getProfile(supabase)).timezone;
    const today = isoDateInTimeZone(now, timeZone);
    const plans = batch.plans
      .filter((entry) => entry.date >= today)
      .map((entry) => ({
        owner: userId,
        date: entry.date,
        item_ids: resolve(ids, entry.legacy_ids),
        confirmed: entry.confirmed,
        updated_at: now.toISOString(),
      }))
      .filter((row) => row.item_ids.length > 0);
    if (plans.length > 0) {
      const { error } = await supabase.from('outfit_plans').upsert(plans, { onConflict: 'owner,date' });
      if (error) throw error;
      counts.plans = plans.length;
    }
  }

  return counts;
}
