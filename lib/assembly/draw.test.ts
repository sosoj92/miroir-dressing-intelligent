import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AssemblyPhoto } from '@/lib/types';
import { planSilhouette } from './arms-plan';
import { drawSilhouette, prepareSilhouette, renderSilhouette, type DrawableImage } from './draw';
import { parseAssemblyPhoto } from './parse';
import { planRender, type Picture, type SilhouetteSource } from './render';

// L'adaptateur canvas (draw.ts) avec une toile factice qui enregistre chaque appel : il suit le
// plan à la lettre, avec les réglages de la recette, et sans données de bras il fait exactement
// ce qu'il faisait avant. Le rendu réel est vérifié dans Chromium, hors dépôt.

type Call = { canvas: number; name: string; args: unknown[]; state: string };

let calls: Call[] = [];
let nextId = 0;

class FakeGradient {
  stops: Array<[number, string]> = [];
  constructor(readonly args: number[]) {}
  addColorStop(offset: number, color: string) {
    this.stops.push([offset, color]);
  }
}

class FakeContext {
  imageSmoothingEnabled = true;
  imageSmoothingQuality: ImageSmoothingQuality = 'low';
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  globalAlpha = 1;
  fillStyle: unknown = '#000';
  transform = [1, 0, 0, 1, 0, 0];
  constructor(readonly canvas: FakeCanvas) {}
  reset() {
    this.imageSmoothingEnabled = true;
    this.imageSmoothingQuality = 'low';
    this.globalCompositeOperation = 'source-over';
    this.transform = [1, 0, 0, 1, 0, 0];
  }
  private log(name: string, args: unknown[]) {
    const state = [this.imageSmoothingEnabled, this.imageSmoothingQuality, this.globalCompositeOperation, this.transform.join(',')].join('|');
    calls.push({ canvas: this.canvas.id, name, args, state });
  }
  setTransform(...m: number[]) {
    this.transform = m;
  }
  clearRect(...args: number[]) {
    this.log('clearRect', args);
  }
  fillRect(...args: number[]) {
    const gradient = this.fillStyle as FakeGradient;
    this.log('fillRect', [...args, gradient.args, gradient.stops]);
  }
  drawImage(...args: unknown[]) {
    this.log('drawImage', args);
  }
  createLinearGradient(...args: number[]) {
    return new FakeGradient(args);
  }
  getImageData(): never {
    throw new Error('lecture de pixels interdite');
  }
}

class FakeCanvas {
  readonly id = nextId++;
  private w = 300;
  private h = 150;
  readonly context = new FakeContext(this);
  get width() {
    return this.w;
  }
  set width(value: number) {
    this.w = value;
    this.context.reset();
  }
  get height() {
    return this.h;
  }
  set height(value: number) {
    this.h = value;
    this.context.reset();
  }
  getContext() {
    return this.context;
  }
}

const realDocument = (globalThis as { document?: unknown }).document;
beforeEach(() => {
  calls = [];
  (globalThis as { document?: unknown }).document = { createElement: () => new FakeCanvas() };
});
afterEach(() => {
  (globalThis as { document?: unknown }).document = realDocument;
});

// Paires de référence (fixtures/arms-reference.json, repères tirés de photos portées personnelles) :
// générées en local, jamais commitées. Sans elles, les tests sont sautés.
type Reference = {
  photos: Record<string, object>;
  cases: Array<{ covers: string; upper: string; lower: string; upperSleeves: string | null; mode: string }>;
};
const FIXTURE = new URL('./fixtures/arms-reference.json', import.meta.url);
const found = existsSync(FIXTURE);
const reference: Reference = found ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Reference) : { photos: {}, cases: [] };

function photoOf(key: string): AssemblyPhoto {
  return parseAssemblyPhoto({ ...reference.photos[key], key })!;
}

function picture(photo: AssemblyPhoto): Picture {
  const arms = photo.arms;
  const url = `cutout/${photo.key}`;
  if (!arms) return { photo, url };
  return { photo, url, layers: { arms: arms.arms.path, body: arms.body.path, sleeves: arms.sleeves?.path ?? null } };
}

