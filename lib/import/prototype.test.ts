import { describe, expect, it } from 'vitest';
import {
  mapPrototype,
  occasionsToStyles,
  parsePrototypeDb,
  PROTOTYPE_LIMITS,
  type PrototypeImport,
} from './prototype';

const TODAY = '2026-10-24';

function piece(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p_demo0001',
    category: 'haut',
    name: 'Pull marine',
    photo: 'pull-marine.jpg',
    cutout: 'p_demo0001-cutout.png',
    align: { dx: 0, dy: 0, scale: 1 },
    color: '#232B3E',
    warmth: 'moyen',
    rain: false,
    occasions: ['quotidien', 'detente'],
    status: 'dispo',
    createdAt: '2026-07-04T16:00:00.000Z',
    ...overrides,
  };
}

/** Extrait de db.json au format du prototype (server/db.js). */
function prototypeDb(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    settings: {
      city: { name: 'Paris', lat: 48.8566, lon: 2.3522, timezone: 'Europe/Paris' },
      split: 0.49,
      reference: 'p_demo0001',
      weatherOverride: null,
      gestures: true,
    },
    pieces: [
      piece(),
      piece({ id: 'p_demo0002', category: 'bas', name: 'Jean brut', photo: 'jean-brut.jpg', cutout: null }),
      piece({ id: 'p_demo0005', category: 'veste', name: 'Trench', photo: 'trench.jpg', cutout: null }),
    ],
    wears: [],
    plans: {},
    composites: [],
    refusals: [],
    ...overrides,
  };
}

function importOf(json: unknown, today = TODAY): PrototypeImport {
  const parsed = parsePrototypeDb(json);
  if (!parsed.ok) throw new Error(parsed.error);
  return mapPrototype(parsed.db, { today });
}

function onlyItem(overrides: Record<string, unknown>) {
  const result = importOf(prototypeDb({ pieces: [piece(overrides)] }));
  expect(result.items).toHaveLength(1);
  return result.items[0];
}

