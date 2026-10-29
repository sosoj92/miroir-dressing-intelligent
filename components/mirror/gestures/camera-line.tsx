'use client';

import { cameraLine } from '@/lib/mirror/camera';
import type { CameraState } from './camera';
import { useStore, type Store } from './store';

// Caméra refusée ou occupée, gestes indisponibles (docs/conception.md §4, §5) : une seule petite ligne grise,
// juste sous la météo, dans le bas de l'en-tête et la marge de la silhouette (au-dessus de la toile :
// elle ne touche jamais la tête). Posée par-dessus la mise en page (position absolue) : la
// silhouette ne bouge pas, ses yeux restent au même point. Pas de caméra : rien. Le clavier marche
// toujours.
export function CameraLine({ camera }: { camera: Store<CameraState> }) {
  const { status } = useStore(camera, { status: 'off', delegate: null });
  const text = cameraLine(status);
  if (!text) return null;
  return (
    <p
      data-testid="mirror-camera"
      role="status"
      className="absolute top-full left-1/2 -translate-x-1/2 whitespace-nowrap text-mirror-sm text-mirror-dim"
    >
      {text}
    </p>
  );
}
