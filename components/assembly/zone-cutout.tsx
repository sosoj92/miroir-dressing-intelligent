import type { CSSProperties } from 'react';
import type { PhotoZone } from '@/lib/items/zone';

// Zone d'une photo portée détourée (lib/items/zone.ts) : la pièce seule, sans le reste de la
// personne. Le SVG intérieur a exactement la taille de la zone et coupe ce qui dépasse ; l'extérieur
// le met à l'échelle de son cadre (contain). Fond transparent, sans canvas.

type Props = {
  src: string;
  label: string;
  zone: PhotoZone;
  className?: string;
  style?: CSSProperties;
  onError?: () => void;
};

export function ZoneCutout({ src, label, zone: { zone, size }, className, style, onError }: Props) {
  const viewBox = `${zone.x} ${zone.y} ${zone.width} ${zone.height}`;
  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label} className={className} style={style}>
      <svg x={zone.x} y={zone.y} width={zone.width} height={zone.height} viewBox={viewBox} overflow="hidden">
        <image href={src} x={0} y={0} width={size[0]} height={size[1]} onError={onError} />
      </svg>
    </svg>
  );
}