function sourceOf(covers: string, withArms = true): SilhouetteSource {
  const entry = reference.cases.find((candidate) => candidate.covers === covers)!;
  const strip = (photo: AssemblyPhoto) => {
    if (withArms) return photo;
    const copy = { ...photo };
    delete copy.arms;
    return copy;
  };
  return {
    kind: 'pair',
    upper: { ...picture(strip(photoOf(entry.upper))), sleevesUrl: entry.upperSleeves },
    lower: picture(strip(photoOf(entry.lower))),
  };
}

/** Une « image » factice par URL ; garde la trace des chargements. */
function loader() {
  const loaded: string[] = [];
  const images = new Map<string, DrawableImage>();
  const load = async (url: string) => {
    loaded.push(url);
    if (!images.has(url)) images.set(url, { url } as unknown as DrawableImage);
    return images.get(url)!;
  };
  return { load, loaded, images };
}

describe.skipIf(!found)('lib/assembly/draw : bras pliés', () => {
  for (const covers of ['bras nus', 'ventre étiré', 'manches longues', 'manches longues et ventre étiré']) {
    it(`${covers} : chaque opération du plan, dans l’ordre, avec les réglages de la recette`, async () => {
      const source = sourceOf(covers);
      const plan = planSilhouette(source);
      expect(plan.mode).toBe('plies');
      const { load, loaded, images } = loader();
      const canvas = (await renderSilhouette(source, load)) as unknown as FakeCanvas;

      // Chaque image du plan chargée une fois, et seulement elles.
      const urls = [...new Set(Object.values(plan.images).map((image) => image!.url))];
      expect(loaded.sort()).toEqual(urls.sort());
      expect([canvas.width, canvas.height]).toEqual([800, 1370]);

      // Les toiles : main = la toile rendue, tmp et arms partagées, toutes de la taille de la scène.
      const ids: Record<string, number> = { main: canvas.id };
      const drawn = calls.filter((call) => call.name === 'drawImage' || call.name === 'fillRect');
      let index = 0;
      for (const op of plan.ops) {
        if (op.op === 'clear') continue;
        if (op.op === 'draw' && (op.s[2] <= 0 || op.s[3] <= 0 || op.d[2] <= 0 || op.d[3] <= 0)) continue;
        const call = drawn[index++];
        if (op.dst in ids) expect(call.canvas, `op ${index}`).toBe(ids[op.dst]);
        else ids[op.dst] = call.canvas;
        if (op.op === 'draw') {
          const src = op.src === 'main' || op.src === 'tmp' || op.src === 'arms' ? undefined : images.get(plan.images[op.src]!.url);
          if (src) expect(call.args[0]).toBe(src);
          expect(call.args.slice(1)).toEqual([...op.s, ...op.d]);
          expect(call.state).toBe('true|low|source-over|1,0,0,1,0,0');
        } else if (op.op === 'fade') {
          const first = op.stops[0][0];
          const last = op.stops[op.stops.length - 1][0];
          expect(call.args).toEqual([
            0,
            0,
            800,
            1370,
            [0, first, 0, last],
            op.stops.map(([y, w]) => [(y - first) / (last - first), `rgba(0, 0, 0, ${w})`]),
          ]);
          expect(call.state).toBe('true|low|destination-in|1,0,0,1,0,0');
        } else {
          expect(call.args).toEqual([expect.objectContaining({ id: ids[op.src] }), 0, 0]);
          expect(call.state).toBe(`true|low|${op.mode}|1,0,0,1,0,0`);
        }
      }
      expect(index).toBe(drawn.length);
      expect(new Set(Object.values(ids)).size).toBe(3);
    });
  }

  it('vignette : dessinée à l’échelle 1 dans une toile de la scène, puis réduite', async () => {
    const source = sourceOf('bras nus');
    const { load } = loader();
    const canvas = (await renderSilhouette(source, load, 0.5)) as unknown as FakeCanvas;
    expect([canvas.width, canvas.height]).toEqual([400, 685]);
    const onTarget = calls.filter((call) => call.canvas === canvas.id);
    expect(onTarget).toHaveLength(1);
    expect(onTarget[0].name).toBe('drawImage');
    expect(onTarget[0].args.slice(1)).toEqual([0, 0]);
    expect(onTarget[0].state).toBe('true|medium|source-over|0.5,0,0,0.5,0,0');
    // Tout le reste à l'échelle 1, en bilinéaire pur.
    const others = calls.filter((call) => call.canvas !== canvas.id && call.name === 'drawImage');
    expect(others.length).toBeGreaterThan(300);
    expect(others.every((call) => call.state.startsWith('true|low|') && call.state.endsWith('|1,0,0,1,0,0'))).toBe(true);
  });
});

