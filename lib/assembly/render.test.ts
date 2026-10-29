import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Assembly, AssemblyPhoto, Category, Item } from '@/lib/types';
import { FEATHER, planSplit } from './plan';
import {
  STAGE_EYE,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  drawnOutfitInputs,
  lowerWeight,
  planRender,
  roundHalfEven,
  silhouetteKey,
  silhouetteSource,
  silhouetteUrls,
  upperWeight,
  type DrawStep,
  type RenderPlan,
  type SignedItem,
  type SilhouetteSource,
} from './render';

// Repères de référence (fixtures/reference.json, scripts/assemblage/ref_fixture.py) : tirés de photos
// portées personnelles, générés en local et jamais commités. Sans eux, les tests qui les lisent sont
// sautés ; les autres utilisent des photos synthétiques.
type Reference = {
  photos: Record<string, AssemblyPhoto>;
  items: Record<string, { photo: string; category: string }>;
  cases: Array<{ top: string; bottom: string; split: number; stretch: [number, number] | null }>;
};
const FIXTURE = new URL('./fixtures/reference.json', import.meta.url);
const reference = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Reference) : null;
const photos = reference?.photos ?? {};
const refItems = reference?.items ?? {};
const cases = reference?.cases ?? [];

function base(overrides: Partial<AssemblyPhoto>): AssemblyPhoto {
  return {
    key: 'X',
    size: [1200, 1600],
    eye: [600, 400],
    centers: [
      [400, 630],
      [500, 640],
      [600, 650],
    ],
    topLow: 480,
    bottomHigh: 520,
    onePiece: false,
    tucked: false,
    ...overrides,
  };
}

function pair(upper: AssemblyPhoto, lower: AssemblyPhoto, sleevesUrl: string | null = null): SilhouetteSource {
  return { kind: 'pair', upper: { photo: upper, url: 'haut.webp', sleevesUrl }, lower: { photo: lower, url: 'bas.webp' } };
}

/** Ligne de la photo du haut dessinée sur la ligne `row` de la scène (centre de pixel). */
function sourceRowAt(steps: DrawStep[], row: number): number | null {
  const centre = row + 0.5;
  for (const { source, dest } of steps) {
    if (centre >= dest.y && centre < dest.y + dest.height) {
      return source.y + ((centre - dest.y) * source.height) / dest.height - 0.5;
    }
  }
  return null;
}

/** Formule de la préparation Python : wA = clip((ys + FEATHER − y) / (2·FEATHER), 0, 1). */
function pythonWeight(cut: number, row: number): number {
  return Math.min(1, Math.max(0, (cut + FEATHER - row) / (2 * FEATHER)));
}

function expectFadeCovered(plan: RenderPlan) {
  const fade = plan.upper.fade!;
  const cut = plan.cut!;
  for (let row = cut - 3 * FEATHER; row <= cut + 3 * FEATHER; row++) {
    const upper = upperWeight(fade, row);
    const lower = lowerWeight(fade, row);
    expect(upper + lower, `ligne ${row}`).toBeCloseTo(1, 12);
    expect(upper, `ligne ${row}`).toBeCloseTo(pythonWeight(cut, row), 12);
    // Partout où le haut compte, il est dessiné : pas de bande à moitié transparente.
    if (upper > 0) expect(sourceRowAt(plan.upper.draws, row), `ligne ${row} du haut`).not.toBeNull();
  }
}

