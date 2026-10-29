'use client';

import { useEffect, useMemo, useState } from 'react';
import { SilhouetteCanvas } from '@/components/assembly/silhouette-canvas';
import { useSilhouette } from '@/components/assembly/silhouette-store';
import { ZoneCutout } from '@/components/assembly/zone-cutout';
import { photoZone } from '@/lib/items/zone';
import { brightnessFilter, silhouetteFilter } from '@/lib/mirror/brightness';
import { outfitLayout, outfitSilhouette } from '@/lib/mirror/deck';
import { SILHOUETTE_DIM_AFTER_MS, SILHOUETTE_DIM_OPACITY } from '@/lib/mirror/timing';
import { outfitCaption } from '@/lib/outfits';
import type { MirrorItem, Outfit } from '@/lib/types';
import { displayOf } from './display';
import { decodedImage } from './preload';

// Une tenue sur le miroir (docs/conception.md §4, §7, §12) : la silhouette assemblée à partir des photos portées,
// déjà dessinée hors écran, sur fond noir. Si une pièce n'a pas de photo portée (ou si une image
// manque), les pièces détourées empilées de haut en bas, ou leur nom. Jamais une photo avec son fond.
// Une silhouette pas encore dessinée (défilement rapide, point de départ après « On recommence »,
// photos retéléchargées après le réveil) ne laisse jamais de trou noir : l'ancienne reste, pâlit si
// l'attente dure, puis la nouvelle la remplace.

type Props = {
  outfit: Outfit;
  itemsById: ReadonlyMap<string, MirrorItem>;
  /** Ligne d'état sous la légende : « Choisie », « Prévue », « Écartée » ou rien (docs/conception.md §4). */
  mark: string | null;
  /** Pourquoi la dernière touche n'a rien changé, 1,5 s : passe avant `mark`. */
  hint: string | null;
  /** La dernière touche n'a changé que la pièce cachée : « Sous la veste : … » en blanc, 1 s. */
  noteLit: boolean;
  /** « Bonne journée » ou « Prête pour demain » : à la place de la légende, dans sa hauteur. */
  message: string | null;
};

/** Ce qui était à l'écran en dernier : une silhouette dessinée, ou des pièces empilées. */
type LastShown = { kind: 'canvas'; canvas: HTMLCanvasElement } | { kind: 'pieces'; outfit: Outfit };

/**
 * La dernière vue affichée, gardée hors du composant : « On recommence », « Touches enregistrées »,
 * la veille ou le test des touches démontent la tenue. À son retour, si sa silhouette n'est pas
 * encore dessinée, c'est cette vue qui reste à l'écran, jamais un trou noir.
 */
let lastShownMemory: LastShown | null = null;

/**
 * Vrai quand `kept` (l'ancienne vue, gardée pendant l'attente) est à l'écran depuis
 * SILHOUETTE_DIM_AFTER_MS. Indexé sur l'ancienne vue, pas sur la tenue attendue : des appuis
 * rapprochés pendant l'attente ne la rallument pas.
 */
