import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// Suivi de la dépense (docs/conception.md §7) : chaque appel payant ajoute une ligne à `spend_ledger`, en dollars
// tels que facturés. `owner` prend auth.uid() par défaut (client serveur de la session, RLS).
// Un échec d'écriture ne fait jamais échouer l'action qui a payé : on journalise le nom de l'erreur.

export type SpendService = 'fashn' | 'bria' | 'claude';

/** `detail` est un repère court (« détourage », « fiche »), jamais une URL ni une donnée privée. */
export const MAX_SPEND_DETAIL_LENGTH = 120;

/** cost_usd est un numeric(10, 4) : quatre décimales. */
function roundUsd(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function errorLabel(error: unknown): string {
  if (error && typeof error === 'object') {
    const { name, code } = error as { name?: unknown; code?: unknown };
    const label = typeof name === 'string' && name ? name : 'Erreur';
    return typeof code === 'string' && code ? `${label} (${code})` : label;
  }
  return 'Erreur inconnue';
}

/** Enregistre une dépense. Renvoie false (sans lever d'erreur) si l'écriture a échoué. */
export async function recordSpend(
  supabase: SupabaseClient,
  service: SpendService,
  costUsd: number,
  detail?: string,
): Promise<boolean> {
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    console.error(`recordSpend (${service}) : coût invalide, rien n'est enregistré.`);
    return false;
  }
  try {
    const { error } = await supabase.from('spend_ledger').insert({
      service,
      cost_usd: roundUsd(costUsd),
      detail: detail ? detail.slice(0, MAX_SPEND_DETAIL_LENGTH) : null,
    });
    if (error) {
      console.error(`recordSpend (${service}) : ${errorLabel(error)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`recordSpend (${service}) : ${errorLabel(error)}`);
    return false;
  }
}
