import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tomorrowIn } from './demain/data';

// Accueil du téléphone : ce que les lignes « Garde-robe » et « Demain » disent à droite.

export type HomeSummary = {
  /** Pièces au sale. */
  dirtyCount: number;
  /** Une tenue confirmée est gardée pour demain (comme « Prévue pour demain » sur la page Demain). */
  tomorrowPlanned: boolean;
};

/** Pièces au sale et tenue de demain. `timeZone` : celui du profil, demain n'est jamais pris en UTC. */
export async function loadHomeSummary(
  supabase: SupabaseClient,
  userId: string,
  timeZone: string,
  now: Date,
): Promise<HomeSummary> {
  const date = tomorrowIn(timeZone, now);
  const [dirtyResult, planResult] = await Promise.all([
    // Le filtre explicite sur owner double RLS, comme sur le miroir (lib/mirror/server.ts).
    supabase.from('items').select('id').eq('owner', userId).eq('dirty', true),
    // Un brouillon importé du prototype (confirmed: false) n'est pas une tenue prévue.
    supabase
      .from('outfit_plans')
      .select('date')
      .eq('owner', userId)
      .eq('date', date)
      .eq('confirmed', true)
      .maybeSingle(),
  ]);
  if (dirtyResult.error) throw dirtyResult.error;
  if (planResult.error) throw planResult.error;

  return {
    dirtyCount: (dirtyResult.data ?? []).length,
    tomorrowPlanned: Boolean(planResult.data),
  };
}

/** « 3 au sale », ou rien s'il n'y a aucune pièce au sale. */
export function dirtyValue(count: number): string | undefined {
  return count > 0 ? `${count} au sale` : undefined;
}

/** « Prévue » si une tenue est gardée pour demain, sinon « À choisir ». */
export function tomorrowValue(planned: boolean): string {
  return planned ? 'Prévue' : 'À choisir';
}
