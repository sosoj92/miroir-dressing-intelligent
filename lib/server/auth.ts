import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { SupabaseNotConfiguredError } from '@/lib/supabase/config';
import { allowedUserId } from './env';

// Chaque route handler et chaque server action appelle `requireUser()` lui-même (AGENTS.md).

export type AuthStatus = 401 | 403;

export class AuthError extends Error {
  readonly status: AuthStatus;

  constructor(status: AuthStatus) {
    super(status === 401 ? 'Connexion requise.' : "Ce compte n'a pas accès à Mon Dressing.");
    this.name = 'AuthError';
    this.status = status;
  }
}

export type AllowedUser = {
  id: string;
  email: string | null;
};

/**
 * Vérifie la session avec `getClaims()` (jamais `getSession()`), puis compare son id à
 * ALLOWED_USER_ID. Sans session : AuthError 401. Autre compte : AuthError 403.
 * Si ALLOWED_USER_ID manque, lève une EnvError : on refuse plutôt que d'ouvrir l'accès.
 */
export async function requireUser(): Promise<AllowedUser> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || userId === '') throw new AuthError(401);

  if (userId.toLowerCase() !== allowedUserId()) throw new AuthError(403);

  const email = data?.claims?.email;
  return { id: userId, email: typeof email === 'string' ? email : null };
}

export type UserCheck =
  | { ok: true; user: AllowedUser }
  | { ok: false; status: AuthStatus | 503 };

/** Variante sans exception pour les pages : 503 tant que Supabase n'est pas configuré. */
export async function checkUser(): Promise<UserCheck> {
  try {
    return { ok: true, user: await requireUser() };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, status: error.status };
    if (error instanceof SupabaseNotConfiguredError) return { ok: false, status: 503 };
    throw error;
  }
}

/**
 * Réponse JSON d'un route handler quand `requireUser()` échoue. Ne renvoie jamais de détail interne.
 * Dans le route handler, appelle `await connection()` avant le try (sinon le catch attrape
 * l'interruption du pré-rendu de Next.js au build).
 */
export function authErrorResponse(error: unknown): Response {
  const headers = { 'Cache-Control': 'no-store' };
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status, headers });
  }
  if (error instanceof SupabaseNotConfiguredError) {
    return Response.json({ error: "Supabase n'est pas encore configuré." }, { status: 503, headers });
  }
  // Le message d'une EnvError ne contient que le nom de la variable : on peut le journaliser.
  console.error(error instanceof Error ? `${error.name} : ${error.message}` : 'Erreur inconnue');
  return Response.json({ error: 'Erreur du serveur.' }, { status: 500, headers });
}
