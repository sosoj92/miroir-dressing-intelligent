'use client';

import { useRouter } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { pressFeedback } from '@/components/gestion/buttons';
import { fieldRowClass, Group } from '@/components/gestion/group';
import { MessageLine } from '@/components/gestion/message-line';
import { createClient } from '@/lib/supabase/browser';
import { SupabaseNotConfiguredError } from '@/lib/supabase/config';
import { afterSignInPath, fromMirrorCookie } from './after-sign-in';
import { CallbackError } from './callback-error';

// Connexion par mot de passe (docs/conception.md §4) : aucun e-mail, donc ni quota d'envoi (2 par heure avec
// le service d'e-mail de Supabase), ni lien grillé par un antivirus, ni contrainte de navigateur.
// Le lien par e-mail reste possible en secours. Ouverte depuis le miroir (?depuis=miroir), la
// connexion y ramène, par le mot de passe comme par le lien (table fixe : after-sign-in.ts). L'adresse
// est lue au moment de l'envoi : la page reste statique, sans useSearchParams. Seul le message d'un
// lien raté (CallbackError) attend la page chargée, dans la zone des messages, sous les champs :
// il n'arrive jamais au-dessus d'eux (rien ne bouge sous le doigt).

/** Champ sans bordure, sur toute la hauteur de la ligne (44 px) pour qu'on le touche facilement. */
const fieldClass = '-my-[11px] min-h-11 min-w-0 flex-1 bg-transparent text-body text-ink outline-none';

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string };

export function SignInForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  function readEmail(form: HTMLFormElement): string {
    return String(new FormData(form).get('email') ?? '').trim();
  }

  async function handlePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = readEmail(form);
    const password = String(new FormData(form).get('password') ?? '');
    if (!email || !password) return;

    setStatus({ kind: 'busy' });
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setStatus({
          kind: 'error',
          message:
            error.status === 429
              ? 'Trop de tentatives. Réessaie dans une minute.'
              : 'Adresse ou mot de passe incorrect.',
        });
        return;
      }

      // Le serveur vérifie que c'est bien le compte autorisé (ALLOWED_USER_ID).
      const response = await fetch('/api/me', { cache: 'no-store' });
      if (response.status === 403) {
        await supabase.auth.signOut();
        setStatus({ kind: 'error', message: "Ce compte n'a pas accès à Mon Dressing." });
        return;
      }
      if (!response.ok) {
        setStatus({ kind: 'error', message: 'La connexion a échoué. Réessaie.' });
        return;
      }
      router.replace(afterSignInPath(window.location.search));
      router.refresh();
    } catch (error) {
      setStatus({
        kind: 'error',
        message:
          error instanceof SupabaseNotConfiguredError
            ? "La connexion n'est pas encore configurée."
            : 'La connexion a échoué. Réessaie.',
      });
    }
  }

  async function handleMagicLink(form: HTMLFormElement | null) {
    const email = form ? readEmail(form) : '';
    if (!email) {
      setStatus({ kind: 'error', message: "Tape d'abord ton adresse e-mail." });
      return;
    }

    setStatus({ kind: 'busy' });
    // Le retour au miroir voyage dans un cookie court (after-sign-in.ts) : l'adresse du lien reste
    // celle déclarée chez Supabase. Le lien s'ouvre dans ce navigateur (PKCE), qui a le cookie.
    document.cookie = fromMirrorCookie(window.location.search, window.location.protocol === 'https:');
    try {
      // Client créé ici et pas au rendu : la page s'affiche même sans Supabase configuré.
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false, // inscriptions fermées (docs/conception.md §4)
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        setStatus({
          kind: 'error',
          message:
            error.status === 429
              ? 'Trop de demandes. Réessaie dans une minute.'
              : "Le lien n'a pas pu être envoyé. Vérifie l'adresse.",
        });
        return;
      }
      setStatus({ kind: 'sent', email });
    } catch (error) {
      setStatus({
        kind: 'error',
        message:
          error instanceof SupabaseNotConfiguredError
            ? "La connexion n'est pas encore configurée."
            : "Le lien n'a pas pu être envoyé. Réessaie.",
      });
    }
  }

  const busy = status.kind === 'busy';

  return (
    <form onSubmit={handlePassword} className="flex flex-col gap-4">
      {/* Un seul encart, une ligne par champ, chacune avec son vrai <label>. Libellés de même
          largeur : les deux champs commencent au même endroit. */}
      <Group>
        <div className={fieldRowClass}>
          <label htmlFor="email" className="w-32 shrink-0">
            Adresse e-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            className={fieldClass}
          />
        </div>
        <div className={fieldRowClass}>
          <label htmlFor="password" className="w-32 shrink-0">
            Mot de passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={fieldClass}
          />
        </div>
      </Group>

      <button
        type="submit"
        disabled={busy}
        className="rounded-xl bg-accent px-4 py-3 text-body font-semibold text-on-accent disabled:opacity-60"
      >
        {busy ? 'Connexion…' : 'Se connecter'}
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={(event) => handleMagicLink(event.currentTarget.form)}
        className={`inline-flex min-h-11 items-center self-start text-body text-accent disabled:text-muted ${pressFeedback}`}
      >
        Recevoir un lien par e-mail
      </button>

      {/* Lien envoyé en gris ; un échec de la couleur du texte, pour qu'il ne passe pas pour une
          confirmation. Un seul bloc : le formulaire garde son espacement. Le message d'un lien
          raté (?erreur=) y reste jusqu'au premier essai, qui le remplace. */}
      <div>
        {status.kind === 'idle' ? (
          <Suspense fallback={null}>
            <CallbackError />
          </Suspense>
        ) : null}
        <MessageLine
          message={
            status.kind === 'sent'
              ? { text: `Lien envoyé à ${status.email}. Ouvre-le dans ce navigateur.`, error: false }
              : status.kind === 'error'
                ? { text: status.message, error: true }
                : null
          }
        />
      </div>
    </form>
  );
}
