import { describe, expect, it } from 'vitest';
import { ITEM_COLUMNS, parseItemRow } from './rows';

const ROW = {
  id: 'a',
  name: 'Bas test',
  category: 'bas',
  color: '#202020',
  warmth: 2,
  styles: ['sport'],
  rain_ok: false,
  dirty: false,
  photo_path: 'u/assemblage/PHOTO_A.jpg',
  cutout_path: 'u/assemblage/PHOTO_A.webp',
  legacy_id: 'a19',
  created_at: '2026-10-24T08:00:00Z',
};

const ASSEMBLY = {
  v: 1,
  photo: {
    key: 'PHOTO_A',
    size: [1200, 1600],
    eye: [594.7, 382.1],
    centers: [
      [380, 622.5],
      [390, 623],
    ],
    topLow: 483,
    bottomHigh: 504,
    onePiece: false,
    tucked: false,
  },
  sleevesPath: null,
};

describe('parseItemRow et assembly', () => {
  it('lit la colonne assembly', () => {
    expect(ITEM_COLUMNS.split(', ')).toContain('assembly');
    expect(parseItemRow({ ...ROW, assembly: ASSEMBLY })?.assembly).toEqual(ASSEMBLY);
  });

  it('assembly absente ou illisible : null, la pièce reste lisible', () => {
    expect(parseItemRow(ROW)).toMatchObject({ name: 'Bas test', assembly: null });
    expect(parseItemRow({ ...ROW, assembly: { ...ASSEMBLY, v: 2 } })?.assembly).toBeNull();
    expect(parseItemRow({ ...ROW, assembly: { ...ASSEMBLY, photo: { ...ASSEMBLY.photo, key: '../x' } } })?.assembly).toBeNull();
    expect(parseItemRow({ ...ROW, assembly: 'texte' })?.assembly).toBeNull();
  });
});
