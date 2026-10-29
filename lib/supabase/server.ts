import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { requireSupabasePublicConfig } from './config';

// Un client par requête, avec les cookies de la requête. Jamais partagé entre deux requêtes.
// Pour savoir qui est connecté, utilise `requireUser()` (lib/server/auth.ts), qui passe par
// `getClaims()`. N'utilise jamais `getSession()` côté serveur.
export async function createClient() {
  // Lire les cookies d'abord : la page ou la route devient dynamique même quand Supabase
  // n'est pas encore configuré (sinon Next.js la figerait au build).
  const cookieStore = await cookies();
  const { url, publishableKey } = requireSupabasePublicConfig();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Appelé depuis un Server Component, qui ne peut pas écrire de cookie :
          // le proxy (proxy.ts) rafraîchit la session à la requête suivante.
        }
      },
    },
  });
}
