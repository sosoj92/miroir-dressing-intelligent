import { describe, expect, it } from 'vitest';
import { itemZone } from '@/lib/items/zone';
import type { Assembly, Item, Outfit } from '@/lib/types';
import { parseOutfitIds } from './ids';
import { buildTomorrowView, imagePaths, outfitKey, planChanges, weatherLine } from './view';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function item(n: number, extra: Partial<Item> = {}): Item {
  return {
    id: ID(n),
    name: `Pièce ${n}`,
    category: 'haut',
    color: null,
    warmth: 2,
    styles: ['decontracte'],
    rain_ok: false,
    dirty: false,
    photo_path: null,
    cutout_path: `u/items/${n}.png`,
    legacy_id: null,
    created_at: '2026-10-01T00:00:00.000Z',
    ...extra,
  };
}

function outfit(ids: number[], extra: Partial<Outfit> = {}): Outfit {
  const item_ids = ids.map(ID);
  const sorted = [...item_ids].sort();
  return { key: outfitKey(item_ids), item_ids, core_ids: sorted, drawn_ids: sorted, title: `Tenue ${ids.join('-')}`, planned: false, score: 1, ...extra };
}

const ITEMS = [1, 2, 3, 4, 5].map((n) => item(n));

const ASSEMBLY: Assembly = {
  v: 1,
  photo: {
    key: 'PHOTO_1',
    size: [1200, 1600],
    eye: [600, 390],
    centers: [[380, 610]],
    topLow: 480,
    bottomHigh: 500,
    onePiece: false,
    tucked: false,
  },
  sleevesPath: null,
};
const URLS = new Map(ITEMS.map((i) => [i.cutout_path!, `https://signe.example/${i.id}`]));
const DATE = '2026-10-25';

