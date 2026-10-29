import { connection } from 'next/server';
import { authErrorResponse, requireUser } from '@/lib/server/auth';
import { getProfile, updateProfile } from '@/lib/server/profile';
import { createClient } from '@/lib/supabase/server';
import { parseKeysRequest, readJsonBody } from '@/lib/mirror/request';
import { badRequest, json } from '@/lib/mirror/responses';
import { loadMirrorVersion } from '@/lib/mirror/server';

// Touches du clavier de secours et empreinte des données du miroir (docs/conception.md §4, §5).
// GET : la tablette lit toutes les 30 s l'empreinte de ses données (lib/mirror/version.ts) et le
// nombre de refus : si l'empreinte a changé (pièce au sale, tenue gardée sur Demain…) ou si des
// refus ont été effacés (« Remettre », « Recommencer le choix »), elle relit GET /api/miroir. Un
// changement fait sur le téléphone arrive ainsi sur le miroir en 30 s au plus (docs/conception.md §4).
export async function GET() {
  await connection();
  try {
    const user = await requireUser();
    const supabase = await createClient();
    const profile = await getProfile(supabase);
    const { version, refusals } = await loadMirrorVersion(supabase, user.id, profile, new Date());
    return json({ version, refusals });
  } catch (error) {
    return authErrorResponse(error);
  }
}

// POST : fin du test des touches (?touches=test sur la tablette). Body : { keyMap } avec les quatre
// actions de base (bas, veste et « Recommencer » en plus, facultatifs pour une tablette pas encore à
// jour), sur des touches différentes. Enregistre key_map et remet à faux key_test_requested (que
// plus rien ne lève depuis la fin de la manette).
export async function POST(request: Request) {
  await connection();
  try {
    const user = await requireUser();
    const parsed = parseKeysRequest(await readJsonBody(request));
    if (!parsed.ok) return badRequest(parsed.error);

    const supabase = await createClient();
    await updateProfile(supabase, user.id, { key_map: parsed.value.keyMap, key_test_requested: false });
    return json({ ok: true, keyMap: parsed.value.keyMap });
  } catch (error) {
    return authErrorResponse(error);
  }
}
