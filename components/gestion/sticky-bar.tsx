'use client';

import { useCallback, type ReactNode } from 'react';
import { isStuck, stuckRootMargin } from './sticky-edge';

/**
 * Filet gris neutre de 1 px sous un en-tête collé, posé seulement quand il est collé (data-stuck) :
 * au repos rien ne le sépare du contenu ; quand le contenu glisse dessous, le filet le dit, au lieu
 * de couper les photos net. Ni ombre ni flou. Dessiné hors de la boîte (::after, top-full) : la
 * hauteur de l'en-tête ne change pas. Sur la garde-robe, la barre n'en a pas (PhonePage,
 * `edge={false}`) : seule la bande, l'en-tête collé le plus bas, le montre, quand les photos
 * passent dessous.
 */
export const stuckEdgeClass =
  'after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-px data-stuck:after:bg-separator';

/**
 * Ref à donner à l'élément collé à `offset` px du haut (sa valeur `top`) : data-stuck y est posé
 * tant qu'il est collé. Un attribut posé directement, sans rendu React : il change pendant le
 * défilement. Une ref fonction : l'observateur suit l'élément même s'il n'apparaît qu'après coup.
 */
export function useStuckMarker<T extends HTMLElement>(offset: number) {
  return useCallback(
    (element: T | null) => {
      if (!element || typeof IntersectionObserver === 'undefined') return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (isStuck(entry.boundingClientRect.top, offset)) element.setAttribute('data-stuck', '');
          else element.removeAttribute('data-stuck');
        },
        { rootMargin: stuckRootMargin(offset), threshold: 1 },
      );
      observer.observe(element);
      return () => {
        observer.disconnect();
        element.removeAttribute('data-stuck');
      };
    },
    [offset],
  );
}

/**
 * Barre du haut de PhonePage : collée en haut, opaque, avec son filet quand le contenu passe dessous
 * (`edge`, par défaut). Sans `edge`, ni filet ni observateur : un en-tête collé plus bas le porte.
 */
export function StickyBar({ edge = true, children }: { edge?: boolean; children: ReactNode }) {
  const ref = useStuckMarker<HTMLDivElement>(0);
  return (
    // -mx-4 px-4 : elle couvre aussi les marges, sinon le contenu resterait visible sur les côtés.
    <div
      ref={edge ? ref : undefined}
      className={`sticky top-0 z-10 -mx-4 flex min-h-11 items-center justify-between gap-4 bg-canvas px-4 ${edge ? stuckEdgeClass : ''}`}
    >
      {children}
    </div>
  );
}
