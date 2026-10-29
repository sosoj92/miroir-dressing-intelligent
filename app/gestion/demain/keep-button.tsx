'use client';

import { unstable_rethrow } from 'next/navigation';
import { useState, useTransition } from 'react';
import { pressFeedback } from '@/components/gestion/buttons';
import { keepForTomorrow } from './actions';

// « Garder » : la page se recharge (refresh) et la tenue passe en tête, « Prévue pour demain ».
// On remonte en haut pour la voir, sans animation si l'appareil demande de réduire les animations.
// Un bouton texte, sans fond : le bouton plein reste réservé à l'action principale d'un écran.
// En gras seulement pour « Garder pour demain » (`prominent`), l'action qui valide l'écran ; les
// « Garder » des cases restent en écriture normale, comme « Remettre ». Un échec (connexion coupée
// comprise) s'écrit sous le bouton, comme pour « Supprimer ce vêtement » (delete-item.tsx).
export function KeepButton({ itemIds, label, prominent = false }: { itemIds: string[]; label: string; prominent?: boolean }) {
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setError('');
    startTransition(async () => {
      try {
        const result = await keepForTomorrow(itemIds);
        if (!result.ok) {
          setError(result.error);
          return;
        }
      } catch (caught) {
        unstable_rethrow(caught);
        setError('La connexion a été coupée. Réessaie.');
        return;
      }
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduced ? 'instant' : 'smooth' });
    });
  }

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-busy={pending}
        className={`min-h-11 w-full px-2 text-body text-accent disabled:text-muted ${pressFeedback} ${prominent ? 'font-semibold' : ''}`}
      >
        {pending ? 'Enregistrement…' : label}
      </button>
      {error && (
        <p role="alert" className="text-center text-footnote text-ink">
          {error}
        </p>
      )}
    </div>
  );
}
