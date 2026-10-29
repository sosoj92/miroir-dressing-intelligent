import { connection } from 'next/server';
import { allowedUserIdState } from '@/lib/server/env';
import { isSupabaseConfigured } from '@/lib/supabase/config';

// Route publique : dit seulement si Supabase et ALLOWED_USER_ID sont renseignés (diagnostic
// d'installation), jamais quelle valeur.
export async function GET() {
  await connection(); // répondre à chaque requête, pas une fois pour toutes au build
  return Response.json(
    {
      ok: true,
      supabase: isSupabaseConfigured() ? 'configurée' : 'absente',
      ALLOWED_USER_ID: allowedUserIdState(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
