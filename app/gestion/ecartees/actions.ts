'use server';

import { refresh } from 'next/cache';
import { SERVER_ERROR, actionFailure, type ActionResult } from '@/components/gestion/action-errors';
import { isUuid } from '@/lib/items/validate';
import { requireUser } from '@/lib/server/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * « Remettre » une tenue écartée (docs/conception.md §4, §6) : son refus est effacé, elle peut de nouveau être
 * proposée, sur le téléphone comme sur le miroir (à sa prochaine lecture des données).
 */
export async function restoreRefusal(id: unknown): Promise<ActionResult> {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch (error) {
    return actionFailure('restoreRefusal', error, SERVER_ERROR);
  }
  if (!isUuid(id)) return { ok: false, error: 'Tenue introuvable.' };

  try {
    const supabase = await createClient();
    const { error } = await supabase.from('refusals').delete().eq('owner', userId).eq('id', id);
    if (error) throw error;
  } catch (error) {
    return actionFailure('restoreRefusal', error, "La tenue n'a pas pu être remise. Réessaie.");
  }

  refresh();
  return { ok: true };
}
