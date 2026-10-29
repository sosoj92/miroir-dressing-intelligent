// Filet sous un en-tête collé du téléphone (barre retour de PhonePage, bande de la garde-robe) :
// il n'apparaît que quand l'en-tête est arrivé à sa place collée, c'est-à-dire quand le contenu
// glisse dessous. Fonctions pures, pour l'IntersectionObserver de sticky-bar.tsx.

/**
 * Marge de l'observateur : la fenêtre réduite en haut jusqu'à un pixel sous la place collée
 * (`offset`, la valeur de `top`). L'en-tête en sort d'un pixel dès qu'il est collé, et
 * l'observateur (seuil 1) le signale à ce moment-là, sans écouter le défilement.
 */
export function stuckRootMargin(offset: number): string {
  return `-${offset + 1}px 0px 0px 0px`;
}

/**
 * L'en-tête est collé : son haut est passé au-dessus du bord de la fenêtre réduite (`offset + 1`).
 * Le même bord que l'observateur : il ne rappelle qu'une fois au passage, et le haut rapporté peut
 * alors tomber n'importe où sous ce bord (défilement au doigt par tiers de pixel), par exemple à
 * `offset + 0,7`. Un en-tête qui dépasse en bas de la fenêtre (rapport < 1 lui aussi) n'est pas
 * collé : seul le haut compte.
 */
export function isStuck(top: number, offset: number): boolean {
  return top < offset + 1;
}