describe('buildTomorrowView', () => {
  it('sans tenue (generateOutfits renvoie []) : écran vide propre', () => {
    const view = buildTomorrowView({ date: DATE, weather: null, items: ITEMS, plan: null, outfits: [], urls: URLS });
    expect(view).toEqual({
      date: DATE,
      weather: null,
      planned: null,
      suggestions: [],
      planNotes: [],
      hasItems: true,
      restart: null,
    });
  });

  it('la tenue gardée passe en premier et ne revient pas dans les propositions', () => {
    const planned = outfit([1, 2], { planned: true, title: 'Tenue prévue' });
    const view = buildTomorrowView({
      date: DATE,
      weather: null,
      items: ITEMS,
      plan: { date: DATE, item_ids: [ID(1), ID(2)], confirmed: true },
      outfits: [planned, outfit([3, 4]), outfit([1, 5])],
      urls: URLS,
    });
    expect(view.planned?.title).toBe('Tenue prévue');
    expect(view.planned?.pieces.map((p) => p.cutoutUrl)).toEqual([
      `https://signe.example/${ID(1)}`,
      `https://signe.example/${ID(2)}`,
    ]);
    expect(view.suggestions.map((s) => s.title)).toEqual(['Tenue 3-4', 'Tenue 1-5']);
  });

  it('affiche la tenue gardée même si generateOutfits ne la renvoie pas (titre de secours)', () => {
    const view = buildTomorrowView({
      date: DATE,
      weather: null,
      items: [
        item(1, { name: 'Trench', category: 'veste' }),
        item(2, { name: 'Pull marine', dirty: true }),
        item(3, { name: 'Jean brut', category: 'bas' }),
      ],
      plan: { date: DATE, item_ids: [ID(1), ID(2), ID(3)], confirmed: true },
      outfits: [],
      urls: new Map(),
    });
    expect(view.planned?.title).toBe('Trench, pull marine et jean brut');
    expect(view.planned?.pieces.map((p) => p.cutoutUrl)).toEqual([null, null, null]);
    // Pièces montrées l'une sous l'autre : une ligne chacune, sans « Sous la veste ».
    expect(view.planned?.caption).toEqual({ lines: ['Trench', 'Pull marine', 'Jean brut'], note: null });
    expect(view.planNotes).toEqual(['Pull marine au sale.']);
  });

  it('une pièce prévue passée au sale : on montre la tenue remplacée, comme le miroir', () => {
    // Plan 1 + 2, la pièce 2 est au sale : generateOutfits rend 1 + 3 avec planned: true.
    const items = [
      item(1, { category: 'bas' }),
      item(2, { name: 'Pull léger beige à col rond', dirty: true }),
      item(3, { name: 'Tee-shirt noir à encolure V' }),
      item(4),
    ];
    const view = buildTomorrowView({
      date: DATE,
      weather: null,
      items,
      plan: { date: DATE, item_ids: [ID(1), ID(2)], confirmed: true },
      outfits: [outfit([3, 1], { planned: true, title: 'Tenue remplacée' }), outfit([4, 1])],
      urls: URLS,
    });
    expect(view.planned?.title).toBe('Tenue remplacée');
    expect(view.planned?.item_ids).toEqual([ID(3), ID(1)]);
    expect(view.suggestions.map((s) => s.title)).toEqual(['Tenue 4-1']);
    expect(view.planNotes).toEqual(['Pull léger beige à col rond au sale : remplacé par Tee-shirt noir à encolure V.']);
  });

  it('tenue prévue intacte : pas de note', () => {
    const view = buildTomorrowView({
      date: DATE,
      weather: null,
      items: ITEMS,
      plan: { date: DATE, item_ids: [ID(1), ID(2)], confirmed: true },
      outfits: [outfit([1, 2], { planned: true })],
      urls: URLS,
    });
    expect(view.planNotes).toEqual([]);
  });

  it("un plan non confirmé n'est pas « Prévue pour demain »", () => {
    const view = buildTomorrowView({
      date: DATE,
      weather: null,
      items: ITEMS,
      plan: { date: DATE, item_ids: [ID(1), ID(2)], confirmed: false },
      outfits: [outfit([1, 2], { planned: true })],
      urls: URLS,
    });
    expect(view.planned).toBeNull();
    expect(view.suggestions).toHaveLength(1);
    expect(view.restart).toBeNull();
  });

  it('« Recommencer le choix » : seulement s’il y a une tenue gardée ou des refus pour demain', () => {
    const base = { date: DATE, weather: null, items: ITEMS, outfits: [outfit([1, 2])], urls: URLS };
    const kept = { date: DATE, item_ids: [ID(1), ID(2)], confirmed: true };
    expect(buildTomorrowView({ ...base, plan: null }).restart).toBeNull();
    expect(buildTomorrowView({ ...base, plan: null, refusedForDay: 2 }).restart).toEqual({ hasPlan: false, refused: 2 });
    expect(buildTomorrowView({ ...base, plan: kept }).restart).toEqual({ hasPlan: true, refused: 0 });
    expect(buildTomorrowView({ ...base, plan: kept, refusedForDay: 1 }).restart).toEqual({ hasPlan: true, refused: 1 });
  });

  it('5 tenues en tout, la tenue prévue comprise', () => {
    const outfits = [[1, 2], [1, 3], [1, 4], [1, 5], [2, 3], [2, 4]].map((ids) => outfit(ids));
    const view = buildTomorrowView({ date: DATE, weather: null, items: ITEMS, plan: null, outfits, urls: URLS });
    expect(view.suggestions).toHaveLength(5);

    // generateOutfits rend la tenue prévue en tête, puis 4 autres.
    const kept = { date: DATE, item_ids: [ID(1), ID(2)], confirmed: true };
    const withPlan = buildTomorrowView({
      date: DATE,
      weather: null,
      items: ITEMS,
      plan: kept,
      outfits: [outfit([1, 2], { planned: true }), ...outfits.slice(1, 5)],
      urls: URLS,
    });
    expect(withPlan.planned).not.toBeNull();
    expect(withPlan.suggestions).toHaveLength(4);

    // Tenue prévue absente de generateOutfits (toutes ses pièces au sale) : montrée telle quelle,
    // avec 4 propositions, et non 5 de plus.
    const allDirty = buildTomorrowView({
      date: DATE,
      weather: null,
      items: [item(1, { dirty: true }), ...ITEMS.slice(1)],
      plan: { date: DATE, item_ids: [ID(1)], confirmed: true },
      outfits: [[2, 3], [2, 4], [2, 5], [3, 4], [3, 5]].map((ids) => outfit(ids)),
      urls: URLS,
    });
    expect(allDirty.planned?.item_ids).toEqual([ID(1)]);
    expect(allDirty.suggestions.map((s) => s.title)).toEqual(['Tenue 2-3', 'Tenue 2-4', 'Tenue 2-5', 'Tenue 3-4']);
  });

  it('légende : ce que montre la silhouette, la pièce cachée en note', () => {
    const items = [
      item(1, { name: 'Veste imperméable', category: 'veste', assembly: ASSEMBLY }),
      item(2, { name: 'pull en lin', category: 'haut', assembly: ASSEMBLY }),
      item(3, { name: 'Pantalon droit', category: 'bas', assembly: ASSEMBLY }),
    ];
    const view = buildTomorrowView({ date: DATE, weather: null, items, plan: null, outfits: [outfit([1, 2, 3])], urls: URLS });
    expect(view.suggestions[0].silhouette).not.toBeNull();
    expect(view.suggestions[0].caption).toEqual({
      lines: ['Veste imperméable', 'Pantalon droit'],
      note: 'Sous la veste : pull en lin',
    });
    // Sans silhouette : une ligne par pièce, sans note.
    const stacked = buildTomorrowView({
      date: DATE,
      weather: null,
      items,
      plan: null,
      outfits: [outfit([1, 2, 3])],
      urls: new Map(),
    });
    expect(stacked.suggestions[0].caption).toEqual({
      lines: ['Veste imperméable', 'Pull en lin', 'Pantalon droit'],
      note: null,
    });
  });

  it('montre la silhouette assemblée quand toutes les pièces ont une photo portée signée', () => {
    const items = [
      item(1, { category: 'veste', assembly: { ...ASSEMBLY, sleevesPath: 'u/manches/1.webp' } }),
      item(2, { category: 'bas', assembly: ASSEMBLY }),
      item(3, { category: 'bas' }),
    ];
    const urls = new Map([
      ['u/items/1.png', 'https://signe.example/1'],
      ['u/items/2.png', 'https://signe.example/2'],
      ['u/items/3.png', 'https://signe.example/3'],
      ['u/manches/1.webp', 'https://signe.example/manches-1'],
    ]);
    const view = buildTomorrowView({
      date: DATE,
      weather: null,
      items,
      plan: null,
      outfits: [outfit([1, 2]), outfit([1, 3])],
      urls,
    });
    expect(view.suggestions[0].silhouette).toEqual({
      kind: 'pair',
      upper: { photo: ASSEMBLY.photo, url: 'https://signe.example/1', sleevesUrl: 'https://signe.example/manches-1' },
      lower: { photo: ASSEMBLY.photo, url: 'https://signe.example/2' },
    });
    // Un bas sans photo portée : aperçu pièce par pièce.
    expect(view.suggestions[1].silhouette).toBeNull();
    expect(view.suggestions[1].pieces.map((p) => p.cutoutUrl)).toEqual(['https://signe.example/1', 'https://signe.example/3']);
    // La veste photographiée portée n'y montre que sa zone, pas la personne entière.
    expect(view.suggestions[1].pieces.map((p) => p.zone)).toEqual([
      { zone: itemZone('veste', ASSEMBLY.photo), size: [1200, 1600] },
      null,
    ]);
  });

  it('bras pliés : la silhouette porte les URL signées des couches du haut et du bas', () => {
    const layer = (path: string) => ({ path, box: [0, 0, 10, 10] as [number, number, number, number] });
    const arms = (key: string, sleeves: boolean) => ({
      v: 1 as const,
      arms: layer(`u/assemblage/bras/${key}.webp`),
      body: layer(`u/assemblage/corps/${key}.webp`),
      sleeves: sleeves ? layer(`u/assemblage/manches-photo/${key}.webp`) : null,
      step: 5,
      from: 250,
      L: [null],
      R: [null],
      sleeveL: [null],
      sleeveR: [null],
      wrist: { L: null, R: null },
      cuff: { L: null, R: null },
    });
    const upper: Assembly = { ...ASSEMBLY, photo: { ...ASSEMBLY.photo, key: 'PHOTO_1', arms: arms('PHOTO_1', true) } };
    const lower: Assembly = { ...ASSEMBLY, photo: { ...ASSEMBLY.photo, key: 'PHOTO_2', arms: arms('PHOTO_2', false) } };
    const items = [item(1, { category: 'haut', assembly: upper }), item(2, { category: 'bas', assembly: lower })];
    const signed = (path: string) => `https://signe.example/${path}`;
    const paths = imagePaths(items, [ID(1), ID(2)]);
    expect(paths).toEqual([
      'u/items/1.png',
      'u/assemblage/bras/PHOTO_1.webp',
      'u/assemblage/corps/PHOTO_1.webp',
      'u/assemblage/manches-photo/PHOTO_1.webp',
      'u/items/2.png',
      'u/assemblage/bras/PHOTO_2.webp',
      'u/assemblage/corps/PHOTO_2.webp',
    ]);
    const view = buildTomorrowView({
      date: DATE,
      weather: null,
      items,
      plan: null,
      outfits: [outfit([1, 2])],
      urls: new Map(paths.map((path) => [path, signed(path)])),
    });
    expect(view.suggestions[0].silhouette).toEqual({
      kind: 'pair',
      upper: {
        photo: upper.photo,
        url: signed('u/items/1.png'),
        layers: {
          arms: signed('u/assemblage/bras/PHOTO_1.webp'),
          body: signed('u/assemblage/corps/PHOTO_1.webp'),
          sleeves: signed('u/assemblage/manches-photo/PHOTO_1.webp'),
        },
        sleevesUrl: null,
      },
      lower: {
        photo: lower.photo,
        url: signed('u/items/2.png'),
        layers: { arms: signed('u/assemblage/bras/PHOTO_2.webp'), body: signed('u/assemblage/corps/PHOTO_2.webp'), sleeves: null },
      },
    });

    // Couche du bas non signée : le bas se dessine sans bras pliés, comme avant.
    const partial = new Map(paths.filter((path) => !path.includes('corps/PHOTO_2')).map((path) => [path, signed(path)]));
    const fallback = buildTomorrowView({ date: DATE, weather: null, items, plan: null, outfits: [outfit([1, 2])], urls: partial });
    const source = fallback.suggestions[0].silhouette;
    expect(source?.kind === 'pair' && source.lower).toEqual({
      photo: { ...ASSEMBLY.photo, key: 'PHOTO_2' },
      url: signed('u/items/2.png'),
    });
    expect(source?.kind === 'pair' && source.upper.layers?.body).toBe(signed('u/assemblage/corps/PHOTO_1.webp'));
  });

  it('sans URL signée (signature en panne), pas de silhouette', () => {
    const items = [item(1, { category: 'haut', assembly: ASSEMBLY }), item(2, { category: 'bas', assembly: ASSEMBLY })];
    const view = buildTomorrowView({ date: DATE, weather: null, items, plan: null, outfits: [outfit([1, 2])], urls: new Map() });
    expect(view.suggestions[0].silhouette).toBeNull();
    expect(view.suggestions[0].pieces.map((p) => p.cutoutUrl)).toEqual([null, null]);
  });

  it('garde-robe vide', () => {
    const view = buildTomorrowView({ date: DATE, weather: null, items: [], plan: null, outfits: [], urls: URLS });
    expect(view.hasItems).toBe(false);
  });
});

