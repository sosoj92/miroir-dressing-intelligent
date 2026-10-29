import { describe, expect, it } from 'vitest';
import type { AssemblyPhoto } from '@/lib/types';
import { itemZone, photoZone, zoneLayout } from './zone';

// Photo factice de 1200×1600, yeux à (600, 380) ; milieux de silhouette à x = 620.
const PHOTO: AssemblyPhoto = {
  key: 'PHOTO_A',
  size: [1200, 1600],
  eye: [600, 380],
  centers: [
    [380, 620],
    [800, 640],
  ],
  topLow: 480,
  bottomHigh: 500,
  onePiece: false,
  tucked: false,
};

describe('itemZone', () => {
  it('haut ou veste : du haut de la tête à 12 px sous l’ourlet, en carré centré sur les yeux', () => {
    // y : 380 − 170 = 210 → 380 + 480 + 12 = 872 ; côté 662, centré sur x = 600.
    expect(itemZone('haut', PHOTO)).toEqual({ x: 269, y: 210, width: 662, height: 662 });
    expect(itemZone('veste', PHOTO)).toEqual(itemZone('haut', PHOTO));
  });

  it('haut plus long que la zone mesurée (topLow null) : jusqu’à 620 px sous les yeux', () => {
    expect(itemZone('haut', { ...PHOTO, topLow: null })).toEqual({ x: 205, y: 210, width: 790, height: 790 });
  });

  it('bas : de 8 px au-dessus de la ceinture jusqu’au bas de la photo', () => {
    // y : 380 + 500 − 8 = 872 → 1600 ; côté 728, centré sur le milieu de silhouette interpolé.
    const zone = itemZone('bas', PHOTO);
    expect(zone).toMatchObject({ y: 872, width: 728, height: 728 });
    expect(zone.x + zone.width / 2).toBeCloseTo(640, 0);
  });

  it('bas dont la ceinture est cachée (bottomHigh null) : à partir de 450 px sous les yeux', () => {
    expect(itemZone('bas', { ...PHOTO, bottomHigh: null })).toMatchObject({ y: 830, height: 770 });
  });

  it('robe, chaussures et accessoire : la photo entière', () => {
    const whole = { x: 0, y: 0, width: 1200, height: 1600 };
    expect(itemZone('robe', PHOTO)).toEqual(whole);
    expect(itemZone('accessoire', PHOTO)).toEqual(whole);
    expect(itemZone('chaussures', PHOTO)).toEqual(whole);
  });

  it('reste dans la photo : tête coupée en haut, bord de l’image, zone vide', () => {
    expect(itemZone('haut', { ...PHOTO, eye: [600, 100] })).toMatchObject({ y: 0 });
    // Silhouette au bord droit : le carré est ramené dans la photo.
    expect(itemZone('haut', { ...PHOTO, eye: [1150, 380] })).toMatchObject({ x: 538, width: 662 });
    // Ceinture sous le bas de la photo : la photo entière plutôt qu’une zone vide.
    expect(itemZone('bas', { ...PHOTO, bottomHigh: 1400 })).toEqual({ x: 0, y: 0, width: 1200, height: 1600 });
    // Zone plus haute que la photo n’est large : largeur bornée à la photo.
    const narrow = itemZone('bas', { ...PHOTO, size: [500, 1600], eye: [250, 380], bottomHigh: 100 });
    expect(narrow).toMatchObject({ x: 0, width: 500, y: 472, height: 1128 });
  });
});

describe('zoneLayout', () => {
  it('place la photo entière pour ne montrer que la zone, dans un cadre au bon rapport', () => {
    expect(zoneLayout({ x: 255, y: 210, width: 690, height: 690 }, [1200, 1600])).toEqual({
      frame: { width: '100%', height: '100%' },
      image: { left: '-36.96%', top: '-30.43%', width: '173.91%', height: '231.88%' },
    });
  });

  it('cadre portrait ou paysage, centré dans la vignette carrée', () => {
    expect(zoneLayout({ x: 0, y: 0, width: 1200, height: 1600 }, [1200, 1600])).toEqual({
      frame: { width: '75%', height: '100%' },
      image: { left: '0%', top: '0%', width: '100%', height: '100%' },
    });
    expect(zoneLayout({ x: 0, y: 800, width: 1200, height: 600 }, [1200, 1600]).frame).toEqual({
      width: '100%',
      height: '50%',
    });
  });
});

describe('photoZone', () => {
  it('pièce assemblée : sa zone et la taille de sa photo ; sinon null', () => {
    const assembly = { v: 1 as const, photo: PHOTO, sleevesPath: null };
    expect(photoZone({ category: 'bas', assembly })).toEqual({ zone: itemZone('bas', PHOTO), size: [1200, 1600] });
    expect(photoZone({ category: 'haut', assembly: null })).toBeNull();
    expect(photoZone({ category: 'haut' })).toBeNull();
  });
});