describe('lib/assembly/render : coupe', () => {
  it('sans étirement : la photo du haut jusqu’à la fin du fondu, le bas décalé, même fondu inversé', () => {
    const upper = base({ topLow: 480, bottomHigh: 520 });
    const lower = base({ eye: [580, 390], centers: [[400, 610], [500, 620]], topLow: 450 });
    const plan = planRender(pair(upper, lower));
    // Coupe à 486 px sous les yeux du haut ; yeux du haut posés en STAGE_EYE.
    expect(plan.offset).toEqual({ x: STAGE_EYE[0] - 600, y: STAGE_EYE[1] - 400 });
    expect(plan.cut).toBe(STAGE_EYE[1] + 486);
    expect(plan.upper.draws).toEqual([
      { source: { x: 0, y: 0, width: 1200, height: 886 + FEATHER }, dest: { x: -200, y: -250, width: 1200, height: 886 + FEATHER } },
    ]);
    // Bas : dx = 638,6 − 618,6 (milieux interpolés à la ligne 486), dy = 400 − 390.
    const draw = plan.lower!.draw;
    expect(draw.source).toEqual({ x: 0, y: 0, width: 1200, height: 1600 });
    expect(draw.dest.x).toBeCloseTo(-200 + 20, 9);
    expect(draw.dest.y).toBe(-250 + 10);
    expect(plan.upper.fade).toEqual({ from: plan.cut! - FEATHER + 0.5, to: plan.cut! + FEATHER + 0.5 });
    expect(plan.lower!.fade).toBe(plan.upper.fade);
    expect(plan.sleeves).toBeNull();
    expectFadeCovered(plan);
  });

  it('avec étirement : le ventre est étiré jusqu’à la coupe, puis prolongé au même rapport', () => {
    // Ventre de 486 à 517 étiré jusqu'à 536 (planSplit), yeux à 400.
    const upper = base({ topLow: 480, bottomHigh: 520 });
    const lower = base({ topLow: 530 });
    expect(planSplit(upper, lower)).toEqual({ split: 536, stretch: [486, 517] });
    const plan = planRender(pair(upper, lower));
    const [above, band] = plan.upper.draws;
    const oy = plan.offset.y;
    expect(above).toEqual({ source: { x: 0, y: 0, width: 1200, height: 886 }, dest: { x: plan.offset.x, y: oy, width: 1200, height: 886 } });
    expect(band.dest).toEqual({ x: plan.offset.x, y: oy + 886, width: 1200, height: 936 + FEATHER - 886 });
    expect(band.source.y).toBe(886);
    // La bande [886, 917[ de la photo arrive exactement sur [886, 936[ de la photo (coupe).
    const ratio = (917 - 886) / (936 - 886);
    expect(band.source.height).toBeCloseTo((936 + FEATHER - 886) * ratio, 9);
    expect(band.source.y + ((936 - 886) * band.source.height) / band.dest.height).toBeCloseTo(917, 9);
    // Rien sous la coupe ne vient des lignes correspondantes de la photo du haut.
    const lastSource = band.source.y + band.source.height;
    expect(lastSource).toBeLessThan(936);
    expectFadeCovered(plan);
  });

  it.skipIf(!reference)('suit planSplit sur toutes les paires de référence, étirées ou non, et couvre toujours le fondu', () => {
    let stretched = 0;
    for (const c of cases) {
      const upper = photos[refItems[c.top].photo];
      const lower = photos[refItems[c.bottom].photo];
      const plan = planRender(pair(upper, lower));
      expect(plan.cut, `${c.top}+${c.bottom}`).toBe(plan.offset.y + roundHalfEven(upper.eye[1] + c.split));
      expect(plan.upper.draws, `${c.top}+${c.bottom}`).toHaveLength(c.stretch ? 2 : 1);
      if (c.stretch) stretched++;
      expectFadeCovered(plan);
    }
    expect(stretched).toBeGreaterThan(0);
  });

  it('dessine les manches par-dessus, à la place de la photo du haut', () => {
    const plan = planRender(pair(base({}), base({}), 'manches.webp'));
    expect(plan.sleeves).toEqual({
      source: { x: 0, y: 0, width: 1200, height: 1600 },
      dest: { x: plan.offset.x, y: plan.offset.y, width: 1200, height: 1600 },
    });
  });
});

describe('lib/assembly/render : robe', () => {
  it('affiche la photo seule, sans coupe ni fondu', () => {
    const photo = base({ onePiece: true, topLow: null, bottomHigh: null, eye: [590.4, 386.6] });
    const plan = planRender({ kind: 'single', piece: { photo, url: 'robe.webp' } });
    expect(plan).toEqual({
      width: STAGE_WIDTH,
      height: STAGE_HEIGHT,
      offset: { x: -190, y: -237 },
      cut: null,
      upper: { draws: [{ source: { x: 0, y: 0, width: 1200, height: 1600 }, dest: { x: -190, y: -237, width: 1200, height: 1600 } }], fade: null },
      lower: null,
      sleeves: null,
    });
  });
});

