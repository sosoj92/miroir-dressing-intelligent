// Où mène la connexion (docs/conception.md §4, Connexion) : une table fixe, jamais une adresse lue dans l'URL,
// pour qu'aucun lien ne puisse renvoyer ailleurs (redirection ouverte). « Se connecter », sur le
// miroir non connecté, ouvre /connexion?depuis=miroir : la tablette revient au miroir. Toute autre
// valeur, ou rien, mène à l'accueil du téléphone.
// - Mot de passe : le formulaire lit window.location.search au moment de l'envoi (sans
//   useSearchParams).
// - Lien par e-mail : le formulaire pose un cookie court, de valeur fixe, que /auth/callback lit
//   puis efface. L'adresse du lien reste …/auth/callback tout court, celle déclarée dans les
//   Redirect URLs de Supabase (supabase/README.md) : Supabase compare toute l'adresse, query
//   comprise, et un « ?depuis=miroir » y ferait refuser le lien.

const FROM_PARAM = 'depuis';
const FROM_MIRROR = 'miroir';

/** Cookie du lien par e-mail, envoyé seulement à /auth/callback. */
export const FROM_COOKIE = 'connexion-depuis';
const FROM_COOKIE_PATH = '/auth';
/** Durée de vie d'un lien par e-mail chez Supabase (1 h par défaut) : le cookie ne dure pas plus. */
const FROM_COOKIE_MAX_AGE_S = 3600;

/** La table : « miroir » mène au miroir (`/`), toute autre valeur ou rien à l'accueil du téléphone. */
export function destination(from: string | null | undefined): '/' | '/gestion' {
  return from === FROM_MIRROR ? '/' : '/gestion';
}

/** Après le mot de passe : l'adresse de la page de connexion (`window.location.search`). */
export function afterSignInPath(search: string | URLSearchParams): '/' | '/gestion' {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return destination(params.get(FROM_PARAM));
}

/**
 * À écrire dans `document.cookie` juste avant de demander un lien : le retour au miroir si la page
 * vient du miroir, sinon l'effacement (un lien demandé ensuite depuis le téléphone n'en hérite pas).
 */
export function fromMirrorCookie(search: string, secure: boolean): string {
  const scope = `Path=${FROM_COOKIE_PATH}; SameSite=Lax${secure ? '; Secure' : ''}`;
  return afterSignInPath(search) === '/'
    ? `${FROM_COOKIE}=${FROM_MIRROR}; Max-Age=${FROM_COOKIE_MAX_AGE_S}; ${scope}`
    : `${FROM_COOKIE}=; Max-Age=0; ${scope}`;
}

/** Options pour effacer ce cookie depuis /auth/callback (même chemin que celui du formulaire). */
export const CLEAR_FROM_COOKIE = { path: FROM_COOKIE_PATH, maxAge: 0 } as const;

/**
 * Retour à la connexion après un lien raté : « depuis=miroir » sur l'adresse déjà construite si le
 * cookie venait du miroir, pour le nouvel essai. Jamais la valeur reçue telle quelle.
 */
export function keepFromMirror(url: URL, from: string | null | undefined): void {
  if (destination(from) === '/') url.searchParams.set(FROM_PARAM, FROM_MIRROR);
}
