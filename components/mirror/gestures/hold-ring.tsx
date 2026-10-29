'use client';

import type { HoldAction, HoldView } from '@/lib/gestures';
import { useStore, type Store } from './store';

// Anneau de progression d'un geste tenu (docs/conception.md §5) : un cercle au trait, blanc, autour de l'icône du
// geste dans la légende du bas (pouce, poing, V), qui se remplit pendant la seconde de maintien.
// Toujours au même endroit, sous la silhouette : il ne cache ni le visage ni la légende. Aucune
// autre animation : ni transition, ni éclat.

/**
 * Un cercle de 50 px (au milieu du trait ; 52 px hors tout) autour de l'icône de 40 px : il dépasse
 * l'icône de 6 px de chaque côté, sans toucher son dessin, et reste à 10 px du mot qui la suit
 * (16 px après l'icône, Controls dans mirror.tsx). Il tient dans la hauteur de la légende.
 */
const SIZE = 52;
const RADIUS = 25;

export function HoldRing({ store, action }: { store: Store<HoldView | null>; action: HoldAction }) {
  const hold = useStore(store, null);
  if (!hold || hold.action !== action || hold.progress <= 0) return null;
  const center = SIZE / 2;
  return (
    <svg
      data-testid="mirror-hold-ring"
      data-action={action}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      aria-hidden
      focusable={false}
      className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-mirror-ink"
    >
      {/* Départ à midi, dans le sens des aiguilles d'une montre. */}
      <circle
        cx={center}
        cy={center}
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        pathLength={100}
        strokeDasharray={`${Math.min(1, hold.progress) * 100} 100`}
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  );
}
