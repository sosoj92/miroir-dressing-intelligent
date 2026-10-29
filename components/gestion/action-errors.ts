import 'server-only';
import { AuthError } from '@/lib/server/auth';
import { SupabaseNotConfiguredError } from '@/lib/supabase/config';

// Réponse d'une server action qui échoue : un message français court, jamais de détail interne.

export type ActionFailure = { ok: false; error: string };
export type ActionResult = { ok: true } | ActionFailure;

/**
 * Échec imprévu d'une server action (session illisible, erreur inattendue) : ce que voit
 * l'écran, sans « Erreur du serveur » ni détail interne.
 */
export const SERVER_ERROR = "Ça n'a pas marché. Réessaie.";

/** Journalise sans valeur sensible : nom, code et message de l'erreur (pas d'URL signée ici). */
function describe(error: unknown): string {
  if (error && typeof error === 'object') {
    const { name, code, message } = error as { name?: unknown; code?: unknown; message?: unknown };
    const parts = [name, code, message].filter((part) => typeof part === 'string' && part !== '');
    if (parts.length > 0) return parts.join(' ').slice(0, 300);
  }
  return 'Erreur inconnue';
}

/** Journalise une erreur serveur (pages et actions du téléphone). */
export function logServerError(context: string, error: unknown): void {
  console.error(`${context} : ${describe(error)}`);
}

/**
 * Traduit une erreur en réponse : session absente (401) ou autre compte (403) avec le message
 * de AuthError, Supabase non configuré, sinon `fallback` (et l'erreur est journalisée).
 */
export function actionFailure(context: string, error: unknown, fallback: string): ActionFailure {
  if (error instanceof AuthError) return { ok: false, error: error.message };
  if (error instanceof SupabaseNotConfiguredError) {
    return { ok: false, error: "La connexion n'est pas encore configurée." };
  }
  logServerError(context, error);
  return { ok: false, error: fallback };
}