describe('planChanges', () => {
  const pieces = new Map(
    [
      item(1, { name: 'Pull en lin', dirty: true }),
      item(2, { name: 'Chemise blanche' }),
      item(3, { name: 'Jean brut', category: 'bas' }),
      item(4, { name: 'Veste en jean', category: 'veste', dirty: true }),
      item(5, { name: 'Trench', category: 'veste' }),
      item(6, { name: 'Robe noire', category: 'robe', dirty: true }),
      item(7, { name: 'Pull marine' }),
      item(8, { name: 'Jupe plissée', category: 'bas', dirty: true }),
      item(9, { name: 'Robe longue', category: 'robe' }),
    ].map((piece) => [piece.id, piece]),
  );

  it('une pièce au sale remplacée par une pièce de sa catégorie', () => {
    expect(planChanges([ID(1), ID(3)], [ID(2), ID(3)], pieces)).toEqual(['Pull en lin au sale : remplacé par Chemise blanche.']);
  });

  it('une phrase par pièce, dans l’ordre du plan', () => {
    expect(planChanges([ID(4), ID(1), ID(3)], [ID(5), ID(2), ID(3)], pieces)).toEqual([
      'Veste en jean au sale : remplacé par Trench.',
      'Pull en lin au sale : remplacé par Chemise blanche.',
    ]);
  });

  it('sans remplaçante (veste plus nécessaire) : seulement « au sale »', () => {
    expect(planChanges([ID(4), ID(2), ID(3)], [ID(2), ID(3)], pieces)).toEqual(['Veste en jean au sale.']);
  });

  it('une robe remplacée par un haut et un bas, et inversement', () => {
    expect(planChanges([ID(6)], [ID(7), ID(3)], pieces)).toEqual(['Robe noire au sale : remplacé par Pull marine et jean brut.']);
    expect(planChanges([ID(1), ID(8)], [ID(9)], pieces)).toEqual([
      'Pull en lin et jupe plissée au sale : remplacés par Robe longue.',
    ]);
  });

  it('tenue montrée telle quelle (aucune remplaçante) : chaque pièce au sale est citée', () => {
    expect(planChanges([ID(6)], [ID(6)], pieces)).toEqual(['Robe noire au sale.']);
  });

  it('pièce supprimée, pièce propre ou veste ajoutée : rien à dire', () => {
    expect(planChanges([ID(99), ID(3)], [ID(2), ID(3)], pieces)).toEqual([]);
    expect(planChanges([ID(2), ID(3)], [ID(5), ID(2), ID(3)], pieces)).toEqual([]);
  });
});

