'use client';

import { unstable_rethrow } from 'next/navigation';
import { useState, useTransition } from 'react';
import { pressFeedback } from '@/components/gestion/buttons';
import { restoreRefusal } from './actions';

// « Remettre » : un bouton texte à droite de la ligne ; la page se recharge (refresh) sans cette
// tenue. -my-[11px] : comme un contrôle de Row, ses 44 px à toucher ne grandissent pas la ligne.
// Un échec s'écrit de la couleur du texte, comme pour « Garder » (keep-button.tsx), connexion coupée
// comprise : sur toute la largeur de la ligne, sous les noms (le bouton et le message sont des
// enfants de la ligne, qui passe à la ligne : flex-wrap dans dismissed-list.tsx).
export function RestoreButton({ id }: { id: string }) {
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setError('');
    startTransition(async () => {
      try {
        const result = await restoreRefusal(id);
        if (!result.ok) setError(result.error);
      } catch (caught) {
        unstable_rethrow(caught);
        setError('La connexion a été coupée. Réessaie.');
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={`-my-[11px] min-h-11 shrink-0 text-body text-accent disabled:text-muted ${pressFeedback}`}
      >
        {pending ? 'Un instant…' : 'Remettre'}
      </button>
      {error && (
        <p role="alert" className="basis-full pt-1.5 text-footnote text-ink">
          {error}
        </p>
      )}
    </>
  );
}
