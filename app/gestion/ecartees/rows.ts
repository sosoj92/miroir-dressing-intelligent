import { outfitCaption } from '@/lib/outfits';
import type { Category } from '@/lib/types';

// Lignes de « Tenues écartées » (docs/conception.md §6) : chaque refus s'écrit comme la légende du miroir et de
// Demain (outfitCaption), une pièce par ligne dans l'ordre où on la voit (la veste puis le bas, le
// haut puis le bas, ou la robe), puis la pièce cachée en note (« Sous la veste : … », pour les refus
// de l'ancien format). Une pièce effacée depuis est signalée à part. Sans image (décision D, option 1).

export type Refusal = { id: string; item_ids: string[] | null };
export type RefusedPiece = { id: string; name: string; category: Category };

export type DismissedRow = {
  id: string;
  /** Les pièces vues, une par ligne. */
  lines: string[];
  /** La pièce cachée (« Sous la veste : … », « Par-dessus : … »), en gris. */
  note: string | null;
  /** « Pièce supprimée » si une pièce du refus n'existe plus, en gris. */
  missing: string | null;
};

/** Ce que la légende nomme : la silhouette ne dessine ni chaussures ni accessoire. */
const NAMED: ReadonlySet<Category> = new Set(['robe', 'veste', 'haut', 'bas']);

export function missingLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? 'Pièce supprimée' : `${count} pièces supprimées`;
}

/** Les refus (du plus récent au plus ancien) et les pièces de la garde-robe → les lignes de la page. */
export function dismissedRows(refusals: readonly Refusal[], items: readonly RefusedPiece[]): DismissedRow[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return refusals.map((refusal) => {
    const ids = refusal.item_ids ?? [];
    const known = ids.flatMap((id) => {
      const piece = byId.get(id);
      return piece ? [piece] : [];
    });
    const missing = missingLabel(ids.length - known.length);
    // Il ne reste rien que la légende nomme (pièces recatégorisées, ou toutes effacées) : les
    // noms restants, un par ligne, plutôt que « Tenue du jour ».
    if (!known.some((piece) => NAMED.has(piece.category))) {
      return { id: refusal.id, lines: known.map((piece) => piece.name), note: null, missing };
    }
    const { lines, note } = outfitCaption(known);
    return { id: refusal.id, lines, note, missing };
  });
}
