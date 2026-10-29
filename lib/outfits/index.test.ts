import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Category, DayWeather, HistoryEntry, Item, Outfit, OutfitContext, Plan, Refusal } from '@/lib/types';
import { MAX_OUTFITS, coreIdsOf, generateOutfits, outfitKeyOf } from './index';
import { MAX_SAME_TOP, RECENT_PAIR_DAYS } from './score';

// ---------- Fabriques ----------

const DATE = '2026-10-24';

function item(id: string, category: Category, extra: Partial<Item> = {}): Item {
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
    cutout_path: null,
    legacy_id: null,
    created_at: '2026-10-01T08:00:00.000Z',
    ...extra,
  };
}

/** Matin 3 °C sous le maximum. */
function weather(temp: number, rain = false): DayWeather {
  return { date: DATE, tempMin: temp - 3, tempMax: temp, temp, code: rain ? 61 : 3, rain, label: '' };
}

const HOT = weather(26); // chaleur visée 1, pas de veste
const MILD = weather(16); // chaleur visée 2, pas de veste (≥ 15 °C, matin à 13 °C)
const COOL = weather(12); // chaleur visée 2, veste (chaleur 3 pour le matin à 9 °C)
const COLD = weather(6); // chaleur visée 3, veste
const RAINY = weather(16, true); // chaleur visée 2, veste pour la pluie

function context(extra: Partial<OutfitContext> = {}): OutfitContext {
  return { date: DATE, weather: MILD, history: [], refusals: [], plan: null, ...extra };
}

function worn(date: string, ...item_ids: string[]): HistoryEntry {
  return { date, item_ids, title: null };
}

