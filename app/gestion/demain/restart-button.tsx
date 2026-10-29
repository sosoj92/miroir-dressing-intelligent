'use client';

import { unstable_rethrow } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Group, centeredButtonRowClass } from '@/components/gestion/group';
import { restartTomorrow } from './actions';

// « Recommencer le choix » (docs/conception.md §4, §5) : un premier appui dit ce qui sera effacé, le second
// confirme. La page se recharge (refresh) avec les tenues du départ ; le miroir les reprend à sa
// prochaine lecture des données. Même recette que la suppression d'une pièce (delete-item.tsx) :
// une ligne d'encart de la couleur du texte, puis la confirmation sur place. Ni prune, qui sert à
// ce qui garde (« Garder pour demain », juste au-dessus), ni rouge. Une connexion coupée s'écrit
// sous les boutons, comme un refus du serveur, au lieu de remplacer la page par l'écran d'erreur.

/** Ce qui sera effacé, en une phrase. */
export function restartWarning(hasPlan: boolean, refused: number): string {
  if (hasPlan && refused > 0) return 'Ta tenue gardée et tes refus pour demain seront effacés, sur le miroir aussi.';
  if (hasPlan) return 'Ta tenue gardée pour demain sera effacée.';
  return 'Les tenues refusées pour demain reviendront, sur le miroir aussi.';
}

type Props = {
  /** Le « demain » affiché par la page : le serveur refuse s'il a changé (page restée ouverte). */
  date: string;
  hasPlan: boolean;
  refused: number;
};

export function RestartButton({ date, hasPlan, refused }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    setError('');
    startTransition(async () => {
      try {
        const result = await restartTomorrow(date);
        if (result.ok) setConfirming(false);
        else setError(result.error);
      } catch (caught) {
        unstable_rethrow(caught);
        setError('La connexion a été coupée. Réessaie.');
      }
    });
  }

  if (!confirming) {
    return (
      <Group>
        <button type="button" onClick={() => setConfirming(true)} className={centeredButtonRowClass}>
          Recommencer le choix
        </button>
      </Group>
    );
  }

  return (
    <div className="flex flex-col">
      <p className="px-4 pb-1.5 text-footnote text-muted">{restartWarning(hasPlan, refused)}</p>
      <Group>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={pending}
          aria-busy={pending || undefined}
          className={`${centeredButtonRowClass} font-semibold`}
        >
          {pending ? 'Un instant…' : 'Recommencer'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className={`${centeredButtonRowClass} text-accent`}
        >
          Annuler
        </button>
      </Group>
      {error && (
        <p role="alert" className="px-4 pt-1.5 text-footnote text-ink">
          {error}
        </p>
      )}
    </div>
  );
}
