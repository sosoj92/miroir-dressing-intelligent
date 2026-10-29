import Link from 'next/link';
import { pressFeedback } from '@/components/gestion/buttons';

// Écran Ajouter (docs/conception.md §4, écran 3) : la phrase au-dessus des deux boutons photo, et l'attente de la
// session, qui la montre déjà à sa place (elle ne dépend de rien).

/** Une seule explication : ce que donne une photo à plat, et où va une photo portée (Importer). */
export function AddItemHint() {
  return (
    <p className="text-footnote text-muted">
      Photo à plat : sur le miroir, ses tenues s&apos;afficheront en pièces séparées, pas sur ta silhouette.
      Photo portée : passe par{' '}
      {/* before: zone à toucher de 44 px de haut, centrée sur le texte, sans le décaler (une
          hauteur fixe : celle du texte dépend de la police). */}
      <Link
        href="/gestion/import"
        className={`relative text-accent before:absolute before:-inset-x-1 before:top-1/2 before:h-11 before:-translate-y-1/2 ${pressFeedback}`}
      >
        Importer
      </Link>
      .
    </p>
  );
}

/**
 * En attente de la session : la phrase, puis la place des deux boutons (« Prendre une photo », plein :
 * py-3 et une ligne de 22 px ; « Choisir dans la galerie », ligne d'encart de 44 px), gris comme les
 * autres attentes, sans animation. Les boutons arrivent à la même place.
 */
export function AddItemFallback() {
  return (
    <div className="flex flex-col gap-4">
      <AddItemHint />
      <div aria-hidden="true" className="h-[46px] rounded-xl bg-surface" />
      <div aria-hidden="true" className="min-h-11 rounded-xl bg-surface" />
    </div>
  );
}
