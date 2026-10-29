import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AssemblyPhoto } from '@/lib/types';
import { ARMS_CONSTANTS, planSilhouette, type ArmsGeometry, type SilhouettePlan } from './arms-plan';
import { parseAssemblyPhoto } from './parse';
import { ASSEMBLY_MARGIN, FEATHER } from './plan';
import { STAGE_EYE, STAGE_HEIGHT, STAGE_WIDTH, planRender, type Picture, type SilhouetteSource } from './render';

// Le plan TypeScript doit être celui de scripts/assemblage/bras_plan.py (la référence), à 1e-6,
// sur les paires de fixtures/arms-reference.json (écrit par ref_fixture.py bras). Ce fichier contient
// des repères tirés de photos portées personnelles : il est généré en local et jamais commité ; sans
// lui, ces tests sont sautés. Il pèse plus d'un Mo : lu par fs + JSON.parse, pas importé (l'inférence de type
// ralentirait tsc).

type RefImage = { photo: string; layer: string; path?: string; box: number[] };
type RefSide = { strips: number[][]; rigid: number; y_end: number | null };
type RefCase = {
  top: string;
  bottom: string;
  covers: string;
  upper: string;
  lower: string;
  upperSleeves: string | null;
  mode: string;
  reason: string | null;
  checks: Record<string, boolean>;
  geometry: Record<string, unknown> & { sides?: Record<string, RefSide> };
  images: Record<string, RefImage>;
  canvases: string[];
  ops: unknown[];
};
type Reference = {
  margin: number;
  feather: number;
  stage: { width: number; height: number; eye: [number, number] };
  constants: Record<string, number>;
  photos: Record<string, unknown>;
  cases: RefCase[];
};

const FIXTURE = new URL('./fixtures/arms-reference.json', import.meta.url);
const found = existsSync(FIXTURE);
// Sans fichier, une référence vide : les blocs sautés se déclarent sans rien lire.
const reference: Reference = found
  ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Reference)
  : { margin: 0, feather: 0, stage: { width: 0, height: 0, eye: [0, 0] }, constants: {}, photos: {}, cases: [] };

const TOLERANCE = 1e-6;

function photoOf(key: string): AssemblyPhoto {
  const photo = parseAssemblyPhoto({ ...(reference.photos[key] as object), key });
  if (!photo) throw new Error(`photo illisible : ${key}`);
  return photo;
}

/** URL d'essai d'une photo détourée ; les couches gardent leur chemin du zip comme URL. */
const cutoutUrl = (key: string) => `cutout/${key}`;

function picture(photo: AssemblyPhoto): Picture {
  const arms = photo.arms;
  if (!arms) return { photo, url: cutoutUrl(photo.key) };
  return {
    photo,
    url: cutoutUrl(photo.key),
    layers: { arms: arms.arms.path, body: arms.body.path, sleeves: arms.sleeves ? arms.sleeves.path : null },
  };
}

function sourceOf(upper: AssemblyPhoto, lower: AssemblyPhoto, sleevesUrl: string | null): SilhouetteSource {
  return { kind: 'pair', upper: { ...picture(upper), sleevesUrl }, lower: picture(lower) };
}

/** Égalité à TOLERANCE près sur les nombres, stricte ailleurs (mêmes clés, mêmes longueurs). */
function expectClose(actual: unknown, expected: unknown, path: string) {
  if (typeof expected === 'number') {
    expect(typeof actual, path).toBe('number');
    expect(Math.abs((actual as number) - expected), `${path} : ${actual} au lieu de ${expected}`).toBeLessThanOrEqual(TOLERANCE);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    const list = actual as unknown[];
    expect(list.length, `${path} (longueur)`).toBe(expected.length);
    expected.forEach((value, index) => expectClose(list[index], value, `${path}[${index}]`));
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    expect(actual !== null && typeof actual === 'object', path).toBe(true);
    const object = actual as Record<string, unknown>;
    expect(Object.keys(object).sort(), `${path} (clés)`).toEqual(Object.keys(expected).sort());
    for (const [key, value] of Object.entries(expected)) expectClose(object[key], value, `${path}.${key}`);
    return;
  }
  expect(actual, path).toBe(expected);
}

