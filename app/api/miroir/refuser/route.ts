import { connection } from 'next/server';
import { authErrorResponse, requireUser } from '@/lib/server/auth';
import { createClient } from '@/lib/supabase/server';
import { parseRefuseRequest, readJsonBody } from '@/lib/mirror/request';
import { badRequest, json } from '@/lib/mirror/responses';
import { ownsAllItems, saveRefusal } from '@/lib/mirror/server';

// Tenue refusée : on mémorise ses pièces principales et sa veste, triées (docs/conception.md §6, §11, 4),
// pour ne plus les reproposer ensemble. Body : { item_ids }.
export async function POST(request: Request) {
  await connection();
  try {
    const user = await requireUser();
    const parsed = parseRefuseRequest(await readJsonBody(request));
    if (!parsed.ok) return badRequest(parsed.error);

    const supabase = await createClient();
    if (!(await ownsAllItems(supabase, user.id, parsed.value.item_ids))) {
      return badRequest('Pièce inconnue.');
    }
    await saveRefusal(supabase, user.id, parsed.value.item_ids);
    return json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