describe('lib/assembly/render : placement', () => {
  it.skipIf(!reference)('pose toujours les yeux de la photo du haut au même point de la scène (à un demi-pixel près)', () => {
    const lower = Object.values(photos)[0];
    for (const photo of Object.values(photos)) {
      const plan = planRender(pair(photo, lower));
      expect(Number.isInteger(plan.offset.x) && Number.isInteger(plan.offset.y)).toBe(true);
      expect(Math.abs(photo.eye[0] + plan.offset.x - STAGE_EYE[0])).toBeLessThanOrEqual(0.5);
      expect(Math.abs(photo.eye[1] + plan.offset.y - STAGE_EYE[1])).toBeLessThanOrEqual(0.5);
    }
  });

  it.skipIf(!reference)('la scène contient la tête et le bas des photos de référence', () => {
    for (const photo of Object.values(photos)) {
      const { offset } = planRender(pair(photo, photo));
      expect(offset.y + photo.eye[1] - 120, photo.key).toBeGreaterThanOrEqual(0); // dessus de la tête
      // Le bas de la photo n'est pas coupé, sans grand vide dessous.
      expect(offset.y + photo.size[1], photo.key).toBeLessThanOrEqual(STAGE_HEIGHT + 1);
      expect(offset.y + photo.size[1], photo.key).toBeGreaterThan(STAGE_HEIGHT - 40);
    }
  });

  it('arrondit la coupe comme round() de Python', () => {
    expect(roundHalfEven(928.5)).toBe(928);
    expect(roundHalfEven(929.5)).toBe(930);
    expect(roundHalfEven(929.4)).toBe(929);
    expect(roundHalfEven(929.6)).toBe(930);
    expect(roundHalfEven(-1.5)).toBe(-2);
  });
});

describe('lib/assembly/render : poids du fondu', () => {
  const fade = { from: 990.5, to: 1010.5 }; // coupe à la ligne 1000

  it('1 au-dessus, 0 en dessous, 0,5 sur la coupe, et la somme vaut toujours 1', () => {
    expect(upperWeight(fade, 980)).toBe(1);
    expect(upperWeight(fade, 990)).toBe(1);
    expect(upperWeight(fade, 1000)).toBe(0.5);
    expect(upperWeight(fade, 1010)).toBe(0);
    expect(lowerWeight(fade, 990)).toBe(0);
    expect(lowerWeight(fade, 1010)).toBe(1);
    for (let row = 970; row <= 1030; row++) {
      expect(upperWeight(fade, row) + lowerWeight(fade, row)).toBeCloseTo(1, 12);
      expect(upperWeight(fade, row)).toBeCloseTo(pythonWeight(1000, row), 12);
    }
  });
});

const ASSEMBLY: Assembly = { v: 1, photo: base({}), sleevesPath: null };

function item(id: string, category: Category, extra: Partial<SignedItem> = {}): SignedItem {
  return {
    id,
    name: id,
    category,
    color: null,
    warmth: 2,
    styles: ['decontracte'],
    rain_ok: false,
    dirty: false,
    photo_path: null,
    cutout_path: `u/${id}.webp`,
    legacy_id: null,
    created_at: '',
    assembly: ASSEMBLY,
    cutout_url: `https://signe.test/${id}.webp`,
    sleeves_url: null,
    ...extra,
  };
}

function byId(items: SignedItem[]) {
  return new Map(items.map((entry) => [entry.id, entry]));
}

