'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { ChevronLeft } from '@/components/gestion/icons';
import { backLinkClass } from '@/components/gestion/page-shell';
import { openedFromGrid } from '@/lib/items/grid';
import { readPlace } from './grid-place';

const GRID_PATH = '/gestion/garde-robe';

/**
 * « ‹ Garde-robe » de la fiche et de la vue « au sale ». Page ouverte depuis la grille (place
 * gardée pour cette page) : retour par l'historique, la grille revient à sa catégorie et à son
 * défilement. Sinon (adresse ouverte directement, fiche d'une pièce qu'on vient d'ajouter) : un
 * lien normal.
 * La place n'est pas effacée ici : la grille le fait en la rétablissant.
 */
export function GridBackLink() {
  const router = useRouter();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // Nouvel onglet, nouvelle fenêtre… : le comportement du lien.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!openedFromGrid(readPlace(), window.location.pathname)) return;
    event.preventDefault();
    router.back();
  }

  return (
    <Link href={GRID_PATH} onClick={handleClick} className={backLinkClass}>
      <ChevronLeft />
      Garde-robe
    </Link>
  );
}
