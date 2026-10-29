'use client';

import { unstable_rethrow } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteItem } from '@/app/gestion/garde-robe/actions';
import { Group, centeredButtonRowClass } from '@/components/gestion/group';

/**
 * Suppression en deux temps, à part en bas de la fiche : « Supprimer ce vêtement », puis
 * « Supprimer » ou « Annuler » sur place (jamais window.confirm). Ni fond prune ni rouge : rien
 * ne la confond avec « Enregistrer ».
 */
export function DeleteItem({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteItem(id); // redirige vers la grille en cas de succès
        if (!result.ok) setError(result.error);
      } catch (caught) {
        unstable_rethrow(caught);
        setError('La connexion a été coupée. Réessaie.');
      }
    });
  }

  // mt-2 : 40 px au-dessus avec l'écart des groupes de la fiche (gap-8), pour l'isoler.
  if (!confirming) {
    return (
      <Group className="mt-2">
        <button type="button" onClick={() => setConfirming(true)} className={centeredButtonRowClass}>
          Supprimer ce vêtement
        </button>
      </Group>
    );
  }

  return (
    <div className="mt-2 flex flex-col">
      <p className="px-4 pb-1.5 text-footnote text-muted">
        Le vêtement sera effacé, et ses photos si aucune autre pièce ne s&apos;en sert.
      </p>
      <Group>
        <button
          type="button"
          onClick={confirm}
          disabled={pending}
          aria-busy={pending || undefined}
          className={`${centeredButtonRowClass} font-semibold`}
        >
          {pending ? 'Suppression…' : 'Supprimer'}
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
      {error ? (
        <p role="alert" className="px-4 pt-1.5 text-footnote text-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