function daysBefore(n: number, date = DATE): string {
  const ms = Date.parse(`${date}T12:00:00Z`) - n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function plan(item_ids: string[], date = DATE): Plan {
  return { date, item_ids, confirmed: true };
}

function refusal(...item_ids: string[]): Refusal {
  return { item_ids: [...item_ids].sort() };
}

/** Garde-robe du prototype : hauts, bas et vestes seulement (ni chaussures ni robes). */
function prototypeWardrobe(): Item[] {
  return [
    item('pull-chaud', 'haut', { name: 'Pull chaud', warmth: 3 }),
    item('chemise', 'haut', { name: 'Chemise', warmth: 2 }),
    item('tshirt', 'haut', { name: 'T-shirt', warmth: 1 }),
    item('jean', 'bas', { name: 'Jean brut', warmth: 2 }),
    item('short', 'bas', { name: 'Short', warmth: 1 }),
    item('trench', 'veste', { name: 'Trench', warmth: 2, rain_ok: true }),
    item('veste-jean', 'veste', { name: 'Veste en jean', warmth: 2 }),
    item('doudoune', 'veste', { name: 'Doudoune', warmth: 3 }),
  ];
}

/** Garde-robe complète : celle du prototype, plus des chaussures. */
function wardrobe(): Item[] {
  return [
    ...prototypeWardrobe(),
    item('baskets', 'chaussures', { name: 'Baskets blanches', warmth: 2 }),
    item('bottines', 'chaussures', { name: 'Bottines', warmth: 3, rain_ok: true }),
  ];
}

const byId = (items: Item[]) => new Map(items.map((piece) => [piece.id, piece]));

function categoriesOf(outfit: Outfit, items: Item[]): Category[] {
  const map = byId(items);
  return outfit.item_ids.map((id) => map.get(id)!.category);
}

function pieceOf(outfit: Outfit, category: Category, items: Item[]): string | undefined {
  const map = byId(items);
  return outfit.item_ids.find((id) => map.get(id)!.category === category);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------- Tests ----------

describe('generateOutfits : nombre de tenues', () => {
  it('renvoie [] pour une garde-robe vide', () => {
    expect(generateOutfits([], context())).toEqual([]);
  });

  it('renvoie [] quand toutes les pièces sont au sale', () => {
    const dirty = wardrobe().map((piece) => ({ ...piece, dirty: true }));
    expect(generateOutfits(dirty, context({ weather: COLD }))).toEqual([]);
  });

  it('ne propose jamais une veste, des chaussures ou un accessoire sans pièce principale', () => {
    const items = [item('v', 'veste'), item('s', 'chaussures'), item('a', 'accessoire')];
    expect(generateOutfits(items, context({ weather: COLD }))).toEqual([]);
  });

  it('propose au plus MAX_OUTFITS tenues, toutes distinctes', () => {
    expect(MAX_OUTFITS).toBe(5);
    const items = [
      ...['h1', 'h2', 'h3', 'h4'].map((id) => item(id, 'haut')),
      ...['b1', 'b2', 'b3'].map((id) => item(id, 'bas')),
    ];
    const outfits = generateOutfits(items, context());
    expect(outfits).toHaveLength(5);
    expect(new Set(outfits.map((outfit) => outfit.key)).size).toBe(5);
  });

  it('propose toutes les combinaisons quand il y en a moins de 5', () => {
    const items = [item('h1', 'haut'), item('h2', 'haut'), item('b1', 'bas')];
    expect(generateOutfits(items, context()).map((outfit) => outfit.key).sort()).toEqual(['b1+h1', 'b1+h2']);
    const withDress = [...items, item('r1', 'robe')];
    expect(generateOutfits(withDress, context())).toHaveLength(3);
  });

  it('classe les tenues de la meilleure à la moins bonne (score décroissant)', () => {
    for (const day of [HOT, MILD, COOL, COLD, RAINY]) {
      const outfits = generateOutfits(wardrobe(), context({ weather: day }));
      expect(outfits.length).toBeGreaterThan(1);
      for (let i = 1; i < outfits.length; i++) expect(outfits[i - 1].score).toBeGreaterThanOrEqual(outfits[i].score);
    }
  });
});

describe('generateOutfits : composition d’une tenue', () => {
  it('haut + bas + chaussures, sans veste à 15 °C et plus quand il ne pleut pas', () => {
    const items = wardrobe();
    for (const outfit of generateOutfits(items, context({ weather: weather(15) }))) {
      expect(categoriesOf(outfit, items)).toEqual(['haut', 'bas', 'chaussures']);
    }
  });

  it('ajoute une veste sous 15 °C', () => {
    const items = wardrobe();
    for (const outfit of generateOutfits(items, context({ weather: weather(14) }))) {
      expect(categoriesOf(outfit, items)).toEqual(['veste', 'haut', 'bas', 'chaussures']);
    }
  });

  it('ajoute une veste quand il pleut, même s’il fait chaud', () => {
    const items = wardrobe();
    const outfits = generateOutfits(items, context({ weather: weather(26, true) }));
    expect(outfits.every((outfit) => pieceOf(outfit, 'veste', items))).toBe(true);
    expect(pieceOf(outfits[0], 'veste', items)).toBe('trench');
  });

  it('propose une robe avec ses chaussures, à la place du haut et du bas', () => {
    const items = [item('robe', 'robe', { name: 'Robe rouge' }), item('ballerines', 'chaussures')];
    const [outfit] = generateOutfits(items, context());
    expect(outfit.item_ids).toEqual(['robe', 'ballerines']);
    expect(outfit.title).toBe('Robe rouge');
  });

  it('accepte la garde-robe du prototype, sans chaussures ni robes', () => {
    const items = prototypeWardrobe();
    const outfits = generateOutfits(items, context({ weather: COLD }));
    expect(outfits).toHaveLength(5);
    for (const outfit of outfits) expect(categoriesOf(outfit, items)).toEqual(['veste', 'haut', 'bas']);
    expect(outfits[0].item_ids).toEqual(['doudoune', 'pull-chaud', 'jean']);
  });

  it('se passe de veste quand il en faudrait une mais qu’aucune n’est disponible', () => {
    const items = wardrobe().map((piece) => (piece.category === 'veste' ? { ...piece, dirty: true } : piece));
    const outfits = generateOutfits(items, context({ weather: RAINY }));
    expect(outfits.length).toBeGreaterThan(0);
    for (const outfit of outfits) expect(categoriesOf(outfit, items)).toEqual(['haut', 'bas', 'chaussures']);
  });

  it('ne propose jamais un haut sans bas ni un bas sans haut (docs/conception.md §6) : seulement la robe', () => {
    const items = [item('h1', 'haut'), item('b1', 'bas', { dirty: true }), item('r1', 'robe')];
    expect(generateOutfits(items, context()).map((outfit) => outfit.key)).toEqual(['r1']);
    const topsOnly = [item('h1', 'haut'), item('h2', 'haut'), item('s1', 'chaussures'), item('v1', 'veste')];
    expect(generateOutfits(topsOnly, context({ weather: COLD }))).toEqual([]);
    const bottomsOnly = [item('b1', 'bas'), item('s1', 'chaussures')];
    expect(generateOutfits(bottomsOnly, context())).toEqual([]);
  });

  it('ajoute un accessoire seulement s’il convient', () => {
    const base = [item('h', 'haut', { warmth: 1 }), item('b', 'bas', { warmth: 1 })];
    const sunglasses = item('lunettes', 'accessoire', { warmth: 1 });
    const scarf = item('echarpe', 'accessoire', { warmth: 3 });
    expect(generateOutfits([...base, sunglasses], context({ weather: HOT }))[0].item_ids).toContain('lunettes');
    expect(generateOutfits([...base, scarf], context({ weather: HOT }))[0].item_ids).not.toContain('echarpe');
    // Porté la veille, l'accessoire n'est plus ajouté.
    const history = [worn(daysBefore(1), 'lunettes')];
    expect(generateOutfits([...base, sunglasses], context({ weather: HOT, history }))[0].item_ids).not.toContain('lunettes');
  });

  it('n’utilise pas les styles pour filtrer : le choix de l’occasion n’est pas tranché', () => {
    const items = [
      item('h-sport', 'haut', { styles: ['sport'] }),
      item('h-habille', 'haut', { styles: ['habille'] }),
      item('b-decontracte', 'bas', { styles: ['decontracte'] }),
    ];
    expect(generateOutfits(items, context())).toHaveLength(2);
  });
});

describe('generateOutfits : format', () => {
  const items = [
    item('v1', 'veste', { name: 'Trench' }),
    item('h1', 'haut', { name: 'Pull marine' }),
    item('b1', 'bas', { name: 'Jean brut' }),
    item('s1', 'chaussures', { name: 'Baskets' }),
    item('a1', 'accessoire', { name: 'Ceinture' }),
  ];

  it('range les pièces dans l’ordre d’affichage et calcule la clé et le cœur', () => {
    const [outfit] = generateOutfits([...items].reverse(), context({ weather: COOL }));
    expect(outfit).toMatchObject({
      key: 'a1+b1+h1+s1+v1',
      item_ids: ['v1', 'h1', 'b1', 's1', 'a1'],
      core_ids: ['b1', 'h1', 'v1'],
      planned: false,
    });
    expect(typeof outfit.score).toBe('number');
    expect(outfit.key).toBe(outfitKeyOf(outfit.item_ids));
  });

  it('donne un titre simple avec le haut, le bas puis la veste', () => {
    expect(generateOutfits(items, context({ weather: COOL }))[0].title).toBe('Pull marine, jean brut et trench');
    expect(generateOutfits(items, context({ weather: MILD }))[0].title).toBe('Pull marine et jean brut');
  });
});

describe('generateOutfits : critères', () => {
  it('choisit des pièces légères quand il fait chaud et chaudes quand il fait froid', () => {
    const items = wardrobe();
    expect(generateOutfits(items, context({ weather: HOT }))[0].item_ids).toEqual(['tshirt', 'short', 'baskets']);
    expect(generateOutfits(items, context({ weather: COLD }))[0].item_ids).toEqual([
      'doudoune',
      'pull-chaud',
      'jean',
      'bottines',
    ]);
  });

  it('préfère une veste ok pluie quand il pleut', () => {
    const items = wardrobe();
    const outfits = generateOutfits(items, context({ weather: RAINY }));
    expect(outfits[0].item_ids).toEqual(['trench', 'chemise', 'jean', 'bottines']);
    // Sans pluie, le trench n'a plus d'avantage : la veste suit le froid du matin (9 °C : la plus chaude).
    const dry = generateOutfits(items, context({ weather: COOL }));
    expect(dry[0].item_ids[0]).toBe('doudoune');
  });

  it('préfère des chaussures ok pluie quand il pleut', () => {
    const items = [
      item('h', 'haut'),
      item('b', 'bas'),
      item('toile', 'chaussures', { warmth: 2 }),
      item('bottes', 'chaussures', { warmth: 1, rain_ok: true }),
    ];
    expect(generateOutfits(items, context({ weather: MILD }))[0].item_ids).toContain('toile');
    expect(generateOutfits(items, context({ weather: RAINY }))[0].item_ids).toContain('bottes');
  });

  it('pénalise fortement une pièce portée ces 3 derniers jours', () => {
    const items = [item('parfait', 'haut', { warmth: 2 }), item('voisin', 'haut', { warmth: 1 }), item('b', 'bas')];
    expect(pieceOf(generateOutfits(items, context())[0], 'haut', items)).toBe('parfait');
    for (const days of [1, 2, 3]) {
      const history = [worn(daysBefore(days), 'parfait')];
      expect(pieceOf(generateOutfits(items, context({ history }))[0], 'haut', items), `${days} j`).toBe('voisin');
    }
    // Il y a 4 jours : plus de pénalité.
    const old = [worn(daysBefore(4), 'parfait')];
    expect(generateOutfits(items, context({ history: old }))).toEqual(generateOutfits(items, context()));
  });

  it('compare l’historique à la date visée, pas au jour réel', () => {
    const items = [item('parfait', 'haut', { warmth: 2 }), item('voisin', 'haut', { warmth: 1 }), item('b', 'bas')];
    const target = '2031-03-10';
    const history = [worn('2031-03-09', 'parfait')];
    const outfits = generateOutfits(items, context({ date: target, weather: { ...MILD, date: target }, history }));
    expect(pieceOf(outfits[0], 'haut', items)).toBe('voisin');
  });

  it('ignore ce qui a été porté le jour visé ou après', () => {
    const items = wardrobe();
    const base = generateOutfits(items, context());
    const first = base[0].item_ids;
    const history = [worn(DATE, ...first), worn('2026-10-25', ...first)];
    expect(generateOutfits(items, context({ history }))).toEqual(base);
  });

  it('pénalise le même duo haut + bas porté ces 14 derniers jours', () => {
    const items = [item('h1', 'haut'), item('b-match', 'bas', { warmth: 2 }), item('b-other', 'bas', { warmth: 3 })];
    const top = (history: HistoryEntry[]) => generateOutfits(items, context({ history }))[0].key;
    expect(top([])).toBe('b-match+h1');
    expect(top([worn(daysBefore(5), 'h1', 'b-match')])).toBe('b-other+h1');
    expect(top([worn(daysBefore(RECENT_PAIR_DAYS), 'h1', 'b-match')])).toBe('b-other+h1');
    expect(top([worn(daysBefore(RECENT_PAIR_DAYS + 1), 'h1', 'b-match')])).toBe('b-match+h1');
  });

  it('évite deux couleurs vives qui jurent, et associe les neutres à tout', () => {
    const items = [
      item('rouge', 'haut', { color: '#D62828' }),
      item('vert', 'bas', { color: '#2A9D3A' }),
      item('gris', 'bas', { color: '#808080' }),
    ];
    const outfits = generateOutfits(items, context());
    expect(outfits.map((outfit) => outfit.key)).toEqual(['gris+rouge', 'rouge+vert']);
    expect(outfits[0].score - outfits[1].score).toBeGreaterThanOrEqual(2);
  });

  it('accorde aussi les chaussures aux couleurs de la tenue', () => {
    const items = [
      item('h', 'haut', { color: '#D62828' }),
      item('b', 'bas', { color: '#1F2A44' }),
      item('vertes', 'chaussures', { color: '#2A9D3A' }),
      item('noires', 'chaussures', { color: '#111111' }),
    ];
    expect(generateOutfits(items, context())[0].item_ids).toEqual(['h', 'b', 'noires']);
  });
});

describe('generateOutfits : refus', () => {
  it('un refus sans veste bloque haut + bas sans veste, mais pas avec une veste', () => {
    const items = [item('h', 'haut'), item('b', 'bas'), item('v', 'veste')];
    const refusals = [refusal('h', 'b')];
    expect(generateOutfits(items, context({ weather: MILD, refusals }))).toEqual([]);
    expect(generateOutfits(items, context({ weather: COOL, refusals })).map((outfit) => outfit.key)).toEqual(['b+h+v']);
  });

  it('un refus avec veste ne bloque que cette veste', () => {
    const items = [item('h', 'haut'), item('b', 'bas'), item('v1', 'veste'), item('v2', 'veste')];
    const refusals = [refusal('h', 'b', 'v1')];
    expect(generateOutfits(items, context({ weather: COOL, refusals })).map((outfit) => outfit.key)).toEqual(['b+h+v2']);
    expect(generateOutfits(items, context({ weather: MILD, refusals })).map((outfit) => outfit.key)).toEqual(['b+h']);
  });

  it('un refus de ce qu’on voit (veste + bas) écarte cette image avec tous les hauts cachés dessous', () => {
    const items = [item('h1', 'haut'), item('h2', 'haut'), item('b1', 'bas'), item('b2', 'bas'), item('v', 'veste')];
    const outfits = generateOutfits(items, context({ weather: COOL, refusals: [refusal('v', 'b1')] }));
    expect(outfits.length).toBeGreaterThan(0);
    expect(outfits.every((outfit) => !(outfit.item_ids.includes('v') && outfit.item_ids.includes('b1')))).toBe(true);
    expect(outfits.every((outfit) => outfit.drawn_ids.join('+') === 'b2+v')).toBe(true);
  });

  it('donne drawn_ids : la robe seule, sinon la veste (ou le haut) et le bas', () => {
    const items = [item('h', 'haut'), item('b', 'bas'), item('v', 'veste'), item('r', 'robe')];
    const outfits = generateOutfits(items, context({ weather: COOL }));
    const byKey = new Map(outfits.map((outfit) => [outfit.key, outfit.drawn_ids]));
    expect(byKey.get('b+h+v')).toEqual(['b', 'v']);
    expect(byKey.get('r+v')).toEqual(['r']);
  });

  it('ne tient pas compte des chaussures ni de l’accessoire', () => {
    const items = [item('h', 'haut'), item('b', 'bas'), item('s1', 'chaussures'), item('s2', 'chaussures')];
    expect(generateOutfits(items, context({ refusals: [refusal('b', 'h')] }))).toEqual([]);
  });

  it('retrouve un refus enregistré dans le désordre', () => {
    const items = [item('h', 'haut'), item('b1', 'bas'), item('b2', 'bas')];
    const refusals = [{ item_ids: ['h', 'b1'] }];
    expect(generateOutfits(items, context({ refusals })).map((outfit) => outfit.key)).toEqual(['b2+h']);
  });

  it('écarte la meilleure tenue refusée et fait remonter la suivante', () => {
    const items = [item('h1', 'haut', { warmth: 2 }), item('h2', 'haut', { warmth: 1 }), item('b', 'bas')];
    expect(generateOutfits(items, context()).map((outfit) => outfit.key)).toEqual(['b+h1', 'b+h2']);
    expect(generateOutfits(items, context({ refusals: [refusal('h1', 'b')] })).map((outfit) => outfit.key)).toEqual([
      'b+h2',
    ]);

    const full = wardrobe();
    const outfits = generateOutfits(full, context({ weather: COLD }));
    const refused = generateOutfits(full, context({ weather: COLD, refusals: [{ item_ids: outfits[0].core_ids }] }));
    expect(refused).toHaveLength(5);
    expect(refused.some((outfit) => outfit.core_ids.join() === outfits[0].core_ids.join())).toBe(false);
  });

  it('ignore les refus mal formés', () => {
    const items = wardrobe();
    const junk = [null, {}, { item_ids: 'h' }, { item_ids: [] }] as unknown as Refusal[];
    expect(generateOutfits(items, context({ refusals: junk }))).toEqual(generateOutfits(items, context()));
  });
});

describe('generateOutfits : variété', () => {
  it(`ne propose pas plus de ${MAX_SAME_TOP} fois le même haut si un autre existe`, () => {
    const items = [
      item('h-ideal', 'haut', { warmth: 3 }),
      item('h-autre', 'haut', { warmth: 1 }),
      ...['b1', 'b2', 'b3', 'b4', 'b5'].map((id) => item(id, 'bas', { warmth: 3 })),
    ];
    // Même portée hier et trop légère, l'autre pièce passe avant une 4e fois le même haut.
    const history = [worn(daysBefore(1), 'h-autre')];
    const outfits = generateOutfits(items, context({ weather: COLD, history }));
    expect(outfits).toHaveLength(5);
    const tops = outfits.map((outfit) => pieceOf(outfit, 'haut', items));
    expect(tops.filter((id) => id === 'h-ideal')).toHaveLength(MAX_SAME_TOP);
    expect(tops.slice(0, MAX_SAME_TOP)).toEqual(['h-ideal', 'h-ideal', 'h-ideal']);
  });

  it(`pluie, une seule veste ok pluie : elle n'est montrée que dans ${MAX_SAME_TOP} tenues au plus`, () => {
    const items = [
      ...['h1', 'h2', 'h3', 'h4', 'h5'].map((id) => item(id, 'haut', { warmth: 1 })),
      ...['b1', 'b2', 'b3', 'b4', 'b5'].map((id) => item(id, 'bas')),
      item('coupe-vent', 'veste', { warmth: 1, rain_ok: true }),
      item('sweat', 'veste', { warmth: 2 }),
      item('survet', 'veste', { warmth: 2 }),
    ];
    const rain = { ...weather(14, true), tempMin: 9 };
    const outfits = generateOutfits(items, context({ weather: rain }));
    expect(outfits).toHaveLength(MAX_OUTFITS);
    expect(outfits[0].item_ids).toContain('coupe-vent');
    expect(outfits.filter((outfit) => outfit.item_ids.includes('coupe-vent')).length).toBeLessThanOrEqual(MAX_SAME_TOP);
  });

  it('jamais deux fois la même image (même veste visible et même bas) tant qu’une autre existe', () => {
    // Une seule veste et un seul bas : les tenues ne diffèrent que par le haut caché.
    const items = [
      ...['h1', 'h2', 'h3'].map((id) => item(id, 'haut')),
      item('b1', 'bas'),
      item('b2', 'bas', { warmth: 1 }),
      item('v', 'veste'),
    ];
    const outfits = generateOutfits(items, context({ weather: COOL }));
    const images = outfits.map((outfit) => outfit.item_ids.filter((id) => id === 'v' || id.startsWith('b')).join('+'));
    // Deux images possibles (v + b1, v + b2) : elles passent avant toute répétition.
    expect(new Set(images.slice(0, 2)).size).toBe(2);
    // Puis, faute d'autre image, les répétitions restent possibles.
    expect(outfits).toHaveLength(MAX_OUTFITS);
  });

  it('un matin froid et sec (8–16 °C) apporte une veste, pas un jour chaud (14–27 °C)', () => {
    const items = [item('h', 'haut', { warmth: 1 }), item('b', 'bas'), item('v', 'veste')];
    expect(generateOutfits(items, context({ weather: { ...weather(16), tempMin: 8 } }))[0].item_ids).toContain('v');
    expect(generateOutfits(items, context({ weather: { ...weather(27), tempMin: 14 } }))[0].item_ids).not.toContain('v');
  });

  it('la veste suit le matin : 11–19 °C choisit une veste moyenne, pas la plus chaude', () => {
    const items = [
      item('h', 'haut', { warmth: 1 }),
      item('b', 'bas'),
      item('legere', 'veste', { warmth: 1 }),
      item('moyenne', 'veste', { warmth: 2 }),
      item('chaude', 'veste', { warmth: 3 }),
    ];
    const outfits = generateOutfits(items, context({ weather: { ...weather(19), tempMin: 11 } }));
    expect(outfits[0].item_ids[0]).toBe('moyenne');
  });

  it('répète le haut quand il n’y en a qu’un', () => {
    const items = [item('h', 'haut'), ...['b1', 'b2', 'b3', 'b4', 'b5'].map((id) => item(id, 'bas'))];
    const outfits = generateOutfits(items, context());
    expect(outfits).toHaveLength(5);
    expect(outfits.every((outfit) => outfit.item_ids.includes('h'))).toBe(true);
  });

  it('alterne les hauts quand ils se valent', () => {
    const items = [
      ...['h1', 'h2', 'h3'].map((id) => item(id, 'haut')),
      ...['b1', 'b2'].map((id) => item(id, 'bas')),
    ];
    const tops = generateOutfits(items, context()).map((outfit) => pieceOf(outfit, 'haut', items));
    expect(new Set(tops.slice(0, 3)).size).toBe(3);
  });
});

describe('generateOutfits : déterminisme', () => {
  const history = [worn(daysBefore(2), 'chemise', 'jean', 'trench'), worn(daysBefore(6), 'tshirt', 'short')];
  const refusals = [refusal('pull-chaud', 'jean', 'doudoune')];

  it('donne le même résultat pour les mêmes entrées, quel que soit leur ordre', () => {
    const a = generateOutfits(wardrobe(), context({ weather: RAINY, history, refusals }));
    const b = generateOutfits(
      [...wardrobe()].reverse(),
      context({ weather: RAINY, history: [...history].reverse(), refusals: [...refusals].reverse() }),
    );
    expect(b).toEqual(a);
    expect(generateOutfits(wardrobe(), context({ weather: RAINY, history, refusals }))).toEqual(a);
  });

  it('n’utilise ni le hasard ni l’horloge', () => {
    const random = vi.spyOn(Math, 'random');
    const now = vi.spyOn(Date, 'now');
    generateOutfits(wardrobe(), context({ weather: COLD, history, refusals, plan: plan(['tshirt', 'jean']) }));
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it('départage les égalités avec une graine tirée de la date, qui change d’un jour à l’autre', () => {
    const items = [...['a', 'b', 'c', 'd', 'e'].map((id) => item(`h-${id}`, 'haut')), item('b', 'bas')];
    const firsts = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const date = daysBefore(-i);
      const first = generateOutfits(items, context({ date, weather: { ...MILD, date } }))[0];
      expect(generateOutfits(items, context({ date, weather: { ...MILD, date } }))[0]).toEqual(first);
      firsts.add(first.key);
    }
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('ne modifie pas ses entrées', () => {
    const items = wardrobe();
    const ctx = context({ weather: COLD, history, refusals, plan: plan(['tshirt', 'short']) });
    const before = structuredClone({ items, ctx });
    generateOutfits(items, ctx);
    expect({ items, ctx }).toEqual(before);
  });
});

describe('generateOutfits : tenue prévue (« Préparer demain »)', () => {
  it('met la tenue prévue en premier, telle quelle, si toutes ses pièces sont disponibles', () => {
    const items = wardrobe();
    const outfits = generateOutfits(items, context({ weather: COLD, plan: plan(['tshirt', 'short', 'trench', 'baskets']) }));
    expect(outfits[0]).toMatchObject({
      item_ids: ['trench', 'tshirt', 'short', 'baskets'],
      core_ids: ['short', 'trench', 'tshirt'],
      key: 'baskets+short+trench+tshirt',
      title: 'T-shirt, short et trench',
      planned: true,
    });
    expect(outfits).toHaveLength(5);
    expect(outfits.slice(1).every((outfit) => !outfit.planned)).toBe(true);
    expect(outfits.slice(1).some((outfit) => outfit.core_ids.join() === outfits[0].core_ids.join())).toBe(false);
  });

  it('ignore une tenue prévue pour une autre date', () => {
    const items = wardrobe();
    const other = generateOutfits(items, context({ weather: COLD, plan: plan(['tshirt', 'short'], '2026-10-25') }));
    expect(other).toEqual(generateOutfits(items, context({ weather: COLD })));
  });

  it('remplace une pièce au sale par la meilleure de sa catégorie', () => {
    const items = wardrobe().map((piece) => (piece.id === 'tshirt' ? { ...piece, dirty: true } : piece));
    const [first] = generateOutfits(items, context({ weather: COLD, plan: plan(['tshirt', 'short', 'trench', 'baskets']) }));
    expect(first.planned).toBe(true);
    expect(first.item_ids).toEqual(['trench', 'pull-chaud', 'short', 'baskets']);
  });

  it('remplace une veste ou des chaussures au sale', () => {
    const items = wardrobe().map((piece) =>
      piece.id === 'trench' || piece.id === 'baskets' ? { ...piece, dirty: true } : piece,
    );
    const [first] = generateOutfits(items, context({ weather: COLD, plan: plan(['tshirt', 'short', 'trench', 'baskets']) }));
    expect(first.planned).toBe(true);
    expect(first.item_ids).toEqual(['doudoune', 'tshirt', 'short', 'bottines']);
  });

  it('complète une tenue dont une pièce a disparu des pièces reçues', () => {
    // Le miroir n'envoie que les pièces propres : un haut au sale y est simplement absent.
    const items = wardrobe().filter((piece) => piece.id !== 'tshirt');
    const [first] = generateOutfits(items, context({ weather: COLD, plan: plan(['tshirt', 'jean', 'trench', 'baskets']) }));
    expect(first.planned).toBe(true);
    expect(first.item_ids).toEqual(['trench', 'pull-chaud', 'jean', 'baskets']);
  });

  it('remet une veste s’il en faut une et qu’une pièce du plan a disparu', () => {
    const items = wardrobe().filter((piece) => piece.id !== 'trench');
    const [first] = generateOutfits(items, context({ weather: COLD, plan: plan(['tshirt', 'jean', 'trench', 'baskets']) }));
    expect(first.item_ids).toEqual(['doudoune', 'tshirt', 'jean', 'baskets']);
  });

  it('garde une tenue prévue sans veste quand rien ne manque : c’était voulu', () => {
    const [first] = generateOutfits(wardrobe(), context({ weather: COLD, plan: plan(['tshirt', 'jean', 'baskets']) }));
    expect(first).toMatchObject({ item_ids: ['tshirt', 'jean', 'baskets'], planned: true });
  });

  it('se passe du plan si aucune de ses pièces n’est encore disponible', () => {
    const items = wardrobe().map((piece) => (piece.id === 'tshirt' ? { ...piece, dirty: true } : piece));
    const outfits = generateOutfits(items, context({ weather: COLD, plan: plan(['tshirt', 'supprime']) }));
    expect(outfits.some((outfit) => outfit.planned)).toBe(false);
    expect(outfits).toEqual(generateOutfits(items, context({ weather: COLD })));
  });

  it('se passe du plan si son bas au sale n’a pas de remplaçant : un haut seul n’est pas une tenue', () => {
    const items = [
      item('h1', 'haut'),
      item('b1', 'bas', { dirty: true }),
      item('r1', 'robe'),
      item('s1', 'chaussures'),
    ];
    const outfits = generateOutfits(items, context({ plan: plan(['h1', 'b1', 's1']) }));
    expect(outfits.some((outfit) => outfit.planned)).toBe(false);
    expect(outfits.map((outfit) => outfit.key)).toEqual(['r1+s1']);
    // Même cas quand la pièce au sale est simplement absente des pièces reçues (miroir).
    const clean = items.filter((piece) => !piece.dirty);
    expect(generateOutfits(clean, context({ plan: plan(['h1', 'b1', 's1']) })).map((outfit) => outfit.key)).toEqual([
      'r1+s1',
    ]);
  });

  it('garde la tenue prévue même si elle a été refusée', () => {
    const refusals = [refusal('tshirt', 'short', 'trench')];
    const [first] = generateOutfits(
      wardrobe(),
      context({ weather: COLD, refusals, plan: plan(['tshirt', 'short', 'trench', 'baskets']) }),
    );
    expect(first).toMatchObject({ key: 'baskets+short+trench+tshirt', planned: true });
  });

  it('compte la tenue prévue dans la variété des suivantes', () => {
    const items = [item('h', 'haut'), item('h2', 'haut', { warmth: 1 }), ...['b1', 'b2', 'b3', 'b4', 'b5'].map((id) => item(id, 'bas'))];
    const outfits = generateOutfits(items, context({ plan: plan(['h', 'b1']) }));
    expect(outfits[0].key).toBe('b1+h');
    expect(outfits.filter((outfit) => outfit.item_ids.includes('h')).length).toBeLessThanOrEqual(MAX_SAME_TOP);
  });
});

describe('coreIdsOf', () => {
  it('garde les pièces principales et la veste, triées, sans les chaussures ni les inconnues', () => {
    const items = wardrobe();
    expect(coreIdsOf(['baskets', 'trench', 'tshirt', 'short', 'inconnue', 'tshirt'], items)).toEqual([
      'short',
      'trench',
      'tshirt',
    ]);
    expect(coreIdsOf([], items)).toEqual([]);
  });

  it('redonne le cœur de chaque tenue proposée, celui qu’enregistre un refus', () => {
    const items = [...wardrobe(), item('ceinture', 'accessoire'), item('robe', 'robe')];
    for (const outfit of generateOutfits(items, context({ weather: COLD }))) {
      expect(coreIdsOf(outfit.item_ids, items)).toEqual(outfit.core_ids);
    }
  });
});

describe('generateOutfits : grande garde-robe', () => {
  it('reste rapide avec 40 pièces par catégorie', () => {
    const categories: Category[] = ['haut', 'bas', 'robe', 'veste', 'chaussures', 'accessoire'];
    const colors = ['#D62828', '#2A9D3A', '#1F4FD1', '#808080', '#111111', null];
    const items = categories.flatMap((category, c) =>
      Array.from({ length: 40 }, (_, i) =>
        item(`${category}-${i}`, category, {
          warmth: ((i % 3) + 1) as 1 | 2 | 3,
          color: colors[(i + c) % colors.length],
          rain_ok: i % 4 === 0,
        }),
      ),
    );
    const started = performance.now();
    const outfits = generateOutfits(items, context({ weather: COLD }));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(outfits).toHaveLength(5);
    expect(new Set(outfits.map((outfit) => outfit.key)).size).toBe(5);
  });
});
