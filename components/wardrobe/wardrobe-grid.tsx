'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type SyntheticEvent,
} from 'react';
import { setDirty, setDirtyMany } from '@/app/gestion/garde-robe/actions';
import { pressFeedback } from '@/components/gestion/buttons';
import { ChevronDown } from '@/components/gestion/icons';
import { stuckEdgeClass, useStuckMarker } from '@/components/gestion/sticky-bar';
import {
  CATEGORY_PARAM,
  CATEGORY_TITLES,
  chosenCategory,
  markFailure,
  mirrorNote,
  piecesLabel,
  presentCategories,
  withDirty,
  withLatest,
  type GridItem,
} from '@/lib/items/grid';
import { IMAGE_RETRY_DELAY_MS, expiredImageRetry } from '@/lib/items/image-retry';
import type { ActionResult } from '@/lib/items/results';
import type { Category } from '@/lib/types';
import { forgetPlace, keepPlace, readPlace } from './grid-place';
import { CheckIcon } from './icons';
import { ItemImage } from './item-image';

// Grille de la garde-robe (docs/conception.md §4, écran 2), sur le téléphone. Une catégorie à la fois, choisie
// dans la bande collée sous la ligne retour (gardée dans l'adresse) ; à droite de la bande,
// « Marquer au sale » fait des vignettes des interrupteurs, et « OK » reste à portée en bas de liste.
// Un seul état optimiste pour toute la liste : le compte et les vignettes changent tout de suite.

const GRID_PATH = '/gestion/garde-robe';
const DIRTY_PATH = '/gestion/garde-robe/au-sale';
/** Vignettes chargées en priorité : celles qu'on voit à l'ouverture (2 rangées). */
const PRIORITY_COUNT = 4;
/** Hauteur de la ligne retour collée en haut (PhonePage, min-h-11). */
const BACK_BAR_PX = 44;
/** Marge intérieure de la bande collée (py-2), qui déborde au-dessus de la grille (-my-2). */
const BAND_PADDING_PX = 8;
const CONNECTION_ERROR = 'La connexion a été coupée. Réessaie.';

type DirtyChange = { ids: readonly string[]; dirty: boolean };

function applyChange(items: GridItem[], change: DirtyChange): GridItem[] {
  return withDirty(items, change.ids, change.dirty);
}

/** Catégorie écrite dans l'adresse, sans navigation : le retour et le rechargement la gardent. */
function writeCategory(category: Category) {
  const url = new URL(window.location.href);
  url.searchParams.set(CATEGORY_PARAM, category);
  window.history.replaceState(null, '', url);
}

type ImageErrorHandler = (event: SyntheticEvent<HTMLImageElement>) => void;

/**
 * Vignette en échec : la page est relue, avec des URL re-signées (lib/items/image-retry.ts). Les
 * vignettes d'une catégorie cachée ne se chargent qu'une fois choisie, parfois bien après
 * l'ouverture : leur URL a pu expirer entre-temps.
 */
function useImageRetry(): ImageErrorHandler {
  const router = useRouter();
  const [retry] = useState(() =>
    expiredImageRetry(
      () => router.refresh(),
      (run) => void window.setTimeout(run, IMAGE_RETRY_DELAY_MS),
    ),
  );
  return (event) => retry(event.currentTarget.src);
}

