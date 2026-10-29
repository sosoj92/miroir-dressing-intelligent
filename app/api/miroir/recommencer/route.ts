import { connection } from 'next/server';
import { targetDay } from '@/lib/dates';
import { authErrorResponse, requireUser } from '@/lib/server/auth';
import { getProfile } from '@/lib/server/profile';
import { createClient } from '@/lib/supabase/server';
import { isRestartAllowed, parseRestartRequest, readJsonBody } from '@/lib/mirror/request';
import { badRequest, json } from '@/lib/mirror/responses';
import { restartChoice } from '@/lib/mirror/server';

// « Recommencer » sur la tablette (docs/conception.md §4, §5) : la tenue choisie pour le jour visé et les refus
// faits pendant ce choix sont effacés, les tenues du départ reviennent. Le corps porte ce que la
// tablette affichait (l'envoi peut arriver après minuit, docs/conception.md §7 bis). Body : { date, today, refused? }.
export async function POST(request: Request) {
  await connection();
  try {
    const user = await requireUser();
    const parsed = parseRestartRequest(await readJsonBody(request));
    if (!parsed.ok) return badRequest(parsed.error);

    const supabase = await createClient();
    const profile = await getProfile(supabase);
    const { today } = targetDay(new Date(), profile.timezone, profile.evening_hour);
    if (!isRestartAllowed(parsed.value, today)) return badRequest('Cette date est passée ou trop lointaine.');

    await restartChoice(
      supabase,
      user.id,
      { ...parsed.value, timeZone: profile.timezone, eveningHour: profile.evening_hour },
      new Date(),
    );
    return json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
