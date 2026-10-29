import { describe, expect, it } from 'vitest';
import { dismissedRows, missingLabel, type RefusedPiece } from './rows';

const jacket: RefusedPiece = { id: 'v', name: 'Veste imperméable grise et noire', category: 'veste' };
const top: RefusedPiece = { id: 'h', name: 'Débardeur rayé blanc et beige', category: 'haut' };
const bottom: RefusedPiece = { id: 'b', name: 'Jean droit gris anthracite', category: 'bas' };
const dress: RefusedPiece = { id: 'r', name: 'Robe longue en soie', category: 'robe' };
const shoes: RefusedPiece = { id: 'c', name: 'Baskets blanches', category: 'chaussures' };
const items = [jacket, top, bottom, dress, shoes];

describe('dismissedRows', () => {
  it("écrit un ancien refus comme le miroir : la veste puis le bas, le haut caché en note", () => {
    expect(dismissedRows([{ id: '1', item_ids: ['h', 'b', 'v'] }], items)).toEqual([
      {
        id: '1',
        lines: ['Veste imperméable grise et noire', 'Jean droit gris anthracite'],
        note: 'Sous la veste : débardeur rayé blanc et beige',
        missing: null,
      },
    ]);
  });

  it('écrit un refus sans veste en deux lignes, et une robe seule en une', () => {
    const rows = dismissedRows(
      [
        { id: '1', item_ids: ['b', 'h'] },
        { id: '2', item_ids: ['r'] },
      ],
      items,
    );
    expect(rows.map((row) => [row.id, row.lines, row.note])).toEqual([
      ['1', ['Débardeur rayé blanc et beige', 'Jean droit gris anthracite'], null],
      ['2', ['Robe longue en soie'], null],
    ]);
  });

  it('garde l’ordre des refus (le plus récent en premier)', () => {
    const rows = dismissedRows(
      [
        { id: 'récent', item_ids: ['r'] },
        { id: 'ancien', item_ids: ['h', 'b'] },
      ],
      items,
    );
    expect(rows.map((row) => row.id)).toEqual(['récent', 'ancien']);
  });

  it('signale une pièce effacée depuis, à part', () => {
    expect(dismissedRows([{ id: '1', item_ids: ['v', 'disparue'] }], items)).toEqual([
      { id: '1', lines: ['Veste imperméable grise et noire'], note: null, missing: 'Pièce supprimée' },
    ]);
  });

  it('sans pièce que la légende nomme, garde les noms restants plutôt que « Tenue du jour »', () => {
    expect(dismissedRows([{ id: '1', item_ids: ['x', 'y'] }], items)).toEqual([
      { id: '1', lines: [], note: null, missing: '2 pièces supprimées' },
    ]);
    expect(dismissedRows([{ id: '2', item_ids: ['c', 'x'] }], items)).toEqual([
      { id: '2', lines: ['Baskets blanches'], note: null, missing: 'Pièce supprimée' },
    ]);
    expect(dismissedRows([{ id: '3', item_ids: null }], items)).toEqual([
      { id: '3', lines: [], note: null, missing: null },
    ]);
  });
});

describe('missingLabel', () => {
  it('ne dit rien sans pièce manquante, puis compte au-delà d’une', () => {
    expect(missingLabel(0)).toBeNull();
    expect(missingLabel(1)).toBe('Pièce supprimée');
    expect(missingLabel(3)).toBe('3 pièces supprimées');
  });
});
