import Link from 'next/link';
import type { ReactNode } from 'react';
import { pressFeedback } from './buttons';
import { ChevronLeft } from './icons';
import { StickyBar } from './sticky-bar';

// Gabarit des écrans du téléphone : lien retour, titre, contenu. Le même pour tous les écrans
// (accueil, connexion, garde-robe, demain, réglages, import), pour que le retour et le titre ne
// bougent pas : le titre est à 84 px du haut partout. Le titre fait partie de la coquille
// statique ; tout ce qui lit la session va dans un <Suspense>.
// Sans `title`, c'est la page qui rend son propre <h1> (fiche d'un vêtement : son nom).

export type BackTarget = { href: string; label: string };

const HOME: BackTarget = { href: '/gestion', label: 'Mon Dressing' };

/** Classe du lien retour, aussi pour un lien retour fait à la main (`backLink`). */
export const backLinkClass = `-ml-1 flex min-h-11 items-center gap-0.5 text-body text-accent ${pressFeedback}`;

export function PhonePage({
  title,
  back = HOME,
  backLink,
  action,
  edge = true,
  children,
}: {
  title?: string;
  /**
   * Lien retour, vers l'accueil par défaut. `null` sur un écran racine (accueil, connexion) : la
   * barre reste, vide, comme la barre de navigation d'un iPhone au-dessus d'un grand titre.
   */
  back?: BackTarget | null;
  /** Lien retour fait à la main, à la place de `back` (fiche : retour par l'historique). */
  backLink?: ReactNode;
  /** Action à droite du lien retour (« Enregistrer », « Ajouter ») : visible même en faisant défiler. */
  action?: ReactNode;
  /**
   * Filet sous la barre quand le contenu passe dessous (par défaut). `false` sur la garde-robe : sa
   * bande collée, juste dessous, porte le filet, seulement quand les photos y glissent.
   */
  edge?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 pt-4 pb-16">
      {/* Collée en haut, opaque, sans flou ni ombre ; un filet dessous quand le contenu y glisse. */}
      <StickyBar edge={edge}>
        {backLink ??
          (back ? (
            <Link href={back.href} className={backLinkClass}>
              <ChevronLeft />
              {back.label}
            </Link>
          ) : (
            // Sans retour : l'action reste à droite.
            <span aria-hidden="true" />
          ))}
        {action}
      </StickyBar>
      {title && <h1 className="text-title">{title}</h1>}
      {children}
    </main>
  );
}
