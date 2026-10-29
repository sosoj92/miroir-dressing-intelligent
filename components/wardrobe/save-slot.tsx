'use client';

import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { pressFeedback } from '@/components/gestion/buttons';

// « Enregistrer » dans la ligne retour (PhonePage, emplacement action), relié au formulaire de la
// fiche par form={formId} : il reste visible quand on fait défiler. Le formulaire est rendu plus
// bas, après la lecture de la session (<Suspense>) ; il signale son état ici, et le bouton
// n'apparaît qu'avec lui (rien sans session, pendant le chargement, ni avant la relecture de l'ajout).

/** État signalé par le formulaire. */
export type SaveState = {
  /** Quelque chose à enregistrer : fiche changée, ou nouvelle pièce. */
  canSave: boolean;
  pending: boolean;
  /** Enregistrement réussi, rien de changé depuis : « Enregistré. ». */
  saved: boolean;
};

type Slot = { formId: string; report: (state: SaveState | null) => void };

const SlotContext = createContext<Slot | null>(null);
const StateContext = createContext<SaveState | null>(null);

/** À placer autour de PhonePage : le bouton (action) et le formulaire (contenu) partagent l'état. */
export function SaveSlot({ children }: { children: ReactNode }) {
  const formId = useId();
  const [state, setState] = useState<SaveState | null>(null);
  const slot = useMemo(() => ({ formId, report: setState }), [formId]);
  return (
    <SlotContext value={slot}>
      <StateContext value={state}>{children}</StateContext>
    </SlotContext>
  );
}

/**
 * Pour le formulaire : signale son état au bouton tant qu'il est affiché, et renvoie l'id à
 * donner au <form> (undefined hors d'un SaveSlot).
 */
export function useSaveSlot({ canSave, pending, saved }: SaveState): string | undefined {
  const slot = useContext(SlotContext);
  const report = slot?.report;
  useEffect(() => {
    report?.({ canSave, pending, saved });
  }, [report, canSave, pending, saved]);
  // Formulaire retiré (« Recommencer », autre page) : le bouton disparaît avec lui.
  useEffect(() => () => report?.(null), [report]);
  return slot?.formId;
}

/** « Enregistrer », grisé tant qu'il n'y a rien à enregistrer, et « Enregistré. » à côté. */
export function SaveButton() {
  const slot = useContext(SlotContext);
  const state = useContext(StateContext);
  if (!slot || !state) return null;

  return (
    <div className="flex items-center gap-3">
      <p role="status" aria-live="polite" className="text-footnote text-muted">
        {state.saved ? 'Enregistré.' : ''}
      </p>
      <button
        type="submit"
        form={slot.formId}
        disabled={!state.canSave || state.pending}
        aria-busy={state.pending || undefined}
        className={`flex min-h-11 shrink-0 items-center text-body font-semibold text-accent disabled:text-muted ${pressFeedback}`}
      >
        Enregistrer
      </button>
    </div>
  );
}
