import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { paintSilhouette, prepareSilhouette, type DrawableImage } from '@/lib/assembly/draw';
import { silhouetteKey, type SilhouetteSource } from '@/lib/assembly/render';

// Silhouettes pré-rendues (docs/conception.md §7 bis) : chaque tenue affichable est dessinée une fois, hors écran,
// dès que ses images sont chargées. Défiler ne fait qu'afficher une toile déjà prête.
// Les toiles restent des HTMLCanvasElement : une toile « teintée » par une image d'une autre
// origine (URL signée de Storage) s'affiche, mais ne se convertit pas en ImageBitmap.

export type SilhouetteEntry =
  | { status: 'pending' }
  | { status: 'ready'; canvas: HTMLCanvasElement }
  | { status: 'failed' };

export type ImageLoader = (url: string) => Promise<DrawableImage>;

/**
 * Une silhouette dessinée en rendu de secours (une couche des bras pliés en échec, coupure
 * passagère) est redessinée après ce délai, tant qu'elle est gardée : un peu plus que le délai
 * après lequel le préchargement redemande une image en échec (30 s, components/mirror/preload.ts).
 */
export const RETRY_DEGRADED_MS = 31_000;

const entries = new Map<string, SilhouetteEntry>();
const running = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Charge les images de la silhouette et la dessine dans une nouvelle toile hors écran. */
async function draw(source: SilhouetteSource, load: ImageLoader): Promise<{ canvas: HTMLCanvasElement; degraded: boolean }> {
  const prepared = await prepareSilhouette(source, load);
  const canvas = document.createElement('canvas');
  paintSilhouette(canvas, prepared);
  return { canvas, degraded: prepared.mode === 'actuel' && prepared.degraded === true };
}

/**
 * Rendu de secours : il reste affiché, puis la silhouette est redessinée après RETRY_DEGRADED_MS.
 * Le rendu complet le remplace dès qu'il réussit ; sinon, nouvel essai plus tard. S'arrête dès que
 * l'entrée est oubliée (retainSilhouettes, nouvelle lecture) ou remplacée.
 */
function redrawLater(key: string, entry: SilhouetteEntry, source: SilhouetteSource, load: ImageLoader) {
  setTimeout(() => {
    if (entries.get(key) !== entry) return;
    draw(source, load).then(
      ({ canvas, degraded }) => {
        if (entries.get(key) !== entry) return;
        if (degraded) {
          redrawLater(key, entry, source, load);
          return;
        }
        entries.set(key, { status: 'ready', canvas });
        notify();
      },
      () => {
        if (entries.get(key) === entry) redrawLater(key, entry, source, load);
      },
    );
  }, RETRY_DEGRADED_MS);
}

/** Dessine cette silhouette si elle ne l'est pas déjà. Ne rejette jamais (échec → « failed »). */
export function prerenderSilhouette(source: SilhouetteSource, load: ImageLoader): Promise<void> {
  const key = silhouetteKey(source);
  if (entries.has(key)) return running.get(key) ?? Promise.resolve();

  const pending: SilhouetteEntry = { status: 'pending' };
  entries.set(key, pending);
  notify();
  const settle = (entry: SilhouetteEntry): boolean => {
    // Oubliée entre-temps (retainSilhouettes) : on ne la remet pas.
    if (entries.get(key) !== pending) return false;
    entries.set(key, entry);
    notify();
    return true;
  };
  const work = draw(source, load)
    .then(
      ({ canvas, degraded }) => {
        const ready: SilhouetteEntry = { status: 'ready', canvas };
        if (settle(ready) && degraded) redrawLater(key, ready, source, load);
      },
      () => void settle({ status: 'failed' }), // Image introuvable : la tenue s'affiche pièce par pièce.
    )
    .finally(() => running.delete(key));
  running.set(key, work);
  return work;
}

export function prerenderSilhouettes(sources: readonly SilhouetteSource[], load: ImageLoader): Promise<void> {
  return Promise.all(sources.map((source) => prerenderSilhouette(source, load))).then(() => undefined);
}

/** Oublie les silhouettes qui ne servent plus (les URL signées changent à chaque lecture). */
export function retainSilhouettes(keys: Iterable<string>) {
  const keep = new Set(keys);
  let changed = false;
  for (const key of [...entries.keys()]) {
    if (!keep.has(key)) {
      entries.delete(key);
      changed = true;
    }
  }
  if (changed) notify();
}

/** L'entrée de cette silhouette (undefined tant qu'elle n'est pas demandée). */
export function silhouetteEntry(key: string): SilhouetteEntry | undefined {
  return entries.get(key);
}

/**
 * La silhouette pré-rendue de cette source (undefined tant qu'elle n'est pas demandée).
 * Si elle manque (jeu recalculé avant la fin du préchargement), elle est dessinée à la volée.
 */
export function useSilhouette(source: SilhouetteSource | null, load: ImageLoader): SilhouetteEntry | undefined {
  const key = useMemo(() => (source ? silhouetteKey(source) : null), [source]);
  const entry = useSyncExternalStore(
    subscribe,
    () => (key ? silhouetteEntry(key) : undefined),
    () => undefined,
  );
  useEffect(() => {
    if (source && key && !entries.has(key)) void prerenderSilhouette(source, load);
  }, [source, key, load]);
  return entry;
}
