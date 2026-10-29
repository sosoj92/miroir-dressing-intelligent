// Titre simple de secours d'une tenue, sans réseau (docs/conception.md §6) : « Pull marine et jean brut »,
// « Pull marine, jean brut et trench ». Seules les pièces principales et la veste sont nommées :
// avec les chaussures et l'accessoire, le titre deviendrait une liste.

/** Titre utilisé quand aucune pièce nommée n'est disponible. */
export const FALLBACK_TITLE = 'Tenue du jour';

function clean(name: unknown): string {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
}

function upperFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1);
}

/** « Jean brut » → « jean brut », mais un sigle (« AC/DC ») garde sa majuscule. */
function lowerFirst(text: string): string {
  const second = text.charAt(1);
  const secondIsUpperLetter = second !== second.toLocaleLowerCase('fr-FR');
  if (secondIsUpperLetter) return text;
  return text.charAt(0).toLocaleLowerCase('fr-FR') + text.slice(1);
}

/** Noms dans l'ordre voulu (haut ou robe, bas, veste) → titre en français. */
export function outfitTitle(names: readonly unknown[]): string {
  const parts = names.map(clean).filter((name) => name.length > 0);
  if (parts.length === 0) return FALLBACK_TITLE;
  const words = [upperFirst(parts[0]), ...parts.slice(1).map(lowerFirst)];
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(', ')} et ${words[words.length - 1]}`;
}

/** Une pièce, pour la légende : son nom et sa catégorie. */
export type CaptionPiece = { name: string; category: string };

/**
 * Légende d'une tenue (docs/conception.md §4) : ce que montre la silhouette, une pièce par ligne, dans l'ordre où
 * on la voit, puis la pièce cachée en note.
 * - veste et bas : lignes [veste, bas], note « Sous la veste : <haut> » ;
 * - haut et bas : lignes [haut, bas], sans note ;
 * - robe : ligne [robe], note « Par-dessus : <veste> » s'il y en a une.
 * Chaussures et accessoires ne sont pas nommés (la silhouette ne les dessine pas). `stacked` :
 * les pièces sont montrées l'une sous l'autre (pas de silhouette), chacune a sa ligne, sans note.
 */
export function outfitCaption(
  pieces: readonly CaptionPiece[],
  stacked = false,
): { lines: string[]; note: string | null } {
  const of = (category: string) => pieces.find((piece) => piece.category === category);
  const name = (piece: CaptionPiece | undefined) => (piece ? clean(piece.name) : '');
  const dress = of('robe');
  const jacket = of('veste');
  const top = of('haut');
  const bottom = of('bas');

  let lines: string[];
  let note: string | null = null;
  if (stacked) {
    lines = [jacket, dress ?? top, dress ? undefined : bottom].map(name);
  } else if (dress) {
    lines = [name(dress)];
    if (name(jacket)) note = `Par-dessus : ${lowerFirst(name(jacket))}`;
  } else if (jacket) {
    lines = [name(jacket), name(bottom)];
    if (name(top)) note = `Sous la veste : ${lowerFirst(name(top))}`;
  } else {
    lines = [name(top), name(bottom)];
  }
  lines = lines.filter((line) => line.length > 0).map(upperFirst);
  return { lines: lines.length > 0 ? lines : [FALLBACK_TITLE], note };
}
