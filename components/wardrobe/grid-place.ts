import { RETURN_KEY, decodeReturn, encodeReturn, type GridReturn } from '@/lib/items/grid';
import type { Category } from '@/lib/types';

// Place gardée dans la grille (sessionStorage, lib/items/grid.ts), dans le navigateur seulement :
// écrite par la grille en ouvrant une fiche, relue par la grille à son retour et par le lien
// retour de la fiche.

/** sessionStorage, ou null s'il est inaccessible (navigation privée, stockage bloqué). */
function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Garde la place dans la grille avant d'ouvrir `to` (une fiche, ou la vue « au sale »). */
export function keepPlace(category: Category | null, to: string) {
  try {
    session()?.setItem(RETURN_KEY, encodeReturn({ y: window.scrollY, category, at: Date.now(), to }));
  } catch {
    // Stockage plein ou refusé : le retour se fera en haut de la grille.
  }
}

/** Place gardée, ou null ; une place illisible ou trop ancienne est effacée. */
export function readPlace(): GridReturn | null {
  try {
    const raw = session()?.getItem(RETURN_KEY) ?? null;
    const place = decodeReturn(raw, Date.now());
    if (raw !== null && !place) forgetPlace();
    return place;
  } catch {
    return null;
  }
}

/** La place ne sert qu'au premier retour. */
export function forgetPlace() {
  try {
    session()?.removeItem(RETURN_KEY);
  } catch {
    // Rien à faire : elle expirera (RETURN_MAX_AGE_MS).
  }
}
