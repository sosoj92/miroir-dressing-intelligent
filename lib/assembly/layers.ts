import type { Assembly, Item } from '@/lib/types';

// Quelles photos assembler pour une tenue (docs/conception.md §7) : une robe seule ; sinon la photo du haut
// (la veste s'il y en a une, sinon le haut) au-dessus de celle du bas. Chaussures et accessoires
// ne sont pas dessinés. Si une pièce nécessaire n'a pas de photo portée, pas d'assemblage (null) :
// l'écran affiche alors les pièces autrement.

export type AssembledPiece<T extends Item = Item> = T & { assembly: Assembly };

export type AssemblyLayers<T extends Item = Item> =
  | { kind: 'single'; piece: AssembledPiece<T> }
  | { kind: 'pair'; upper: AssembledPiece<T>; lower: AssembledPiece<T> };

function assembled<T extends Item>(item: T | undefined): item is AssembledPiece<T> {
  return Boolean(item?.assembly);
}

export function assemblyLayers<T extends Item>(itemIds: readonly string[], itemsById: ReadonlyMap<string, T>): AssemblyLayers<T> | null {
  const pieces = itemIds.map((id) => itemsById.get(id)).filter((item): item is T => item !== undefined);
  const dress = pieces.find((item) => item.category === 'robe');
  const jacket = pieces.find((item) => item.category === 'veste');
  const top = pieces.find((item) => item.category === 'haut');
  const bottom = pieces.find((item) => item.category === 'bas');

  if (dress) {
    // Une robe sous une veste n'est pas assemblable (pas de photo robe + veste) : la robe seule.
    return assembled(dress) ? { kind: 'single', piece: dress } : null;
  }
  const upper = jacket ?? top;
  if (!upper || !bottom) return null;
  if (!assembled(upper) || !assembled(bottom)) return null;
  return { kind: 'pair', upper, lower: bottom };
}
