import { describe, expect, it } from 'vitest';
import { isStuck, stuckRootMargin } from './sticky-edge';

describe('filet sous un en-tête collé', () => {
  it('réduit la fenêtre jusqu’à un pixel sous la place collée', () => {
    expect(stuckRootMargin(0)).toBe('-1px 0px 0px 0px'); // barre retour, top-0
    expect(stuckRootMargin(44)).toBe('-45px 0px 0px 0px'); // bande de la garde-robe, top-11
  });

  it('dit collé seulement quand le haut a atteint sa place', () => {
    // Barre retour : 16 px du haut au repos (pt-4), 0 une fois collée.
    expect(isStuck(16, 0)).toBe(false);
    expect(isStuck(0, 0)).toBe(true);
    // Bande de la garde-robe : collée sous la barre de 44 px.
    expect(isStuck(178, 44)).toBe(false);
    expect(isStuck(44.4, 44)).toBe(true);
    // Poussée plus haut (fin de son conteneur) : le contenu glisse toujours dessous.
    expect(isStuck(-10, 44)).toBe(true);
  });

  it('compte comme collé tout haut rapporté au passage du bord, même à moins d’un pixel', () => {
    // L'observateur ne rappelle qu'une fois, sous `offset + 1` : un haut à 0,7 px (défilement par
    // tiers de pixel) qui serait dit « pas collé » laisserait la barre sans filet jusqu'en haut.
    expect(isStuck(0.7, 0)).toBe(true);
    expect(isStuck(0.99, 0)).toBe(true);
    expect(isStuck(44.7, 44)).toBe(true);
    expect(isStuck(44.99, 44)).toBe(true);
    // Sur le bord ou en dessous : encore dans la fenêtre réduite, pas collé.
    expect(isStuck(1, 0)).toBe(false);
    expect(isStuck(45, 44)).toBe(false);
  });
});
