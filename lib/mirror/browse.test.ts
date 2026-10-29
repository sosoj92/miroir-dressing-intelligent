import { describe, expect, it } from 'vitest';
import type { DayWeather } from '@/lib/types';
import {
  afterRefusal,
  buildBrowse,
  changesOnlyHidden,
  composedIds,
  composedOutfit,
  cycleJacket,
  isRefused,
  itemsByProximity,
  moveBottom,
  moveTop,
  neighbours,
  selectionOf,
  type Browse,
  type Selection,
} from './browse';
import { ITEMS, mirrorItem, payload } from './test-fixtures';

const RAIN: DayWeather = { date: '2026-10-24', tempMin: 9, tempMax: 14, temp: 14, code: 61, rain: true, label: 'Pluie' };

describe('buildBrowse', () => {
  it('range chaque liste des mieux adaptés aux moins adaptés au jour (pluie : la veste ok pluie d’abord)', () => {
    const items = [
      ...ITEMS,
      mirrorItem('v2', 'veste', { rain_ok: false, warmth: 2 }),
      mirrorItem('v3', 'veste', { rain_ok: true, warmth: 2 }),
    ];
    const browse = buildBrowse(payload({ items, weather: RAIN }), []);
    expect(browse.jackets[browse.jackets.length - 1].id).toBe('v2');
    // Il faut une veste (pluie) : le point de départ en a une.
    expect(browse.start.jacket).toBeGreaterThan(0);
  });

  it('écarte les pièces au sale, les chaussures et les accessoires', () => {
    const items = ITEMS.map((item) => (item.id === 'h2' ? { ...item, dirty: true } : item));
    const browse = buildBrowse(payload({ items: items.filter((item) => !item.dirty) }), []);
    const all = [...browse.tops, ...browse.bottoms, ...browse.jackets].map((item) => item.id);
    expect(all).not.toContain('h2');
    expect(all).not.toContain('c1');
    expect(all).not.toContain('a1');
  });

  it('part de la tenue prévue pour ce jour s’il y en a une', () => {
    const browse = buildBrowse(payload({ plan: { date: '2026-10-24', item_ids: ['h2', 'b2', 'c1'], confirmed: true } }), []);
    expect(composedIds(browse, browse.start).sort()).toEqual(['b2', 'h2']);
  });

  it('sans bas propre : seules les robes défilent, jamais un haut seul', () => {
    const items = [mirrorItem('h1', 'haut'), mirrorItem('h2', 'haut'), mirrorItem('r1', 'robe'), mirrorItem('v1', 'veste')];
    const data = payload({ items });
    const browse = buildBrowse(data, []);
    expect(browse.tops.map((item) => item.id)).toEqual(['r1']);
    expect(browse.bottoms).toEqual([]);
    expect(composedOutfit(browse, browse.start, data)!.drawn_ids).toEqual(['r1']);
    expect(composedOutfit(browse, moveTop(browse, browse.start, 1), data)!.drawn_ids).toEqual(['r1']);
  });

  it('sans haut ni robe : rien à composer, ni bas seul ni veste sur un bas', () => {
    const items = [mirrorItem('b1', 'bas'), mirrorItem('b2', 'bas'), mirrorItem('v1', 'veste')];
    const data = payload({ items });
    const browse = buildBrowse(data, []);
    expect([...browse.tops, ...browse.bottoms, ...browse.jackets]).toEqual([]);
    expect(composedOutfit(browse, browse.start, data)).toBeNull();
    expect(composedOutfit(browse, { top: 0, bottom: 1, jacket: 1 }, data)).toBeNull();
  });

  it('une sélection hors des listes ne compose jamais une tenue incomplète', () => {
    const data = payload();
    const browse = buildBrowse(data, []);
    expect(composedOutfit(browse, { top: browse.tops.length, bottom: 0, jacket: 0 }, data)).toBeNull();
    const top = browse.tops.findIndex((item) => item.category === 'haut');
    expect(composedOutfit(browse, { top, bottom: browse.bottoms.length, jacket: 0 }, data)).toBeNull();
  });

  it('sans pièce : listes vides, rien à composer', () => {
    const browse = buildBrowse(payload({ items: [] }), []);
    expect(browse.tops).toEqual([]);
    expect(composedIds(browse, browse.start)).toEqual([]);
    expect(composedOutfit(browse, browse.start, payload({ items: [] }))).toBeNull();
  });
});