/** Géométrie du plan TypeScript dans la forme du fichier de référence (y_end, sans undefined). */
function referenceGeometry(geometry: ArmsGeometry | null): Record<string, unknown> | null {
  if (!geometry) return null;
  const { sides, ...rest } = geometry;
  const out: Record<string, unknown> = { ...rest };
  if (sides) {
    out.sides = Object.fromEntries(
      Object.entries(sides).map(([side, plan]) => [side, { strips: plan.strips, rigid: plan.rigid, y_end: plan.yEnd }]),
    );
  }
  return out;
}

function planOf(entry: RefCase): { plan: SilhouettePlan; source: SilhouetteSource } {
  const source = sourceOf(photoOf(entry.upper), photoOf(entry.lower), entry.upperSleeves);
  return { plan: planSilhouette(source), source };
}

describe.skipIf(!found)('lib/assembly/arms-plan : réglages', () => {
  it('mêmes constantes, marge, fondu et scène que bras_plan.py', () => {
    expect(ARMS_CONSTANTS).toEqual(reference.constants);
    expect([ASSEMBLY_MARGIN, FEATHER]).toEqual([reference.margin, reference.feather]);
    expect({ width: STAGE_WIDTH, height: STAGE_HEIGHT, eye: [...STAGE_EYE] }).toEqual(reference.stage);
  });

  it('le fichier de référence couvre bras nus, ventre étiré, manches longues, hauts longs et replis', () => {
    const modes = reference.cases.map((entry) => entry.mode);
    // Au moins une paire en bras pliés (le nombre dépend du jeu de photos) ; les raisons, elles, sont
    // les cas que paires.json doit couvrir (scripts/assemblage/README.md, en-tête de ref_fixture.py).
    expect(modes.filter((mode) => mode === 'plies').length).toBeGreaterThanOrEqual(1);
    expect(new Set(reference.cases.map((entry) => entry.reason))).toEqual(
      new Set([
        null,
        'haut long',
        'haut plus long que la zone mesurée',
        'pas de données de bras',
        'précondition : stripSides, kPositive',
      ]),
    );
  });
});

describe.skipIf(!found)('lib/assembly/arms-plan : plan égal à celui de bras_plan.py', () => {
  for (const entry of reference.cases) {
    it(`${entry.top} + ${entry.bottom} (${entry.covers})`, () => {
      const { plan, source } = planOf(entry);
      expect(plan.mode).toBe(entry.mode);
      expect(plan.reason).toBe(entry.reason);
      expect(plan.checks).toEqual(entry.checks);
      expect([plan.width, plan.height]).toEqual([reference.stage.width, reference.stage.height]);
      expect(plan.canvases).toEqual(entry.canvases);
      expectClose(referenceGeometry(plan.geometry), entry.geometry, 'geometry');

      // Images : mêmes rôles, photos, couches et boîtes ; l'URL est celle de la source.
      expect(Object.keys(plan.images)).toEqual(Object.keys(entry.images));
      for (const [role, image] of Object.entries(entry.images)) {
        const mine = plan.images[role as keyof typeof plan.images]!;
        expect({ photo: mine.photo, layer: mine.layer, box: mine.box }, role).toEqual({
          photo: image.photo,
          layer: image.layer,
          box: image.box,
        });
        // Chemins du zip dans le fichier de référence ; ici, ces chemins servent d'URL d'essai.
        expect(mine.url, role).toBe(image.layer === 'cutout' ? cutoutUrl(image.photo) : image.path);
      }

      expectClose(plan.ops, entry.ops, 'ops');

      if (entry.mode === 'actuel') {
        // Rendu actuel : exactement le plan d'aujourd'hui, que drawSilhouette dessine tel quel.
        expect(plan.current).toStrictEqual(planRender(source));
      } else {
        expect(plan.current).toBeNull();
      }
    });
  }

  it('les bords de destination des bandes sont entiers, et chaque bande fait une ligne', () => {
    for (const entry of reference.cases) {
      const { plan } = planOf(entry);
      for (const op of plan.ops) {
        if (op.op !== 'draw' || op.kind !== 'strip') continue;
        const [x, y, width, height] = op.d;
        expect([x, y, width, height].every(Number.isInteger), `${entry.top}+${entry.bottom}`).toBe(true);
        expect([op.s[3], height]).toEqual([1, 1]);
      }
    }
  });
});

