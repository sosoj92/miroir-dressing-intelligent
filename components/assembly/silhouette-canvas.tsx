'use client';

import { useLayoutEffect, useRef, type CSSProperties } from 'react';

// Affiche une silhouette déjà dessinée hors écran : une seule copie de toile à toile, avant que
// le navigateur peigne l'écran. La toile garde la taille de la scène ; le CSS la met à l'échelle
// (object-fit: contain), et ce qui l'entoure reste transparent.

type Props = {
  rendered: HTMLCanvasElement;
  label: string;
  className?: string;
  style?: CSSProperties;
  testId?: string;
};

export function SilhouetteCanvas({ rendered, label, className, style, testId }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(rendered, 0, 0);
  }, [rendered]);

  return (
    <canvas
      ref={ref}
      width={rendered.width}
      height={rendered.height}
      role="img"
      aria-label={label}
      data-testid={testId}
      className={className}
      style={style}
    />
  );
}
