// Attentes de la session et des pièces, sans animation, à la forme exacte des vraies grilles
// (components/wardrobe/wardrobe-grid.tsx) : les carrés gris tombent à la place des vignettes, et
// les photos arrivent sans descendre.

/** Six carrés gris à la place des vignettes, avec leur légende de deux lignes (vide). */
function Squares() {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-6">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="flex flex-col gap-2">
          <div className="aspect-square w-full rounded-xl bg-surface" />
          <div className="min-h-10" />
        </li>
      ))}
    </ul>
  );
}

/**
 * Garde-robe : la ligne du compte (« 24 pièces · 3 au sale », une ligne de 20 px), puis la bande
 * de catégorie (44 px de haut, sa marge intérieure déborde : -my-2 py-2), vides et sans gris,
 * puis les carrés. Deux enfants de la page, comme WardrobeGrid : le même espacement entre eux.
 */
export function GridFallback() {
  return (
    <>
      <p aria-hidden="true" className="text-footnote">
        &nbsp;
      </p>
      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="min-h-11" />
        <Squares />
      </div>
    </>
  );
}

/** Au sale : la ligne du premier titre de catégorie (vide), puis les carrés, comme DirtyGrid. */
export function DirtyFallback() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <p className="text-body">&nbsp;</p>
      <Squares />
    </div>
  );
}
