import type { SyntheticEvent } from 'react';
import { zoneLayout, type Zone } from '@/lib/items/zone';

type ItemImageProps = {
  src: string | null;
  alt: string;
  /** `contain` pour un détourage (vêtement entier), `cover` pour une photo avec son fond. */
  fit: 'contain' | 'cover';
  /**
   * Pièce assemblée : seule cette zone de la photo portée détourée est montrée (lib/items/zone.ts).
   * `size` est la taille de la photo, en px.
   */
  zone?: { zone: Zone; size: readonly [number, number] } | null;
  /**
   * Image visible dès l'ouverture (4 premières vignettes, photo de la fiche) : chargée tout de
   * suite, en priorité. Les autres attendent d'approcher de l'écran (loading="lazy").
   */
  priority?: boolean;
  /** Image en échec (URL signée expirée avant son chargement différé) : la grille relit la page. */
  onError?: (event: SyntheticEvent<HTMLImageElement>) => void;
  className?: string;
  /**
   * Fond du carré : `surface` (grille, comme les encarts), ou `photo`, la plaque gris très foncé
   * de la fiche, la même en clair et en sombre (les bords du détourage s'y fondent).
   */
  plate?: keyof typeof PLATES;
};

const PLATES = {
  surface: { background: 'bg-surface', text: 'text-muted' },
  photo: { background: 'bg-photo', text: 'text-photo-muted' },
} as const;

/**
 * Image carrée d'un vêtement. Les URL sont signées par Supabase (durée limitée) : `<img>` simple,
 * sans optimisation de Next.js (domaine non déclaré, et une URL renouvelée toutes les 30 min au
 * plus, lib/server/display-urls.ts).
 */
export function ItemImage({
  src,
  alt,
  fit,
  zone,
  priority = false,
  onError,
  className = '',
  plate = 'surface',
}: ItemImageProps) {
  const colors = PLATES[plate];

  if (src && zone) {
    // Cadre au rapport de la zone, centré ; la photo entière y est placée et mise à l'échelle en
    // pourcentages : seule la zone reste visible, sans canvas.
    const layout = zoneLayout(zone.zone, zone.size);
    return (
      <div className={`flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl ${colors.background}`}>
        <div className="relative overflow-hidden" style={layout.frame}>
          {/* eslint-disable-next-line @next/next/no-img-element -- URL signée Supabase, voir ci-dessus */}
          <img
            src={src}
            alt={alt}
            decoding="async"
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : undefined}
            onError={onError}
            className={`absolute max-w-none ${className}`}
            style={layout.image}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`aspect-square w-full overflow-hidden rounded-xl ${colors.background}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL signée Supabase, voir ci-dessus
        <img
          src={src}
          alt={alt}
          decoding="async"
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          onError={onError}
          className={`h-full w-full ${fit === 'contain' ? 'object-contain p-3' : 'object-cover'} ${className}`}
        />
      ) : (
        <div className={`flex h-full w-full items-center justify-center px-3 text-center text-footnote ${colors.text}`}>
          Pas de photo
        </div>
      )}
    </div>
  );
}
