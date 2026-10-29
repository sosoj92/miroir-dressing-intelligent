'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { loadImage, paintSilhouette, prepareSilhouette } from '@/lib/assembly/draw';
import { STAGE_HEIGHT, STAGE_WIDTH, type SilhouetteSource } from '@/lib/assembly/render';

// Vignette verticale d'une tenue assemblée sur le téléphone (« Demain ») : fond transparent, donc
// celui de l'écran. Dessinée à échelle réduite (avec les bras pliés : dessinée à l'échelle 1, puis
// réduite). Si une image manque, on montre `fallback` (l'aperçu pièce par pièce).

/** Pixels de l'écran par point CSS sur le téléphone : la toile est dessinée assez fine pour lui. */
const THUMB_PIXEL_RATIO = 3;

/** Échelle de la toile par rapport à la scène pour `height` points de haut, jamais au-delà de 1. */
export function thumbScale(height: number): number {
  return Math.min(1, (height * THUMB_PIXEL_RATIO) / STAGE_HEIGHT);
}

type Props = {
  source: SilhouetteSource;
  label: string;
  fallback: ReactNode;
  /** Hauteur affichée, en points CSS (largeur ≈ 0,58 × la hauteur). */
  height: number;
};

export function SilhouetteThumb({ source, label, fallback, height }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const scale = thumbScale(height);

  useEffect(() => {
    let cancelled = false;
    prepareSilhouette(source, loadImage)
      .then((prepared) => {
        const canvas = ref.current;
        if (cancelled || !canvas) return;
        paintSilhouette(canvas, prepared, scale);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [source, scale]);

  if (failed) return <>{fallback}</>;

  return (
    <div className="flex w-full justify-center" style={{ height }}>
      <canvas
        ref={ref}
        width={Math.round(STAGE_WIDTH * scale)}
        height={Math.round(STAGE_HEIGHT * scale)}
        role="img"
        aria-label={label}
        data-testid="silhouette-thumb"
        className="h-full w-auto max-w-full object-contain"
      />
    </div>
  );
}
