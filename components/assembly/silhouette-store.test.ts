import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Le store des silhouettes pré-rendues, sans canvas : prepareSilhouette et paintSilhouette sont
// simulés (le dessin lui-même est testé dans lib/assembly/draw.test.ts).
const { prepared } = vi.hoisted(() => ({ prepared: vi.fn() }));
vi.mock('@/lib/assembly/draw', () => ({
  prepareSilhouette: prepared,
  paintSilhouette: () => {},
}));

import { silhouetteKey, type SilhouetteSource } from '@/lib/assembly/render';
import { RETRY_FAILED_MS } from '@/components/mirror/preload';
import { RETRY_DEGRADED_MS, prerenderSilhouette, retainSilhouettes, silhouetteEntry } from './silhouette-store';

const realDocument = (globalThis as { document?: unknown }).document;
let canvases = 0;

beforeEach(() => {
  vi.useFakeTimers();
  prepared.mockReset();
  canvases = 0;
  (globalThis as { document?: unknown }).document = { createElement: () => ({ id: ++canvases }) };
});

afterEach(() => {
  retainSilhouettes([]);
  vi.useRealTimers();
  (globalThis as { document?: unknown }).document = realDocument;
});

function source(name: string): SilhouetteSource {
  return { kind: 'single', piece: { photo: { key: name } as never, url: `cutout/${name}` } };
}

const plies = { mode: 'plies' };
const degraded = { mode: 'actuel', degraded: true };
const current = { mode: 'actuel' };
const load = async () => ({}) as never;

function canvasOf(key: string): unknown {
  const entry = silhouetteEntry(key);
  return entry?.status === 'ready' ? entry.canvas : entry?.status;
}

describe('silhouette-store : rendu de secours', () => {
  it('redessine après que le préchargement a pu redemander l’image en échec', () => {
    expect(RETRY_DEGRADED_MS).toBeGreaterThan(RETRY_FAILED_MS);
  });

  it('une couche en échec passager : le rendu actuel s’affiche, puis les bras pliés le remplacent', async () => {
    const shown = source('passager');
    const key = silhouetteKey(shown);
    prepared.mockResolvedValueOnce(degraded).mockResolvedValueOnce(plies);
    await prerenderSilhouette(shown, load);
    expect(canvasOf(key)).toEqual({ id: 1 });

    await vi.advanceTimersByTimeAsync(RETRY_DEGRADED_MS - 1);
    expect(prepared).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(prepared).toHaveBeenCalledTimes(2);
    expect(canvasOf(key)).toEqual({ id: 2 });

    // Rendu complet : plus de nouvel essai.
    await vi.advanceTimersByTimeAsync(5 * RETRY_DEGRADED_MS);
    expect(prepared).toHaveBeenCalledTimes(2);
  });

  it('toujours en échec : le rendu de secours reste affiché et un essai suit, plus tard', async () => {
    const shown = source('durable');
    const key = silhouetteKey(shown);
    prepared.mockResolvedValueOnce(degraded).mockResolvedValueOnce(degraded).mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce(plies);
    await prerenderSilhouette(shown, load);
    await vi.advanceTimersByTimeAsync(RETRY_DEGRADED_MS);
    await vi.advanceTimersByTimeAsync(RETRY_DEGRADED_MS);
    expect(canvasOf(key)).toEqual({ id: 1 });
    await vi.advanceTimersByTimeAsync(RETRY_DEGRADED_MS);
    expect(prepared).toHaveBeenCalledTimes(4);
    expect(canvasOf(key)).toEqual({ id: 3 });
  });

  it('oubliée entre-temps (nouvelle lecture) : pas de nouvel essai, rien n’est remis', async () => {
    const shown = source('oubliee');
    const key = silhouetteKey(shown);
    prepared.mockResolvedValueOnce(degraded).mockResolvedValue(plies);
    await prerenderSilhouette(shown, load);
    retainSilhouettes([]);
    await vi.advanceTimersByTimeAsync(2 * RETRY_DEGRADED_MS);
    expect(prepared).toHaveBeenCalledTimes(1);
    expect(silhouetteEntry(key)).toBeUndefined();
  });

  it('une paire sans données de bras (rendu actuel voulu) n’est jamais redessinée', async () => {
    const shown = source('avant-26-10');
    prepared.mockResolvedValue(current);
    await prerenderSilhouette(shown, load);
    await vi.advanceTimersByTimeAsync(3 * RETRY_DEGRADED_MS);
    expect(prepared).toHaveBeenCalledTimes(1);
    expect(canvasOf(silhouetteKey(shown))).toEqual({ id: 1 });
  });
});
