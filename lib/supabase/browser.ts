// Client Supabase du navigateur : seulement l'URL et la clé publishable (RLS protège chaque table).
// Les deux valeurs sont lues littéralement dans `config.ts`, pour que Next.js les recopie au build.
import { createBrowserClient } from '@supabase/ssr';
import { requireSupabasePublicConfig } from './config';

export function createClient() {
  const { url, publishableKey } = requireSupabasePublicConfig();
  return createBrowserClient(url, publishableKey);
}
