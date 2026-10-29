import { connection } from 'next/server';
import { authErrorResponse, requireUser } from '@/lib/server/auth';
import { createClient } from '@/lib/supabase/server';
import { loadMirrorPayload } from '@/lib/mirror/server';
import { json } from '@/lib/mirror/responses';

// Tout ce que la tablette garde en mémoire (docs/conception.md §7 bis) : pièces propres avec leurs repères
// d'assemblage et les URL signées (1 h) de leur détourage et de leurs manches, historique, refus,
// tenue prévue, météo du jour visé, touches, et l'empreinte de ces données (`version`, la même que
// celle de GET /api/miroir/touches tant que rien ne change sur le téléphone).
export async function GET() {
  // Avant le try : au build, Next.js interrompt ici le pré-rendu (AGENTS.md).
  await connection();
  try {
    const user = await requireUser();
    const supabase = await createClient();
    return json(await loadMirrorPayload(supabase, user.id, new Date()));
  } catch (error) {
    return authErrorResponse(error);
  }
}
