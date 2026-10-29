import { describe, expect, it } from 'vitest';
import type { Assembly, Category, Item } from '@/lib/types';
import { assemblyLayers } from './layers';

const assembly: Assembly = {
  v: 1,
  photo: { key: 'P', size: [1200, 1600], eye: [600, 400], centers: [], topLow: 480, bottomHigh: 520, onePiece: false, tucked: false },
  sleevesPath: null,
};

function item(id: string, category: Category, withAssembly = true): Item {
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
    created_at: '',
    assembly: withAssembly ? assembly : null,
  };
}

function byId(items: Item[]) {
  return new Map(items.map((entry) => [entry.id, entry]));
}

describe('lib/assembly/layers', () => {
  it('assemble le haut au-dessus du bas', () => {
    const map = byId([item('h', 'haut'), item('b', 'bas'), item('c', 'chaussures'), item('a', 'accessoire')]);
    const layers = assemblyLayers(['h', 'b', 'c', 'a'], map);
    expect(layers?.kind).toBe('pair');
    if (layers?.kind === 'pair') expect([layers.upper.id, layers.lower.id]).toEqual(['h', 'b']);
  });

  it('prend la photo de la veste quand la tenue en a une', () => {
    const layers = assemblyLayers(['v', 'h', 'b'], byId([item('v', 'veste'), item('h', 'haut'), item('b', 'bas')]));
    expect(layers?.kind === 'pair' && layers.upper.id).toBe('v');
  });

  it('affiche une robe seule', () => {
    const layers = assemblyLayers(['r', 'v'], byId([item('r', 'robe'), item('v', 'veste')]));
    expect(layers).toEqual({ kind: 'single', piece: expect.objectContaining({ id: 'r' }) });
  });

  it("renonce si une pièce nécessaire n'a pas de photo portée", () => {
    expect(assemblyLayers(['h', 'b'], byId([item('h', 'haut'), item('b', 'bas', false)]))).toBeNull();
    expect(assemblyLayers(['h'], byId([item('h', 'haut')]))).toBeNull();
    expect(assemblyLayers(['r'], byId([item('r', 'robe', false)]))).toBeNull();
    expect(assemblyLayers(['x'], byId([]))).toBeNull();
  });
});
