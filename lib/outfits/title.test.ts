import { describe, expect, it } from 'vitest';
import { FALLBACK_TITLE, outfitCaption } from './title';

const jacket = { name: 'Veste imperméable grise et noire', category: 'veste' };
const top = { name: 'Pull léger beige à col rond', category: 'haut' };
const bottom = { name: 'Pantalon droit gris foncé', category: 'bas' };
const dress = { name: 'Robe droite bleue à motifs', category: 'robe' };
const shoes = { name: 'Bottines', category: 'chaussures' };

describe('outfitCaption', () => {
  it('veste et bas, puis le haut caché en note', () => {
    expect(outfitCaption([jacket, top, bottom, shoes])).toEqual({
      lines: ['Veste imperméable grise et noire', 'Pantalon droit gris foncé'],
      note: 'Sous la veste : pull léger beige à col rond',
    });
  });

  it('haut et bas, sans note', () => {
    expect(outfitCaption([top, bottom])).toEqual({ lines: ['Pull léger beige à col rond', 'Pantalon droit gris foncé'], note: null });
  });

  it('robe seule, la veste en note', () => {
    expect(outfitCaption([jacket, dress])).toEqual({
      lines: ['Robe droite bleue à motifs'],
      note: 'Par-dessus : veste imperméable grise et noire',
    });
    expect(outfitCaption([dress])).toEqual({ lines: ['Robe droite bleue à motifs'], note: null });
  });

  it('pièces empilées : une ligne par pièce montrée, sans note', () => {
    expect(outfitCaption([jacket, top, bottom], true)).toEqual({
      lines: ['Veste imperméable grise et noire', 'Pull léger beige à col rond', 'Pantalon droit gris foncé'],
      note: null,
    });
  });

  it('sans nom : le titre de secours', () => {
    expect(outfitCaption([])).toEqual({ lines: [FALLBACK_TITLE], note: null });
  });
});
