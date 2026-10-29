import type { ReactNode } from 'react';
import { SilhouetteThumb } from '@/components/assembly/silhouette-thumb';
import { ZoneCutout } from '@/components/assembly/zone-cutout';
import type { PreviewOutfit, PreviewPiece } from './view';

// Une tenue sur le téléphone : la silhouette assemblée à partir des photos portées, sinon les
// détourés (URL signées) l'un sous l'autre, à la même hauteur, posés sur une plaque gris très foncé
// (bg-photo), la même en clair et en sombre : les bords du détourage s'y fondent. Sans détourage,
// la pièce s'affiche par son nom : jamais d'icône de vêtement à la place. Dessous, sur le fond de
// la page, la légende du miroir (outfitCaption) en entier : les pièces vues en couleur du texte,
// la pièce cachée en gris.
// - `large` : la tenue en tête de page, plaque pleine largeur, silhouette de 400 px de haut ;
// - `small` : une case de la grille des autres tenues, silhouette de 240 px.

const HEIGHTS = { large: 400, small: 240 } as const;

type Props = { outfit: PreviewOutfit; size: keyof typeof HEIGHTS; action?: ReactNode };

export function OutfitPreview({ outfit, size, action }: Props) {
  const height = HEIGHTS[size];
  const pieces = <StackedPieces pieces={outfit.pieces} height={height} />;
  const picture = outfit.silhouette ? (
    <SilhouetteThumb source={outfit.silhouette} label={outfit.title} fallback={pieces} height={height} />
  ) : (
    pieces
  );
  const { lines, note } = outfit.caption;

  if (size === 'large') {
    return (
      <article className="flex flex-col items-center gap-2">
        <div className="w-full rounded-xl bg-photo px-4 py-4">{picture}</div>
        {/* Centrée, comme sous la silhouette du miroir. */}
        <div className="text-center">
          {lines.map((line, index) => (
            <p key={`${index}:${line}`} className="text-body text-ink">
              {line}
            </p>
          ))}
          {note && <p className="text-footnote text-muted">{note}</p>}
        </div>
        {action}
      </article>
    );
  }

  return (
    // Les cases d'une rangée ont la même hauteur (grille, h-full) : « Garder », poussé en bas,
    // reste aligné d'une case à l'autre.
    <article className="flex h-full flex-col gap-2">
      <div className="rounded-xl bg-photo p-2">{picture}</div>
      {/* Chaque nom en entier sur deux lignes au plus, à gauche sous la vignette. */}
      <div className="text-left text-footnote">
        {lines.map((line, index) => (
          <p key={`${index}:${line}`} className="line-clamp-2 text-balance text-ink">
            {line}
          </p>
        ))}
        {note && <p className="line-clamp-2 text-balance text-muted">{note}</p>}
      </div>
      {action && <div className="mt-auto">{action}</div>}
    </article>
  );
}

const UPPER = new Set(['veste', 'haut', 'robe']);

/** Les pièces l'une sous l'autre, comme sur le miroir : veste et haut (ou robe), puis le bas. */
function StackedPieces({ pieces, height }: { pieces: PreviewPiece[]; height: number }) {
  const rows = [pieces.filter((piece) => UPPER.has(piece.category)), pieces.filter((piece) => !UPPER.has(piece.category))];

  return (
    <div className="flex w-full flex-col gap-2" style={{ height }}>
      {rows
        .filter((row) => row.length > 0)
        .map((row) => (
          <div key={row[0].id} className="flex min-h-0 flex-1 gap-2">
            {row.map((piece) => (
              <Piece key={piece.id} piece={piece} />
            ))}
          </div>
        ))}
    </div>
  );
}

function Piece({ piece }: { piece: PreviewPiece }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
      {piece.cutoutUrl && piece.zone ? (
        // Pièce photographiée portée : la zone qui la montre, pas la personne entière.
        <ZoneCutout src={piece.cutoutUrl} label={piece.name} zone={piece.zone} className="h-full w-full" />
      ) : piece.cutoutUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL signée Supabase de 1 h, sans optimisation Next
        <img src={piece.cutoutUrl} alt={piece.name} className="h-full w-full object-contain" />
      ) : (
        <span className="text-center text-footnote text-photo-muted">{piece.name}</span>
      )}
    </div>
  );
}
