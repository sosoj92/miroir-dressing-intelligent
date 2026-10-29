import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabasePublicConfig } from '@/lib/supabase/config';

// Next.js 16 : `proxy.ts` remplace `middleware.ts`. Il rafraîchit la session Supabase à chaque
// requête et renvoie la réponse qui porte les cookies mis à jour. Il ne protège aucune page :
// chaque page, route handler et server action vérifie elle-même le compte (requireUser).
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseConfig = getSupabasePublicConfig();
  if (!supabaseConfig) return response;

  const supabase = createServerClient(supabaseConfig.url, supabaseConfig.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // En-têtes anti-cache fournis par @supabase/ssr : une réponse qui pose un cookie de
        // session ne doit jamais être servie depuis un cache à quelqu'un d'autre.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Rien entre createServerClient et getClaims : getClaims vérifie le jeton et le rafraîchit
  // si besoin, ce qui appelle setAll ci-dessus.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  // Ni les fichiers statiques, ni le moteur et les modèles des gestes (public/mediapipe) : ils n'ont
  // pas besoin de session, et une tablette hors ligne les charge sans attendre Supabase.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|mediapipe/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
