'use server';

import { refresh } from 'next/cache';
import { SERVER_ERROR, actionFailure, type ActionResult } from '@/components/gestion/action-errors';
import { isoDateInTimeZone } from '@/lib/dates';
import { isIsoDate } from '@/lib/mirror/request';
import { restartChoice } from '@/lib/mirror/server';
import { requireUser } from '@/lib/server/auth';
import { getProfile } from '@/lib/server/profile';
import { createClient } from '@/lib/supabase/server';
import { tomorrowIn } from './data';
import { parseOutfitIds } from './ids';

/**
 * « Garder pour demain » (docs/conception.md §4) : enregistre la tenue dans outfit_plans pour demain, confirmée.
 * La date est calculée ici dans profile.timezone : le navigateur n'envoie que les ids des pièces.
 */
export async function keepForTomorrow(itemIds: unknown): Promise<ActionResult> {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch (error) {
    return actionFailure('keepForTomorrow', error, SERVER_ERROR);
  }

  const ids = parseOutfitIds(itemIds);
  if (!ids) return { ok: false, error: 'Tenue invalide.' };

  try {
    const supabase = await createClient();
    // Chaque pièce doit exister et appartenir au compte.
    const { data, error } = await supabase.from('items').select('id').eq('owner', userId).in('id', ids);
    if (error) throw error;
    if ((data ?? []).length !== ids.length) return { ok: false, error: 'Une pièce de cette tenue est introuvable.' };

    const profile = await getProfile(supabase);
    const now = new Date();
    const { error: planError } = await supabase.from('outfit_plans').upsert(
      {
        owner: userId,
        date: tomorrowIn(profile.timezone, now),
        item_ids: ids,
        confirmed: true,
        updated_at: now.toISOString(),
      },
      { onConflict: 'owner,date' },
    );
    if (planError) throw planError;
  } catch (error) {
    return actionFailure('keepForTomorrow', error, "La tenue n'a pas pu être gardée. Réessaie.");
  }

  refresh();
  return { ok: true };
}

/**
 * « Recommencer le choix » (docs/conception.md §4, §5) : la tenue gardée pour `date` (le « demain » affiché par
 * la page) et les refus faits pendant ce choix sont effacés, comme sur le miroir ; les tenues du
 * départ reviennent. Si la page a changé de jour (ouverte avant minuit), rien n'est effacé : elle
 * doit être rechargée, sinon on effacerait le mauvais jour.
 */
export async function restartTomorrow(date: unknown): Promise<ActionResult> {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch (error) {
    return actionFailure('restartTomorrow', error, SERVER_ERROR);
  }
  if (!isIsoDate(date)) return { ok: false, error: 'Date invalide.' };

  try {
    const supabase = await createClient();
    const profile = await getProfile(supabase);
    const now = new Date();
    if (date !== tomorrowIn(profile.timezone, now)) return { ok: false, error: 'La page a changé de jour : recharge-la.' };
    await restartChoice(
      supabase,
      userId,
      { date, today: isoDateInTimeZone(now, profile.timezone), timeZone: profile.timezone, eveningHour: profile.evening_hour },
      now,
    );
  } catch (error) {
    return actionFailure('restartTomorrow', error, "Le choix n'a pas pu être recommencé. Réessaie.");
  }

  refresh();
  return { ok: true };
}