describe('aides', () => {
  it('imagePaths ne signe que les pièces affichées : détourages et manches', () => {
    const items = [
      item(1),
      item(2, { cutout_path: null }),
      item(3),
      item(4, { assembly: { ...ASSEMBLY, sleevesPath: 'u/manches/4.webp' } }),
    ];
    expect(imagePaths(items, [ID(1), ID(2), ID(4)])).toEqual(['u/items/1.png', 'u/items/4.png', 'u/manches/4.webp']);
  });

  it('weatherLine', () => {
    expect(
      weatherLine({ date: DATE, tempMin: 8.6, tempMax: 15.2, temp: 12, code: 61, rain: true, label: 'Pluie' }),
    ).toBe('Pluie · 9° à 15°');
  });

  it('parseOutfitIds : uuid, sans doublon, 6 au plus', () => {
    expect(parseOutfitIds([ID(1).toUpperCase(), ID(2)])).toEqual([ID(1), ID(2)]);
    expect(parseOutfitIds([])).toBeNull();
    expect(parseOutfitIds([ID(1), ID(1)])).toBeNull();
    expect(parseOutfitIds(['p_demo0001'])).toBeNull();
    expect(parseOutfitIds([1])).toBeNull();
    expect(parseOutfitIds('x')).toBeNull();
    expect(parseOutfitIds([1, 2, 3, 4, 5, 6, 7].map(ID))).toBeNull();
  });
});
