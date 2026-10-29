import { describe, expect, it } from 'vitest';
import {
  DARK_LUMINANCE_THRESHOLD,
  MAX_BRIGHTNESS,
  MIN_CONTRAST,
  SILHOUETTE_BRIGHTNESS,
  brightnessFilter,
  relativeLuminance,
  silhouetteFilter,
} from './brightness';

describe('relativeLuminance', () => {
  it('suit la formule WCAG', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 3);
  });

  it('renvoie null pour une couleur absente ou invalide', () => {
    expect(relativeLuminance(null)).toBeNull();
    expect(relativeLuminance(undefined)).toBeNull();
    expect(relativeLuminance('navy')).toBeNull();
    expect(relativeLuminance('#12345')).toBeNull();
  });
});

describe('brightnessFilter', () => {
  it('laisse les pièces claires et les couleurs inconnues telles quelles', () => {
    expect(brightnessFilter('#FFFFFF')).toBeNull();
    expect(brightnessFilter('#C8B59A')).toBeNull(); // beige
    expect(brightnessFilter('#808080')).toBeNull();
    expect(brightnessFilter(null)).toBeNull();
  });

  it('éclaircit un pull marine et un jean brut', () => {
    expect(relativeLuminance('#1F2A44')!).toBeLessThan(DARK_LUMINANCE_THRESHOLD);
    expect(brightnessFilter('#1F2A44')).toMatch(/^contrast\(0\.\d+\) brightness\(1\.\d+\)$/);
    expect(brightnessFilter('#2C3E50')).not.toBeNull();
  });

  it('éclaircit d’autant plus que la pièce est foncée, au plus jusqu’aux bornes nommées', () => {
    expect(brightnessFilter('#000000')).toBe(`contrast(${MIN_CONTRAST}) brightness(${MAX_BRIGHTNESS})`);
    const parse = (filter: string | null) => Number(/brightness\(([\d.]+)\)/.exec(filter ?? '')?.[1]);
    expect(parse(brightnessFilter('#111111'))).toBeGreaterThan(parse(brightnessFilter('#444444')));
  });

  it('n’ajoute ni ombre ni contour (pas de halo derrière le miroir)', () => {
    for (const color of ['#000000', '#1F2A44', '#3A3A3A']) {
      expect(brightnessFilter(color)).not.toMatch(/drop-shadow|blur|hue|saturate/);
    }
  });
});

describe('silhouetteFilter', () => {
  it('éclaircit légèrement et toujours de la même façon, sans halo', () => {
    expect(SILHOUETTE_BRIGHTNESS).toBeGreaterThan(1);
    expect(SILHOUETTE_BRIGHTNESS).toBeLessThanOrEqual(1.4);
    expect(silhouetteFilter()).toBe(`brightness(${SILHOUETTE_BRIGHTNESS})`);
  });
});