describe.skipIf(!found)('lib/assembly/arms-plan : sans données de bras, le plan d’aujourd’hui', () => {
  const bare = (photo: AssemblyPhoto): AssemblyPhoto => {
    const copy = { ...photo };
    delete copy.arms;
    return copy;
  };

  it('pour chaque paire, une photo sans bras pliés (haut, bas ou les deux) : rendu actuel, plan strictement égal', () => {
    for (const entry of reference.cases) {
      const upper = photoOf(entry.upper);
      const lower = photoOf(entry.lower);
      for (const [a, b] of [
        [bare(upper), lower],
        [upper, bare(lower)],
        [bare(upper), bare(lower)],
      ]) {
        const source = sourceOf(a, b, entry.upperSleeves);
        const plan = planSilhouette(source);
        expect(plan.mode).toBe('actuel');
        expect(plan.reason).toBe('pas de données de bras');
        expect(plan.checks).toEqual({});
        expect(plan.current).toStrictEqual(planRender(source));
        // Seules les images d'aujourd'hui : détourages et manches de la pièce.
        expect(Object.keys(plan.images).every((role) => ['A.cutout', 'B.cutout', 'A.itemSleeves'].includes(role))).toBe(true);
      }
    }
  });

  it('données de bras sans couches signées : rendu actuel', () => {
    const entry = reference.cases[0];
    const source = sourceOf(photoOf(entry.upper), photoOf(entry.lower), null);
    if (source.kind !== 'pair') throw new Error('paire attendue');
    const unsigned: SilhouetteSource = { ...source, lower: { photo: source.lower.photo, url: source.lower.url } };
    const plan = planSilhouette(unsigned);
    expect(plan.mode).toBe('actuel');
    expect(plan.current).toStrictEqual(planRender(unsigned));
  });

  it('robe seule : le plan d’aujourd’hui, une seule image', () => {
    const photo = bare(photoOf(reference.cases[0].upper));
    const source: SilhouetteSource = { kind: 'single', piece: { photo, url: 'robe.webp' } };
    const plan = planSilhouette(source);
    expect(plan.mode).toBe('actuel');
    expect(plan.current).toStrictEqual(planRender(source));
    expect(Object.keys(plan.images)).toEqual(['A.cutout']);
    const { x, y } = plan.current!.offset;
    expect(plan.ops).toEqual([{ op: 'draw', dst: 'main', src: 'A.cutout', s: [0, 0, 1200, 1600], d: [x, y, 1200, 1600] }]);
  });
});

describe.skipIf(!found)('lib/assembly/arms-plan : préconditions', () => {
  it('fondu du corps trop court (ys − 10 > ye − 30) : rendu actuel', () => {
    // Synthétique : ventre étiré de 111 px sous la jonction et poignets du bas à 94 px sous elle
    // (pli le plus court, 120 px) : le pli finit avant la fin du fondu du corps.
    const entry = reference.cases.find((candidate) => candidate.covers === 'bras nus')!;
    const upper = { ...photoOf(entry.upper), topLow: 400, bottomHigh: 449, tucked: false };
    const lower = photoOf(entry.lower);
    const short = { ...lower, topLow: 511, arms: { ...lower.arms!, wrist: { L: 500, R: 500 } } };
    const source = sourceOf(upper, short, null);
    const plan = planSilhouette(source);
    expect(plan.geometry).toMatchObject({ s: 517, band: [406, 446], longTop: false });
    expect(plan.checks.fade4).toBe(false);
    expect(plan.mode).toBe('actuel');
    expect(plan.reason).toMatch(/^précondition : .*fade4/);
    expect(plan.current).toStrictEqual(planRender(source));
  });

  it('boîte des manches au-dessous du ventre étiré : rendu actuel (bras_plan.py s’arrêterait)', () => {
    const entry = reference.cases.find((candidate) => candidate.covers === 'manches longues et ventre étiré')!;
    expect(planOf(entry).plan.mode).toBe('plies');
    const upper = photoOf(entry.upper);
    const sleeves = upper.arms!.sleeves!;
    const lowered = {
      ...upper,
      arms: { ...upper.arms!, sleeves: { ...sleeves, box: [sleeves.box[0], 1400, sleeves.box[2], 100] as [number, number, number, number] } },
    };
    const source = sourceOf(lowered, photoOf(entry.lower), entry.upperSleeves);
    const plan = planSilhouette(source);
    expect(plan.mode).toBe('actuel');
    expect(plan.reason).toBe('précondition : stretchBox');
    expect(plan.current).toStrictEqual(planRender(source));
  });
});