describe('lib/assembly/render : source d’une tenue', () => {
  it('veste au-dessus du bas, avec ses manches', () => {
    const jacket = item('v', 'veste', {
      assembly: { ...ASSEMBLY, sleevesPath: 'u/manches/v.webp' },
      sleeves_url: 'https://signe.test/manches-v.webp',
    });
    const source = silhouetteSource(['v', 'h', 'b', 'c'], byId([jacket, item('h', 'haut'), item('b', 'bas'), item('c', 'chaussures')]));
    expect(source).toEqual({
      kind: 'pair',
      upper: { photo: ASSEMBLY.photo, url: 'https://signe.test/v.webp', sleevesUrl: 'https://signe.test/manches-v.webp' },
      lower: { photo: ASSEMBLY.photo, url: 'https://signe.test/b.webp' },
    });
    expect(silhouetteUrls(source!)).toEqual([
      'https://signe.test/v.webp',
      'https://signe.test/b.webp',
      'https://signe.test/manches-v.webp',
    ]);
  });

  it('robe seule', () => {
    const source = silhouetteSource(['r'], byId([item('r', 'robe')]));
    expect(source).toEqual({ kind: 'single', piece: { photo: ASSEMBLY.photo, url: 'https://signe.test/r.webp' } });
    expect(silhouetteUrls(source!)).toEqual(['https://signe.test/r.webp']);
  });

  it('pas de silhouette si une image manque ou si une pièce n’a pas de photo portée', () => {
    expect(silhouetteSource(['h', 'b'], byId([item('h', 'haut'), item('b', 'bas', { cutout_url: null })]))).toBeNull();
    expect(silhouetteSource(['h', 'b'], byId([item('h', 'haut'), item('b', 'bas', { assembly: null })]))).toBeNull();
    const unsigned = item('h', 'haut', { assembly: { ...ASSEMBLY, sleevesPath: 'u/manches/h.webp' }, sleeves_url: null });
    expect(silhouetteSource(['h', 'b'], byId([unsigned, item('b', 'bas')]))).toBeNull();
    expect(silhouetteSource(['r'], byId([item('r', 'robe', { cutout_url: null })]))).toBeNull();
  });

  it('une clé de cache par repères et URL', () => {
    const a = silhouetteSource(['h', 'b'], byId([item('h', 'haut'), item('b', 'bas')]))!;
    const b = silhouetteSource(['h', 'b'], byId([item('h', 'haut', { cutout_url: 'https://signe.test/h2.webp' }), item('b', 'bas')]))!;
    expect(silhouetteKey(a)).toBe(silhouetteKey(silhouetteSource(['h', 'b'], byId([item('h', 'haut'), item('b', 'bas')]))!));
    expect(silhouetteKey(a)).not.toBe(silhouetteKey(b));
  });
});