describe('déplacements', () => {
  const data = payload();
  const browse = buildBrowse(data, []);
  const onTop = { top: 0, bottom: 0, jacket: 0 };

  it('bouclent sur chaque axe', () => {
    expect(moveTop(browse, onTop, -1).top).toBe(browse.tops.length - 1);
    expect(moveBottom(browse, { ...onTop, bottom: browse.bottoms.length - 1 }, 1).bottom).toBe(0);
    let jacket = onTop;
    for (let i = 0; i <= browse.jackets.length; i++) jacket = cycleJacket(browse, jacket);
    expect(jacket.jacket).toBe(0);
  });

  it('retrouve la position de pièces données, en gardant le reste', () => {
    const selection = selectionOf(['v1', browse.tops[1].id, browse.bottoms[1].id], browse);
    expect(selection).toEqual({ top: 1, bottom: 1, jacket: 1 });
    expect(selectionOf(['inconnue'], browse, { top: 1, bottom: 1, jacket: 0 })).toEqual({ top: 1, bottom: 1, jacket: 0 });
  });

  it('seule la pièce cachée change : le haut sous une veste, la veste sur une robe', () => {
    const robe = browse.tops.findIndex((item) => item.category === 'robe');
    const withJacket = { ...onTop, jacket: 1 };
    // Sous la veste, ← → ne change pas l'image ; sans veste, si.
    expect(changesOnlyHidden(browse, withJacket, moveTop(browse, withJacket, 1))).toBe(true);
    expect(changesOnlyHidden(browse, onTop, moveTop(browse, onTop, 1))).toBe(false);
    // Passer d'un haut sous la veste à la robe change l'image.
    expect(changesOnlyHidden(browse, { ...withJacket, top: robe - 1 }, { ...withJacket, top: robe })).toBe(false);
    // Sur une robe, la veste ne se dessine pas.
    const dress = { ...onTop, top: robe };
    expect(changesOnlyHidden(browse, dress, cycleJacket(browse, dress))).toBe(true);
    // Rien n'a changé : ce n'est pas un changement caché.
    expect(changesOnlyHidden(browse, withJacket, withJacket)).toBe(false);
    // Le bas se voit toujours.
    expect(changesOnlyHidden(browse, withJacket, moveBottom(browse, withJacket, 1))).toBe(false);
  });

  it('voisins : une touche de distance, sans doublon ni la composition elle-même', () => {
    const around = neighbours(browse, onTop);
    const keys = around.map((selection) => composedIds(browse, selection).sort().join('+'));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain(composedIds(browse, onTop).sort().join('+'));
    expect(around.length).toBeGreaterThanOrEqual(3);
  });
});

describe('afterRefusal : « non » montre une autre image', () => {
  const RAIN_DAY = { weather: RAIN };
  function drawn(browse: Browse, selection: Selection): string {
    const data = payload();
    return composedOutfit(browse, selection, data)!.drawn_ids.join('+');
  }

  it('un seul bas et une veste qui cache le haut : passe à la veste suivante (ici sans veste)', () => {
    const items = [mirrorItem('h1', 'haut'), mirrorItem('h2', 'haut'), mirrorItem('b1', 'bas'), mirrorItem('v1', 'veste')];
    const browse = buildBrowse(payload({ items, ...RAIN_DAY }), []);
    const selection = { ...browse.start, jacket: 1 };
    const next = afterRefusal(browse, selection);
    expect(drawn(browse, next)).not.toBe(drawn(browse, selection));
    expect(next.jacket).toBe(0);
  });

  it('un seul haut, sans veste : passe au bas suivant', () => {
    const items = [mirrorItem('h1', 'haut'), mirrorItem('b1', 'bas'), mirrorItem('b2', 'bas')];
    const browse = buildBrowse(payload({ items }), []);
    const selection = { top: 0, bottom: 0, jacket: 0 };
    const next = afterRefusal(browse, selection);
    expect(next).toEqual({ top: 0, bottom: 1, jacket: 0 });
    expect(drawn(browse, next)).not.toBe(drawn(browse, selection));
  });

  it('un seul haut et un seul bas, sans veste : met une veste (la seule autre image)', () => {
    const items = [mirrorItem('h1', 'haut'), mirrorItem('b1', 'bas'), mirrorItem('v1', 'veste')];
    const data = payload({ items });
    const browse = buildBrowse(data, []);
    const start = { top: 0, bottom: 0, jacket: 0 };
    expect(composedIds(browse, afterRefusal(browse, start))).toEqual(['v1', 'h1', 'b1']);
  });

  it('rien d’autre à montrer (une seule robe) : la sélection reste', () => {
    const browse = buildBrowse(payload({ items: [mirrorItem('r1', 'robe'), mirrorItem('v1', 'veste')] }), []);
    expect(afterRefusal(browse, browse.start)).toEqual(browse.start);
  });
});

describe('itemsByProximity', () => {
  it('les pièces dessinées, chacune une fois, les plus proches de la sélection d’abord', () => {
    const data = payload();
    const browse = buildBrowse(data, []);
    const selection = { top: 1, bottom: 1, jacket: 1 };
    const ordered = itemsByProximity(browse, selection).map((item) => item.id);
    expect(ordered.slice(0, 3)).toEqual([browse.tops[1].id, browse.bottoms[1].id, browse.jackets[0].id]);
    expect([...ordered].sort()).toEqual([...browse.tops, ...browse.bottoms, ...browse.jackets].map((item) => item.id).sort());
    expect(ordered).not.toContain('c1');
    expect(ordered).not.toContain('a1');
  });
});

describe('isRefused', () => {
  it('compare ce que montre la silhouette, ou le cœur (anciens refus)', () => {
    const data = payload();
    const browse = buildBrowse(data, []);
    const outfit = composedOutfit(browse, { top: 0, bottom: 0, jacket: 1 }, data)!;
    expect(isRefused(outfit, [{ item_ids: outfit.drawn_ids }])).toBe(true);
    expect(isRefused(outfit, [{ item_ids: outfit.core_ids }])).toBe(true);
    expect(isRefused(outfit, [{ item_ids: [browse.tops[0].id, browse.bottoms[0].id].sort() }])).toBe(false);
  });
});
