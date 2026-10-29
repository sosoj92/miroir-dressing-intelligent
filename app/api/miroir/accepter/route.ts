import { connection } from 'next/server';
import { targetDay } from '@/lib/dates';
import { authErrorResponse, requireUser } from '@/lib/server/auth';
import { getProfile } from '@/lib/server/profile';
import { createClient } from '@/lib/supabase/server';
import { acceptTarget, parseAcceptRequest, readJsonBody } from '@/lib/mirror/request';
import { badRequest, json } from '@/lib/mirror/responses';
import { ownsAllItems, saveHistory, savePlan } from '@/lib/mirror/server';

// Tenue acceptée sur la tablette : « Bonne journée » → outfit_history ; « Prête pour demain » →
// outfit_plans avec confirmed à vrai (docs/conception.md §4, « Préparer demain »). La table suit `target`, ce que
// la tablette affichait à l'appui (l'envoi peut arriver après minuit, docs/conception.md §7 bis).
// Body : { date, item_ids, title?, target? }.
export async function POST(request: Request) {
  await connection();
  try {
    const user = await requireUser();
    const parsed = parseAcceptRequest(await readJsonBody(request));
    if (!parsed.ok) return badRequest(parsed.error);

    const supabase = await createClient();
    const profile = await getProfile(supabase);
    const now = new Date();
    const { today } = targetDay(now, profile.timezone, profile.evening_hour);
    const target = acceptTarget(parsed.value.date, today, parsed.value.target);
    if (!target) return badRequest('Cette date est passée ou trop lointaine.');

    if (!(await ownsAllItems(supabase, user.id, parsed.value.item_ids))) {
      return badRequest('Pièce inconnue.');
    }

    const { date, item_ids, title } = parsed.value;
    if (target === 'history') await saveHistory(supabase, user.id, { date, item_ids, title });
    else await savePlan(supabase, user.id, { date, item_ids }, now);
    return json({ ok: true, saved: target });
  } catch (error) {
    return authErrorResponse(error);
  }
}