function useDimmed(kept: HTMLCanvasElement | string | null): boolean {
  const [dimmedFor, setDimmedFor] = useState<HTMLCanvasElement | string | null>(null);
  // Fin de l'attente : la prochaine repartira de 300 ms.
  if (kept === null && dimmedFor !== null) setDimmedFor(null);
  useEffect(() => {
    if (kept === null) return;
    const timer = window.setTimeout(() => setDimmedFor(kept), SILHOUETTE_DIM_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [kept]);
  return kept !== null && dimmedFor === kept;
}

export function OutfitView({ outfit, itemsById, mark, hint, noteLit, message }: Props) {
  const source = useMemo(() => outfitSilhouette(outfit, itemsById), [outfit, itemsById]);
  const entry = useSilhouette(source, decodedImage);
  const display = displayOf(source, entry);
  const ready = entry?.status === 'ready' ? entry.canvas : null;
  // La dernière vue affichée (silhouette dessinée ou pièces empilées), gardée à l'écran tant que la
  // nouvelle silhouette n'est pas prête. Les pièces sont repérées par la clé de leur tenue : l'objet
  // tenue change à chaque rendu. Au montage, celle d'avant le démontage (lastShownMemory).
  const [last, setLast] = useState<LastShown | null>(() => lastShownMemory);
  if (ready && !(last?.kind === 'canvas' && last.canvas === ready)) setLast({ kind: 'canvas', canvas: ready });
  if (display === 'pieces' && !(last?.kind === 'pieces' && last.outfit.key === outfit.key)) {
    setLast({ kind: 'pieces', outfit });
  }
  useEffect(() => {
    if (last) lastShownMemory = last;
  }, [last]);
  const kept = display === 'pending' ? last : null;
  const canvas = ready ?? (kept?.kind === 'canvas' ? kept.canvas : null);
  const keptPieces = kept?.kind === 'pieces' ? kept.outfit : null;
  const dimmed = useDimmed(kept?.kind === 'canvas' ? kept.canvas : keptPieces ? `pieces:${keptPieces.key}` : null);
  const caption = useMemo(
    () =>
      outfitCaption(
        outfit.item_ids.map((id) => itemsById.get(id)).filter((item): item is MirrorItem => item !== undefined),
        display === 'pieces',
      ),
    [outfit, itemsById, display],
  );
  // Hauteur fixe de la légende, le plus grand des cas de ce qui est à l'écran : sous une silhouette,
  // deux lignes, la note et l'état (176 px) ; sous des pièces empilées (aussi gardées pendant
  // l'attente d'une silhouette), trois lignes et l'état (184 px).
  const legendHeight = display === 'pieces' || keptPieces ? 'h-[184px]' : 'h-[176px]';

  return (
    <section
      data-testid="mirror-outfit"
      data-outfit-key={outfit.key}
      data-item-ids={outfit.item_ids.join(',')}
      data-title={outfit.title}
      data-display={display}
      className="flex min-h-0 w-full flex-1 flex-col items-center"
    >
      {display === 'pieces' ? (
        <StackedPieces outfit={outfit} itemsById={itemsById} />
      ) : keptPieces ? (
        // Après des pièces empilées, elles restent à leur place tant que la silhouette n'est pas
        // prête, et pâlissent de même.
        <StackedPieces outfit={keptPieces} itemsById={itemsById} dimmed={dimmed} />
      ) : (
        // La silhouette occupe toute la hauteur libre entre l'en-tête et le titre, centrée. Tant
        // que la nouvelle n'est pas prête, la précédente reste à la même place (même toile), sans
        // fondu ; au-delà de 300 ms, elle pâlit sans transition jusqu'à l'arrivée de la nouvelle.
        <div className="flex min-h-0 w-full flex-1 py-4">
          <div className="relative min-h-0 flex-1">
            {canvas && (
              <SilhouetteCanvas
                rendered={canvas}
                label={outfit.title}
                testId="mirror-silhouette"
                className="absolute inset-0 h-full w-full object-contain"
                style={{ filter: silhouetteFilter(), opacity: dimmed ? SILHOUETTE_DIM_OPACITY : undefined }}
              />
            )}
          </div>
        </div>
      )}

      {/* Un seul bloc de hauteur fixe (legendHeight) : la silhouette garde la même taille d'une
          tenue à l'autre, les yeux restent au même point. */}
      {message ? (
        // « Bonne journée » : la tenue reste, le message prend la place de sa légende.
        <div className={`flex ${legendHeight} w-full shrink-0 items-center justify-center text-center`}>
          <p data-testid="mirror-message" role="status" className="text-mirror-xl text-mirror-ink">
            {message}
          </p>
        </div>
      ) : (
        <div
          data-testid="mirror-title"
          className={`flex ${legendHeight} w-full shrink-0 flex-col items-center text-center`}
        >
          {caption.lines.slice(0, display === 'pieces' ? 3 : 2).map((line) => (
            <p key={line} className="w-full truncate text-mirror-md text-mirror-ink">
              {line}
            </p>
          ))}
          {caption.note && (
            <p
              data-testid="mirror-note"
              data-lit={noteLit || undefined}
              className={`w-full truncate text-mirror-sm ${noteLit ? 'text-mirror-ink' : 'text-mirror-dim'}`}
            >
              {caption.note}
            </p>
          )}
          {/* Juste après la dernière ligne : pourquoi une touche n'a rien changé (1,5 s), sinon
              « Choisie », « Prévue » ou « Écartée ». Pas de compteur en composition libre. */}
          <p
            data-testid="mirror-position"
            className={`min-h-10 w-full truncate text-mirror-sm text-mirror-ink ${hint ? 'font-normal' : 'font-medium'}`}
          >
            {hint ?? mark ?? ''}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Affichage de secours : les pièces détourées empilées (veste et haut, bas, chaussures, accessoires).
 * `dimmed` : gardées à l'écran pendant qu'une silhouette se prépare, depuis plus de 300 ms.
 */
function StackedPieces({
  outfit,
  itemsById,
  dimmed = false,
}: {
  outfit: Outfit;
  itemsById: ReadonlyMap<string, MirrorItem>;
  dimmed?: boolean;
}) {
  const layout = outfitLayout(outfit, itemsById);
  const hasFeetRow = layout.feet.length > 0 || layout.extras.length > 0;

  return (
    <div
      data-testid="mirror-pieces"
      data-pieces-key={outfit.key}
      className="flex min-h-0 w-full flex-1 flex-col gap-6 py-8"
      style={dimmed ? { opacity: SILHOUETTE_DIM_OPACITY } : undefined}
    >
      {layout.upper.length > 0 && (
        <div className="flex min-h-0 flex-[5] gap-6">
          {layout.upper.map((item) => (
            <Piece key={`${item.id}:${item.cutout_url ?? ''}`} item={item} />
          ))}
        </div>
      )}
      {layout.lower.length > 0 && (
        <div className="flex min-h-0 flex-[4] gap-6">
          {layout.lower.map((item) => (
            <Piece key={`${item.id}:${item.cutout_url ?? ''}`} item={item} />
          ))}
        </div>
      )}
      {hasFeetRow && (
        <div className="flex min-h-0 flex-[2] justify-center gap-10">
          {layout.feet.map((item) => (
            <Piece key={`${item.id}:${item.cutout_url ?? ''}`} item={item} />
          ))}
          {layout.extras.map((item) => (
            <Piece key={`${item.id}:${item.cutout_url ?? ''}`} item={item} small />
          ))}
        </div>
      )}
    </div>
  );
}

function Piece({ item, small = false }: { item: MirrorItem; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const size = small ? 'max-w-[22%] flex-[0.6]' : 'flex-1';

  if (!item.cutout_url || failed) {
    return (
      <div data-item-id={item.id} className={`flex min-h-0 min-w-0 items-center justify-center ${size}`}>
        <p className="text-center text-mirror-sm text-mirror-ink">{item.name}</p>
      </div>
    );
  }

  // Pièce photographiée portée, dans une tenue qui ne s'assemble pas : seulement la zone qui la
  // montre (comme sa vignette sur le téléphone), pas la personne entière.
  const zone = photoZone(item);
  if (zone) {
    return (
      <div data-item-id={item.id} className={`relative min-h-0 min-w-0 ${size}`}>
        <ZoneCutout
          src={item.cutout_url}
          label={item.name}
          zone={zone}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full"
          style={{ filter: brightnessFilter(item.color) ?? undefined }}
        />
      </div>
    );
  }

  return (
    <div data-item-id={item.id} className={`relative min-h-0 min-w-0 ${size}`}>
      {/* Détourage PNG transparent, par URL signée : pas d'optimisation next/image, l'image est déjà préchargée. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.cutout_url}
        alt={item.name}
        draggable={false}
        decoding="sync"
        onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full object-contain"
        style={{ filter: brightnessFilter(item.color) ?? undefined }}
      />
    </div>
  );
}
