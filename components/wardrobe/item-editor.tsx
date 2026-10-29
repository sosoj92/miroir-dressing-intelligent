'use client';

import { updateItem } from '@/app/gestion/garde-robe/actions';
import type { ItemDraft } from '@/lib/types';
import { ItemForm } from './item-form';

/** Correction de la fiche d'une pièce enregistrée ; on reste sur la fiche après l'enregistrement. */
export function ItemEditor({ id, draft }: { id: string; draft: ItemDraft }) {
  async function save(next: ItemDraft): Promise<string | null> {
    try {
      const result = await updateItem(id, next);
      return result.ok ? null : result.error;
    } catch {
      return 'La connexion a été coupée. Réessaie.';
    }
  }

  return <ItemForm initialDraft={draft} onSubmit={save} editing />;
}