describe.skipIf(!found)('lib/assembly/draw : couche introuvable', () => {
  it('une couche des bras pliés qui ne se charge pas : rendu d’aujourd’hui, pas d’échec', async () => {
    const source = sourceOf('bras nus');
    if (source.kind !== 'pair') throw new Error('paire attendue');
    const { load, loaded } = loader();
    const failing = (url: string) => (url === source.lower.layers!.body ? Promise.reject(new Error('404')) : load(url));
    const canvas = (await renderSilhouette(source, failing)) as unknown as FakeCanvas;
    expect([canvas.width, canvas.height]).toEqual([800, 1370]);
    // Après l'échec, seulement les images d'aujourd'hui, et 3 drawImage (haut, bas, calque).
    expect(loaded.slice(-2)).toEqual([source.upper.url, source.lower.url]);
    expect(calls.filter((call) => call.name === 'drawImage')).toHaveLength(3);
  });

  it('rendu de secours marqué « degraded », jamais le rendu actuel voulu (sans données de bras)', async () => {
    const source = sourceOf('bras nus');
    if (source.kind !== 'pair') throw new Error('paire attendue');
    const { load } = loader();
    const failing = (url: string) => (url === source.lower.layers!.arms ? Promise.reject(new Error('réseau')) : load(url));
    await expect(prepareSilhouette(source, failing)).resolves.toMatchObject({ mode: 'actuel', degraded: true });
    await expect(prepareSilhouette(source, load)).resolves.toMatchObject({ mode: 'plies' });
    const before = await prepareSilhouette(sourceOf('manches longues', false), load);
    expect(before.mode).toBe('actuel');
    expect(before).not.toHaveProperty('degraded');
  });

  it('une photo détourée introuvable : la silhouette échoue, comme avant', async () => {
    const source = sourceOf('bras nus');
    if (source.kind !== 'pair') throw new Error('paire attendue');
    const { load } = loader();
    const failing = (url: string) => (url === source.lower.url ? Promise.reject(new Error('404')) : load(url));
    await expect(renderSilhouette(source, failing)).rejects.toThrow('404');
  });
});

describe.skipIf(!found)('lib/assembly/draw : sans données de bras, le rendu d’aujourd’hui', () => {
  for (const scale of [1, 0.5]) {
    it(`échelle ${scale} : mêmes images, mêmes appels que drawSilhouette(planRender)`, async () => {
      const source = sourceOf('manches longues', false);
      expect(planSilhouette(source).mode).toBe('actuel');
      const { load, loaded, images } = loader();
      await renderSilhouette(source, load, scale);
      const mine = calls.map(({ name, args, state }) => ({ name, args, state }));
      if (source.kind !== 'pair') throw new Error('paire attendue');
      // Photo du haut, du bas, manches de la pièce : dans cet ordre, comme avant.
      expect(loaded).toEqual([source.upper.url, source.lower.url, source.upper.sleevesUrl]);

      calls = [];
      const target = new FakeCanvas() as unknown as HTMLCanvasElement;
      drawSilhouette(target, planRender(source), {
        upper: images.get(source.upper.url)!,
        lower: images.get(source.lower.url)!,
        sleeves: images.get(source.upper.sleevesUrl!)!,
      }, scale);
      const today = calls.map(({ name, args, state }) => ({ name, args, state }));
      const anonymous = (list: typeof mine) =>
        list.map((call) => ({ ...call, args: call.args.map((arg) => (arg instanceof FakeCanvas ? 'toile' : arg)) }));
      expect(anonymous(mine)).toEqual(anonymous(today));
    });
  }
});
