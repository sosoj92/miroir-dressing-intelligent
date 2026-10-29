import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_SIDE, fitWithin } from './resize';

describe('fitWithin', () => {
  it('réduit une photo paysage de téléphone à 1600 px de large', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
  });

  it('réduit une photo portrait à 1600 px de haut', () => {
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(3000, 4000, 1000)).toEqual({ width: 750, height: 1000 });
  });

  it('le grand côté ne dépasse jamais le maximum', () => {
    for (const [width, height] of [
      [4031, 3023],
      [1601, 1601],
      [9999, 7],
      [7, 9999],
      [2448, 3264],
    ]) {
      const size = fitWithin(width, height);
      expect(Math.max(size.width, size.height), `${width}×${height}`).toBe(MAX_PHOTO_SIDE);
      expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(1);
    }
  });

  it('garde les proportions', () => {
    const { width, height } = fitWithin(4000, 2250);
    expect(width / height).toBeCloseTo(4000 / 2250, 2);
  });

  it("n'agrandit jamais une petite photo", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it('refuse des dimensions absurdes', () => {
    for (const [width, height, max] of [
      [0, 100, 1600],
      [100, -1, 1600],
      [Number.NaN, 100, 1600],
      [100, 100, 0],
      [Number.POSITIVE_INFINITY, 100, 1600],
    ]) {
      expect(() => fitWithin(width, height, max)).toThrow(RangeError);
    }
  });
});