describe('lib/assembly/render : source d’une tenue avec bras pliés', () => {
  const layer = (path: string) => ({ path, box: [0, 0, 10, 10] as [number, number, number, number] });
  const ARMS = {
    v: 1 as const,
    arms: layer('u/assemblage/bras/X.webp'),
    body: layer('u/assemblage/corps/X.webp'),
    sleeves: layer('u/assemblage/manches-photo/X.webp'),
    step: 5,
    from: 250,
    L: [[400, 440] as [number, number]],
    R: [null],
    sleeveL: [null],
    sleeveR: [null],
    wrist: { L: 650, R: null },
    cuff: { L: null, R: null },
  };
  const WITH_ARMS: Assembly = { v: 1, photo: base({ arms: ARMS }), sleevesPath: null };
  const urls = (id: string, sleeves = true) => ({
    arms: `https://signe.test/bras-${id}.webp`,
    body: `https://signe.test/corps-${id}.webp`,
    sleeves: sleeves ? `https://signe.test/manches-photo-${id}.webp` : null,
  });
  const armed = (id: string, category: Category, extra: Partial<SignedItem> = {}) =>
    item(id, category, { assembly: WITH_ARMS, arms_urls: urls(id), ...extra });

  it('porte les URL des couches du haut et du bas, et les compte dans la clé de cache', () => {
    const source = silhouetteSource(['h', 'b'], byId([armed('h', 'haut'), armed('b', 'bas')]))!;
    expect(source).toEqual({
      kind: 'pair',
      upper: { photo: WITH_ARMS.photo, url: 'https://signe.test/h.webp', layers: urls('h'), sleevesUrl: null },
      lower: { photo: WITH_ARMS.photo, url: 'https://signe.test/b.webp', layers: urls('b') },
    });
    expect(silhouetteUrls(source)).toEqual([
      'https://signe.test/h.webp',
      'https://signe.test/b.webp',
      ...Object.values(urls('h')),
      ...Object.values(urls('b')),
    ]);
    const resigned = silhouetteSource(['h', 'b'], byId([armed('h', 'haut'), armed('b', 'bas', { arms_urls: urls('b2') })]))!;
    expect(silhouetteKey(resigned)).not.toBe(silhouetteKey(source));
  });

  it('photo sans couche de manches : sleeves null suffit', () => {
    const photo = base({ arms: { ...ARMS, sleeves: null } });
    const top = item('h', 'haut', { assembly: { ...WITH_ARMS, photo }, arms_urls: urls('h', false) });
    const source = silhouetteSource(['h', 'b'], byId([top, armed('b', 'bas')]));
    expect(source?.kind === 'pair' && source.upper.layers).toEqual(urls('h', false));
  });

  it('une couche non signée : la photo arrive sans bras pliés (rendu d’avant), la silhouette reste', () => {
    const missing = [
      { ...urls('b'), body: null },
      { ...urls('b'), arms: null },
      { ...urls('b'), sleeves: null }, // la photo annonce des manches
      undefined,
    ];
    for (const arms_urls of missing) {
      const source = silhouetteSource(['h', 'b'], byId([armed('h', 'haut'), armed('b', 'bas', { arms_urls })]));
      expect(source?.kind).toBe('pair');
      if (source?.kind !== 'pair') continue;
      expect(source.lower).toEqual({ photo: ASSEMBLY.photo, url: 'https://signe.test/b.webp' });
      expect(source.upper.layers).toEqual(urls('h'));
    }
  });

  it('sans bras pliés, la source et sa clé sont celles de la version 1', () => {
    const today = silhouetteSource(['h', 'b'], byId([item('h', 'haut'), item('b', 'bas')]))!;
    expect(silhouetteKey(today)).toBe(
      JSON.stringify({
        kind: 'pair',
        upper: { photo: ASSEMBLY.photo, url: 'https://signe.test/h.webp', sleevesUrl: null },
        lower: { photo: ASSEMBLY.photo, url: 'https://signe.test/b.webp' },
      }),
    );
    // Des URL de couches sans données de bras ne changent rien non plus.
    const stray = silhouetteSource(['h', 'b'], byId([item('h', 'haut', { arms_urls: urls('h') }), item('b', 'bas')]))!;
    expect(silhouetteKey(stray)).toBe(silhouetteKey(today));
    // Et planRender reste le plan d'aujourd'hui : les bras pliés sont planifiés à part (arms-plan.ts).
    const withArms = silhouetteSource(['h', 'b'], byId([armed('h', 'haut'), armed('b', 'bas')]))!;
    expect(planRender(withArms)).toEqual(planRender(today));
  });
});

describe('lib/assembly/render : pièces proposées', () => {
  const all: Item[] = [item('h', 'haut'), item('b', 'bas'), item('c', 'chaussures'), item('a', 'accessoire'), item('v', 'veste')];

  it('ne propose ni chaussures ni accessoires, et les retire du plan', () => {
    const { items, plan } = drawnOutfitInputs(all, { date: '2026-10-25', item_ids: ['h', 'b', 'c', 'inconnue'], confirmed: true });
    expect(items.map((entry) => entry.id)).toEqual(['h', 'b', 'v']);
    // Une pièce inconnue (supprimée) reste : generateOutfits la remplace.
    expect(plan).toEqual({ date: '2026-10-25', item_ids: ['h', 'b', 'inconnue'], confirmed: true });
    expect(drawnOutfitInputs(all, null).plan).toBeNull();
  });

  it('reconnaît les chaussures du plan même quand elles sont au sale (liste complète à part)', () => {
    const clean = all.filter((entry) => entry.id !== 'c');
    const { plan } = drawnOutfitInputs(clean, { date: 'd', item_ids: ['h', 'c'], confirmed: true }, all);
    expect(plan?.item_ids).toEqual(['h']);
  });
});