describe('parsePrototypeDb', () => {
  it("refuse ce qui n'est pas un db.json du prototype", () => {
    for (const json of [null, 'texte', [], {}, { pieces: 'non' }, { pieces: [], wears: {} }, { pieces: [], plans: [] }]) {
      expect(parsePrototypeDb(json).ok).toBe(false);
    }
  });

  it('refuse un fichier trop gros', () => {
    const pieces = Array.from({ length: PROTOTYPE_LIMITS.pieces + 1 }, (_, i) => piece({ id: `p_${i}` }));
    const parsed = parsePrototypeDb({ pieces });
    expect(parsed).toEqual({ ok: false, error: 'Ce db.json est trop gros pour être importé.' });
  });

  it('accepte un fichier ancien sans refusals ni plans (comme normalize() du prototype)', () => {
    const parsed = parsePrototypeDb({ pieces: [piece()], wears: [] });
    expect(parsed.ok).toBe(true);
  });

  it('écarte les pièces sans id lisible, de catégorie inconnue ou en double, et les compte', () => {
    const parsed = parsePrototypeDb(
      prototypeDb({
        pieces: [
          piece(),
          piece(), // doublon
          piece({ id: '../etc', name: 'Chemin' }),
          piece({ id: 'p_robe0001', category: 'robe' }),
          'pas un objet',
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.db.pieces.map((p) => p.id)).toEqual(['p_demo0001']);
    expect(parsed.ignored).toBe(4);
  });
});

describe('mapPrototype : une ligne du tableau docs/conception.md §3.1 par test', () => {
  it('pieces[].id → items.legacy_id (import rejouable)', () => {
    expect(onlyItem({ id: 'p_k3j9x0aa' }).legacy_id).toBe('p_k3j9x0aa');
  });

  it('pieces[].name → items.name (espaces nettoyés, 80 caractères au plus, nom par défaut si vide)', () => {
    expect(onlyItem({ name: '  Pull   marine ' }).name).toBe('Pull marine');
    expect(onlyItem({ name: 'x'.repeat(120) }).name).toHaveLength(80);
    expect(onlyItem({ name: '   ', category: 'bas' }).name).toBe('Bas');
  });

  it('pieces[].category (haut, veste, bas) → items.category, mêmes valeurs', () => {
    const result = importOf(
      prototypeDb({
        pieces: [
          piece({ id: 'p_1', category: 'haut' }),
          piece({ id: 'p_2', category: 'veste' }),
          piece({ id: 'p_3', category: 'bas' }),
          piece({ id: 'p_4', category: 'chaussures' }), // n'existe pas dans le prototype
        ],
      }),
    );
    expect(result.items.map((i) => i.category)).toEqual(['haut', 'veste', 'bas']);
  });

  it('pieces[].color (#RRGGBB ou null) → items.color', () => {
    expect(onlyItem({ color: '#232b3e' }).color).toBe('#232B3E');
    expect(onlyItem({ color: null }).color).toBeNull();
    expect(onlyItem({ color: 'bleu' }).color).toBeNull();
  });

  it('pieces[].warmth leger, moyen, chaud → items.warmth 1, 2, 3', () => {
    expect(onlyItem({ warmth: 'leger' }).warmth).toBe(1);
    expect(onlyItem({ warmth: 'moyen' }).warmth).toBe(2);
    expect(onlyItem({ warmth: 'chaud' }).warmth).toBe(3);
    expect(onlyItem({ warmth: undefined }).warmth).toBe(2); // défaut du prototype
  });

  it('pieces[].occasions → items.styles : quotidien et detente deviennent decontracte, sans doublon', () => {
    expect(onlyItem({ occasions: ['quotidien', 'detente'] }).styles).toEqual(['decontracte']);
    expect(onlyItem({ occasions: ['sport', 'quotidien', 'detente', 'habille'] }).styles).toEqual([
      'decontracte',
      'habille',
      'sport',
    ]);
    expect(onlyItem({ occasions: ['habille'] }).styles).toEqual(['habille']);
    expect(onlyItem({ occasions: [] }).styles).toEqual(['decontracte']);
    expect(onlyItem({ occasions: undefined }).styles).toEqual(['decontracte']);
    expect(occasionsToStyles(['inconnue'])).toEqual(['decontracte']);
  });

  it('pieces[].rain → items.rain_ok', () => {
    expect(onlyItem({ rain: true }).rain_ok).toBe(true);
    expect(onlyItem({ rain: false }).rain_ok).toBe(false);
    expect(onlyItem({ rain: 'oui' }).rain_ok).toBe(false);
  });

  it('pieces[].status → items.dirty = status différent de dispo', () => {
    expect(onlyItem({ status: 'dispo' }).dirty).toBe(false);
    expect(onlyItem({ status: 'sale' }).dirty).toBe(true);
    expect(onlyItem({ status: 'pressing' }).dirty).toBe(true);
  });

  it('pieces[].cutout → nom du fichier détouré (cutout_path après envoi), null si absent', () => {
    expect(onlyItem({ cutout: 'p_demo0001-cutout.png' }).cutout_file).toBe('p_demo0001-cutout.png');
    expect(onlyItem({ cutout: null }).cutout_file).toBeNull();
    expect(onlyItem({ cutout: undefined }).cutout_file).toBeNull();
    expect(onlyItem({ cutout: '../../secret.png' }).cutout_file).toBeNull();
  });

  it('pieces[].photo → nom de la photo portée (photo_path après envoi)', () => {
    expect(onlyItem({ photo: 'pull-marine.svg' }).photo_file).toBe('pull-marine.svg');
    expect(onlyItem({ photo: 'photos/pull.jpg' }).photo_file).toBeNull();
  });

  it('pieces[].createdAt → items.created_at', () => {
    expect(onlyItem({ createdAt: '2026-07-04T16:00:00.000Z' }).created_at).toBe('2026-07-04T16:00:00.000Z');
    expect(onlyItem({ createdAt: 'hier' }).created_at).toBeNull();
  });

  it('wears[] → outfit_history : date, pièces non nulles (veste, haut, bas), une entrée par date', () => {
    const result = importOf(
      prototypeDb({
        wears: [
          { date: '2026-09-19', haut: 'p_demo0001', veste: 'p_demo0005', bas: 'p_demo0002', occasion: 'quotidien', at: 'x' },
          { date: '2026-09-27', haut: 'p_demo0001', veste: null, bas: 'p_demo0002', occasion: 'sport' },
          { date: '2026-09-28', haut: 'p_supprime', veste: null, bas: null }, // pièce supprimée du prototype
          { date: '2026-13-01', haut: 'p_demo0001', veste: null, bas: null }, // date impossible
          { date: '2026-09-27', haut: 'p_demo0001', veste: null, bas: null }, // même date : la dernière l'emporte
        ],
      }),
    );
    expect(result.history).toEqual([
      { date: '2026-09-19', legacy_ids: ['p_demo0005', 'p_demo0001', 'p_demo0002'] },
      { date: '2026-09-27', legacy_ids: ['p_demo0001'] },
    ]);
  });

  it('refusals[] → refusals : pièces non nulles, sans doublon, écarté si une pièce manque', () => {
    const result = importOf(
      prototypeDb({
        refusals: [
          { key: 'p_demo0001|-|p_demo0002', haut: 'p_demo0001', veste: null, bas: 'p_demo0002', date: '2026-10-01' },
          { haut: 'p_demo0001', veste: null, bas: 'p_demo0002' }, // doublon
          { haut: 'p_demo0001', veste: 'p_supprime', bas: 'p_demo0002' },
          { haut: null, veste: null, bas: null },
        ],
      }),
    );
    expect(result.refusals).toEqual([{ legacy_ids: ['p_demo0001', 'p_demo0002'] }]);
  });

  it('settings.city → profile.city, lat, lon, timezone', () => {
    expect(importOf(prototypeDb()).city).toEqual({
      name: 'Paris',
      lat: 48.8566,
      lon: 2.3522,
      timezone: 'Europe/Paris',
    });
    const badZone = prototypeDb({
      settings: { city: { name: 'Lyon', lat: 45.76, lon: 4.84, timezone: 'Mars/Olympus' } },
    });
    expect(importOf(badZone).city).toBeNull();
    expect(importOf(prototypeDb({ settings: {} })).city).toBeNull();
  });

  it("plans → outfit_plans : pièces non nulles et confirmed, dates à venir seulement, aujourd'hui compris", () => {
    const result = importOf(
      prototypeDb({
        plans: {
          '2026-10-23': { haut: 'p_demo0001', veste: null, bas: 'p_demo0002', confirmed: true },
          '2026-10-24': { haut: 'p_demo0001', veste: 'p_demo0005', bas: 'p_demo0002', confirmed: true, savedAt: 'x' },
          '2026-10-25': { haut: 'p_demo0001', veste: null, bas: null, confirmed: false, occasion: 'sport' },
          '2026-10-26': { haut: null, veste: null, bas: null, confirmed: true },
          'demain': { haut: 'p_demo0001', veste: null, bas: null, confirmed: true },
        },
      }),
    );
    expect(result.plans).toEqual([
      { date: '2026-10-24', legacy_ids: ['p_demo0005', 'p_demo0001', 'p_demo0002'], confirmed: true },
      { date: '2026-10-25', legacy_ids: ['p_demo0001'], confirmed: false },
    ]);
  });

  it('ignore align, split, reference, weatherOverride, gestures et composites', () => {
    const base = importOf(prototypeDb());
    const exotic = importOf(
      prototypeDb({
        settings: {
          city: { name: 'Paris', lat: 48.8566, lon: 2.3522, timezone: 'Europe/Paris' },
          split: 0.7,
          reference: 'p_demo0002',
          weatherOverride: { temp: 30, rain: true },
          gestures: false,
        },
        pieces: prototypeDb().pieces.map((p) => ({ ...p, align: { dx: 12, dy: -4, scale: 1.4 } })),
        composites: [{ key: 'p_demo0001|-|p_demo0002', file: 'c_x.png' }],
      }),
    );
    expect(exotic).toEqual(base);
    expect(Object.keys(base).sort()).toEqual(['city', 'history', 'items', 'plans', 'refusals']);
    expect(Object.keys(base.items[0]).sort()).toEqual([
      'category',
      'color',
      'created_at',
      'cutout_file',
      'dirty',
      'legacy_id',
      'name',
      'photo_file',
      'rain_ok',
      'styles',
      'warmth',
    ]);
  });

  it('est déterministe : rejouer la conversion donne le même résultat', () => {
    const json = prototypeDb({
      wears: [{ date: '2026-10-01', haut: 'p_demo0001', veste: null, bas: 'p_demo0002' }],
    });
    expect(importOf(json)).toEqual(importOf(structuredClone(json)));
  });
});