export function WardrobeGrid({ items }: { items: GridItem[] }) {
  const [shown, applyDirty] = useOptimistic(items, applyChange);
  const [, startTransition] = useTransition();
  const onImageError = useImageRetry();
  const [marking, setMarking] = useState(false);
  /** Échec du dernier toucher, montré dans la bande tant qu'on marque. */
  const [failed, setFailed] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const [wanted, setWanted] = useState<string | null>(() => searchParams.get(CATEGORY_PARAM));
  // Défilement à rétablir, appliqué après le rendu de la catégorie rétablie (restoreRequest).
  const restoreY = useRef<number | null>(null);
  const [restoreRequest, setRestoreRequest] = useState(0);
  // Haut de la bande et de la grille, qui ne bouge pas (la bande, collée, bouge) : repère de choose().
  const gridTop = useRef<HTMLDivElement>(null);
  // La bande collée sous la ligne retour (top-11) : son filet quand elle est collée, le seul de
  // l'écran (la ligne retour n'en a pas ici : PhonePage edge={false}).
  const bandRef = useStuckMarker<HTMLDivElement>(BACK_BAR_PX);

  const present = presentCategories(shown);
  // Une catégorie vidée (pièce supprimée, recatégorisée) laisse la place à la première présente.
  const category = chosenCategory(wanted, present);
  const visible = shown.filter((item) => item.category === category);
  const dirtyCount = shown.filter((item) => item.dirty).length;
  const note = category ? mirrorNote(category) : null;

  // Retour depuis une fiche : même catégorie, puis même défilement, une image après le montage
  // (vignettes carrées et légendes de hauteur fixe : la grille a déjà sa hauteur, sans les photos).
  // La place n'est effacée qu'une fois appliquée.
  useEffect(() => {
    const place = readPlace();
    if (!place) return;
    const frame = requestAnimationFrame(() => {
      forgetPlace();
      if (place.category) {
        setWanted(place.category);
        writeCategory(place.category);
      }
      restoreY.current = place.y;
      setRestoreRequest((count) => count + 1);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useLayoutEffect(() => {
    if (restoreY.current === null) return;
    window.scrollTo(0, restoreY.current);
    restoreY.current = null;
  }, [restoreRequest]);

  function choose(next: Category) {
    // Un toucher dans la bande : l'échec d'avant (autre catégorie) s'efface.
    setFailed(null);
    setWanted(next);
    writeCategory(next);
    // Déjà plus bas que le haut de la grille : on y revient, la bande (et « OK ») juste sous la
    // ligne retour. Une image plus tard : après une server action (une pièce marquée), le routeur
    // de Next remonte sinon tout en haut de la page au rendu de la nouvelle catégorie.
    const top = gridTop.current
      ? gridTop.current.getBoundingClientRect().top + window.scrollY - BAND_PADDING_PX - BACK_BAR_PX
      : 0;
    if (window.scrollY <= top) return;
    window.scrollTo(0, top);
    requestAnimationFrame(() => {
      if (window.scrollY !== top) window.scrollTo(0, top);
    });
  }

  function toggleMarking() {
    setMarking((value) => !value);
    setFailed(null);
  }

  function toggle(item: GridItem) {
    const next = !item.dirty;
    setFailed(null);
    startTransition(async () => {
      // En cas d'échec, la vignette reprend seule son état : l'état optimiste revient à `items`.
      applyDirty({ ids: [item.id], dirty: next });
      const failure = await failureOf(setDirty(item.id, next));
      if (failure) setFailed(markFailure(failure));
    });
  }

  const options = present.map((value) => ({ value, label: CATEGORY_TITLES[value] }));

  return (
    <>
      <p className="text-footnote text-muted">
        {piecesLabel(shown.length)}
        {dirtyCount > 0 ? (
          <>
            {' · '}
            {/* before: zone à toucher de 44 px de haut, centrée sur le texte, sans grossir la ligne
                (une hauteur fixe : celle du texte dépend de la police). */}
            <Link
              href={DIRTY_PATH}
              onClick={() => keepPlace(category, DIRTY_PATH)}
              className={`relative text-accent before:absolute before:-inset-x-1 before:top-1/2 before:h-11 before:-translate-y-1/2 ${pressFeedback}`}
            >
              {dirtyCount} au sale
            </Link>
          </>
        ) : null}
      </p>

      {category ? (
        <div ref={gridTop} className="flex flex-col gap-6">
          {/* Collée juste sous la ligne retour, opaque comme elle ; -my-2 garde l'espace de la page.
              À gauche le titre de la grille (le menu, ou le nom de l'unique catégorie) ; à droite ce
              qui change le mode de l'écran, à portée même en bas de liste. Une fois collée, les
              photos passent dessous : son filet, le seul de l'écran. */}
          <div
            ref={bandRef}
            className={`sticky top-11 z-10 -mx-4 -my-2 flex items-center justify-between gap-3 bg-canvas px-4 py-2 ${stuckEdgeClass}`}
          >
            {present.length > 1 ? (
              <CategoryMenu options={options} value={category} onChange={choose} />
            ) : (
              <h2 id="grille-titre" className="flex min-h-11 items-center text-body font-semibold">
                {CATEGORY_TITLES[category]}
              </h2>
            )}
            <div className="flex min-w-0 items-center gap-3">
              {/* Seulement en marquage, à côté de « OK » : à côté de « Marquer au sale », la bande
                  n'en a pas la place. */}
              {failed && marking ? (
                <p role="alert" className="text-footnote text-ink">
                  {failed}
                </p>
              ) : null}
              <button
                type="button"
                onClick={toggleMarking}
                className={`flex min-h-11 shrink-0 items-center text-body text-accent ${pressFeedback} ${marking ? 'font-semibold' : ''}`}
              >
                {marking ? 'OK' : 'Marquer au sale'}
              </button>
            </div>
          </div>

          <section aria-labelledby="grille-titre" className="flex flex-col gap-3">
            {/* Plusieurs catégories : le menu sert de titre visible. */}
            {present.length > 1 ? (
              <h2 id="grille-titre" className="sr-only">
                {CATEGORY_TITLES[category]}
              </h2>
            ) : null}
            {note ? <p className="text-footnote text-muted">{note}</p> : null}
            <ul className="grid grid-cols-2 gap-x-3 gap-y-6">
              {visible.map((item, index) => (
                <li key={item.id} className="flex min-w-0 flex-col">
                  <Tile
                    item={item}
                    priority={index < PRIORITY_COUNT}
                    marking={marking}
                    onToggle={() => toggle(item)}
                    onOpen={() => keepPlace(category, `${GRID_PATH}/${item.id}`)}
                    onImageError={onImageError}
                  />
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </>
  );
}

/** Message d'échec d'une action, ou null si elle a réussi ; une connexion coupée est un échec. */
async function failureOf(action: Promise<ActionResult<object>>): Promise<string | null> {
  try {
    const result = await action;
    return result.ok ? null : result.error;
  } catch {
    return CONNECTION_ERROR;
  }
}

/**
 * Titre de la grille : le nom de la catégorie montrée, de la couleur du texte, ouvre la liste
 * native des catégories.
 */
function CategoryMenu({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: Category; label: string }>;
  value: Category;
  onChange: (value: Category) => void;
}) {
  return (
    <label className="relative flex min-h-11 w-fit shrink-0 items-center gap-1 rounded-lg text-body font-semibold text-ink has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-accent">
      {CATEGORY_TITLES[value]}
      <ChevronDown className="size-4 text-muted" />
      <select
        aria-label="Catégorie"
        value={value}
        onChange={(event) => {
          const next = options.find((option) => option.value === event.target.value);
          if (next) onChange(next.value);
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Vue « au sale » : les pièces au sale à l'arrivée sur la page, par catégorie. Toucher une pièce la
 * remet propre, la retoucher la remet au sale ; « Tout est lavé », en bas, les remet toutes
 * propres. Tout se voit sur place, sans retour automatique. Pendant la visite, les pièces lavées
 * restent : setDirty et setDirtyMany relisent la page (revalidatePath), qui n'apporte plus que les
 * pièces encore au sale, et la vignette disparaîtrait sous le doigt (withLatest).
 */
export function DirtyGrid({ items }: { items: GridItem[] }) {
  const [opened, setOpened] = useState(() => items);
  const [washing, startWash] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const onImageError = useImageRetry();

  // Chaque visite repart de la dernière lecture. Avec cacheComponents, Next garde la page quittée
  // dans une <Activity> cachée, avec son état : sans cela, rouvrir « 3 au sale » montrerait la
  // liste (et l'erreur) de la visite d'avant. Les effets d'une Activity sont rejoués quand elle
  // redevient visible ; celui-ci, avant l'affichage, remplace la liste d'avant sans qu'elle se voie.
  const startVisit = useEffectEvent(() => {
    setOpened(items);
    setError(null);
  });
  // eslint-disable-next-line react-hooks/set-state-in-effect -- ce second rendu est voulu (ci-dessus)
  useLayoutEffect(() => startVisit(), []);

  const shown = withLatest(opened, items);
  const dirtyIds = shown.filter((item) => item.dirty).map((item) => item.id);
  const sections = presentCategories(shown).map((category) => ({
    category,
    note: mirrorNote(category),
    items: shown.filter((item) => item.category === category),
  }));
  const first = new Set(
    sections
      .flatMap((section) => section.items)
      .slice(0, PRIORITY_COUNT)
      .map((item) => item.id),
  );

  // L'état change dès le toucher, hors transition (une transition ne l'afficherait qu'à la fin de
  // l'action), et revient en arrière si l'action échoue.
  async function toggle(item: GridItem) {
    const next = !item.dirty;
    setError(null);
    // withLatest d'abord : une pièce arrivée par la relecture n'est pas encore dans `opened`.
    setOpened((list) => withDirty(withLatest(list, items), [item.id], next));
    const failure = await failureOf(setDirty(item.id, next));
    if (failure) {
      setOpened((list) => withDirty(withLatest(list, items), [item.id], !next));
      setError(failure);
    }
  }

  function washAll() {
    const ids = dirtyIds;
    if (ids.length === 0) return;
    setError(null);
    setOpened((list) => withDirty(withLatest(list, items), ids, false));
    startWash(async () => {
      const failure = await failureOf(setDirtyMany(ids, false));
      if (failure) {
        setOpened((list) => withDirty(withLatest(list, items), ids, true));
        setError(failure);
      }
    });
  }

  // Seulement si la visite commence sans pièce au sale : ensuite, les pièces lavées restent là.
  if (shown.length === 0) {
    return <p className="text-body text-muted">Rien au sale.</p>;
  }

  return (
    <>
      {sections.map((section) => (
        <section key={section.category} aria-labelledby={`sale-${section.category}`} className="flex flex-col gap-3">
          <div className="flex flex-col">
            <h2 id={`sale-${section.category}`} className="text-body font-semibold">
              {CATEGORY_TITLES[section.category]}
            </h2>
            {section.note ? <p className="text-footnote text-muted">{section.note}</p> : null}
          </div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-6">
            {section.items.map((item) => (
              <li key={item.id} className="flex min-w-0 flex-col">
                <Tile
                  item={item}
                  priority={first.has(item.id)}
                  marking
                  dimDirty={false}
                  onToggle={() => void toggle(item)}
                  onImageError={onImageError}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={washAll}
          disabled={washing || dirtyIds.length === 0}
          aria-busy={washing}
          className="rounded-xl bg-accent px-4 py-3 text-body font-semibold text-on-accent disabled:opacity-60"
        >
          Tout est lavé
        </button>
        {error ? (
          <p role="alert" className="text-footnote text-ink">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}

type TileProps = {
  item: GridItem;
  priority: boolean;
  /** Interrupteur au sale oui ou non (mode marquage, vue « au sale ») ; sinon un lien vers la fiche. */
  marking: boolean;
  /** Pièce au sale pâlie (grille) ; pas dans la vue « au sale », où elles le sont presque toutes. */
  dimDirty?: boolean;
  onToggle?: () => void;
  onOpen?: () => void;
  onImageError?: ImageErrorHandler;
};

/** Coche et atténuation du marquage : un fondu de 150 ms, sans changement d'échelle ni rebond. */
const MARK_FADE = 'transition-opacity duration-150 ease-standard';

/**
 * Une vignette : la photo, puis une légende de hauteur fixe (deux lignes), pour que les rangées
 * restent alignées. En interrupteur, toucher la vignette la met au sale ou la remet propre ; en
 * lien, elle pâlit sous le doigt le temps que la fiche s'ouvre (pressFeedback).
 */
function Tile({ item, priority, marking, dimDirty = true, onToggle, onOpen, onImageError }: TileProps) {
  const dim = dimDirty && item.dirty;
  const image = (
    <ItemImage
      src={item.src}
      alt="" // le nom suit, dans le même lien ou le même bouton
      fit={item.fit}
      zone={item.zone}
      priority={priority}
      onError={onImageError}
      className={`${MARK_FADE} ${dim ? 'opacity-40' : ''}`}
    />
  );
  const caption = (
    <span className={`flex min-h-10 flex-col text-footnote transition-colors duration-150 ease-standard ${dim ? 'text-muted' : 'text-ink'}`}>
      <span className={item.redoPhoto ? 'line-clamp-1' : 'line-clamp-2'}>{item.name}</span>
      {item.redoPhoto ? <span className="text-muted">Photo à refaire</span> : null}
    </span>
  );

  if (marking) {
    return (
      <button
        type="button"
        aria-pressed={item.dirty}
        onClick={onToggle}
        className="flex flex-col gap-2 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="relative block w-full">
          {image}
          {/* Propre : un anneau vide ; au sale : le rond plein coché apparaît dessus, en fondu. */}
          <span aria-hidden="true" className="absolute right-2 bottom-2 size-6">
            <span className="absolute inset-0 rounded-full border-[1.5px] border-muted bg-surface" />
            <span
              className={`absolute inset-0 flex items-center justify-center rounded-full bg-accent text-on-accent ${MARK_FADE} ${
                item.dirty ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <CheckIcon />
            </span>
          </span>
        </span>
        {caption}
      </button>
    );
  }

  return (
    <Link href={`${GRID_PATH}/${item.id}`} onClick={onOpen} className={`flex flex-col gap-2 ${pressFeedback}`}>
      {image}
      {caption}
    </Link>
  );
}
