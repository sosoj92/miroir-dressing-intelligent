'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { pressFeedback } from './buttons';

// Écran du téléphone qui n'a pas pu lire ses données (réseau coupé, Supabase lent) : la phrase à la
// place du contenu, de la couleur du texte, puis « Réessayer », qui relit la page sans la recharger
// (router.refresh) au lieu d'une consigne à interpréter, au même endroit sur chaque écran. Sans
// code d'erreur, ni rouge ni icône.

export function LoadError({ children }: { children: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col">
      <p role="alert" className="text-body text-ink">
        {children}
      </p>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        aria-busy={pending || undefined}
        className={`flex min-h-11 items-center self-start text-body text-accent disabled:text-muted ${pressFeedback}`}
      >
        {pending ? 'Un instant…' : 'Réessayer'}
      </button>
    </div>
  );
}
