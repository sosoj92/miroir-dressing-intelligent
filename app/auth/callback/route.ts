import { NextResponse, connection, type NextRequest } from 'next/server';
import { CLEAR_FROM_COOKIE, destination, FROM_COOKIE, keepFromMirror } from '@/app/connexion/after-sign-in';
import { allowedUserId } from '@/lib/server/env';
import { createClient } from '@/lib/supabase/server';

// Arrivée du lien magique : échange le code contre une session, puis vérifie que c'est bien
// le compte autorisé. Redirige toujours vers une adresse fixe (pas de paramètre « next ») : le
// miroir si le lien a été demandé depuis le miroir (cookie connexion-depuis, posé par le
// formulaire), sinon l'accueil du téléphone (table fixe, app/connexion/after-sign-in.ts). Le
// cookie est effacé à chaque passage.
// Route publique (pas de session avant l'échange) : ALLOWED_USER_ID est vérifié juste après.
// Lien ouvert dans un autre navigateur que celui de la demande (autre appareil, navigateur
// intégré de Gmail) : le vérificateur PKCE manque, on le dit au lieu de « lien expiré ».
export async function GET(request: NextRequest) {
  await connection(); // hors du try : voir app/api/me/route.ts
  const from = request.cookies.get(FROM_COOKIE)?.value;
  const response = await signIn(request, from);
  response.cookies.set(FROM_COOKIE, '', CLEAR_FROM_COOKIE);
  return response;
}

async function signIn(request: NextRequest, from: string | undefined): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) return redirectToSignIn(request, 'lien', from);

  try {
    // Lu avant l'échange : sans ALLOWED_USER_ID, aucune session n'est créée.
    const allowedId = allowedUserId();
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error?.code === 'pkce_code_verifier_not_found') return redirectToSignIn(request, 'navigateur', from);
    if (error || !data.user) return redirectToSignIn(request, 'lien', from);

    if (data.user.id.toLowerCase() !== allowedId) {
      await supabase.auth.signOut();
      return redirectToSignIn(request, 'acces', from);
    }

    return NextResponse.redirect(new URL(destination(from), request.url));
  } catch (error) {
    console.error(error instanceof Error ? `${error.name} : ${error.message}` : 'Erreur inconnue');
    return redirectToSignIn(request, 'lien', from);
  }
}

/**
 * Retour à la connexion avec le message. Le retour au miroir est gardé pour le nouvel essai, sauf
 * pour « navigateur » : le lien a été ouvert ailleurs (le plus souvent sur le téléphone), et une
 * connexion faite là ne doit pas mener à l'écran du miroir.
 */
function redirectToSignIn(request: NextRequest, reason: 'lien' | 'acces' | 'navigateur', from: string | undefined) {
  const url = new URL('/connexion', request.url);
  url.searchParams.set('erreur', reason);
  if (reason !== 'navigateur') keepFromMirror(url, from);
  return NextResponse.redirect(url);
}
