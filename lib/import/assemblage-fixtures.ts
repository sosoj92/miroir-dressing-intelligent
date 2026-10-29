// Paquet d'assemblage factice (tests unitaires seulement, aucune donnée réelle). La photo PHOTO_A
// est partagée par une veste et un bas, comme deux pièces photographiées ensemble.

export function fakePhoto(overrides: Record<string, unknown> = {}) {
  return {
    original: 'photos/PHOTO_A.jpg',
    cutout: 'photos/PHOTO_A.webp',
    size: [1200, 1600],
    eye: [600, 380.5],
    eyeDist: 58,
    centers: [
      [380, 620],
      [390, 621.5],
    ],
    topLow: 480,
    bottomHigh: 500,
    onePiece: false,
    tucked: false,
    ...overrides,
  };
}

export function fakeItem(overrides: Record<string, unknown> = {}) {
  return {
    legacy_id: 'a01',
    name: 'Veste test',
    category: 'veste',
    color: '#a0b0c0',
    warmth: 2,
    styles: ['decontracte'],
    rain_ok: false,
    photo: 'PHOTO_A',
    sleeves: 'manches/a01.webp',
    ...overrides,
  };
}

/** Trois pièces : a01 (veste, manches) et a19 (bas) sur PHOTO_A, a18 (robe) sur PHOTO_B. */
export function fakeManifest(overrides: Record<string, unknown> = {}) {
  return {
    format: 'mon-dressing/assemblage',
    version: 1,
    margin: 6,
    feather: 10,
    photos: {
      PHOTO_A: fakePhoto(),
      PHOTO_B: fakePhoto({ original: 'photos/PHOTO_B.jpg', cutout: 'photos/PHOTO_B.webp', topLow: null, onePiece: true }),
    },
    items: [
      fakeItem(),
      fakeItem({ legacy_id: 'a19', name: 'Bas test', category: 'bas', color: null, sleeves: null, styles: ['sport', 'sport'] }),
      fakeItem({ legacy_id: 'a18', name: 'Robe test', category: 'robe', photo: 'PHOTO_B', sleeves: null, warmth: 1 }),
    ],
    ...overrides,
  };
}

/**
 * Champ `arms` (bras pliés) d'une photo 1200 x 1600, chemins du zip. Quatre lignes décrites
 * (250 à 265 px sous les yeux) ; boîte du corps débordant de 1 px du cadre, comme dans les vrais paquets.
 */
export function fakeArms(key = 'PHOTO_A', overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    arms: { path: `bras/${key}.webp`, box: [360, 600, 480, 400] },
    body: { path: `corps/${key}.webp`, box: [-1, 200, 1202, 1401] },
    sleeves: { path: `manches-photo/${key}.webp`, box: [362, 640, 476, 120] },
    step: 5,
    from: 250,
    L: [[400.5, 440.2], null, [401, 441], [402, 442]],
    R: [[760, 800], [761.5, 801], null, null],
    sleeveL: [[398, 446], [399, 447], null, null],
    sleeveR: [null, null, null, null],
    wrist: { L: 650.5, R: null },
    cuff: { L: 268, R: null },
    ...overrides,
  };
}

/** Le paquet d'aujourd'hui : bras pliés sur PHOTO_A (veste et bas), pas sur PHOTO_B (robe). */
export function fakeArmsManifest(armsOverrides: Record<string, unknown> = {}) {
  const manifest = fakeManifest();
  return {
    ...manifest,
    photos: { ...manifest.photos, PHOTO_A: fakePhoto({ arms: fakeArms('PHOTO_A', armsOverrides) }) },
  };
}

/** Octets magiques suffisants pour passer pour un JPEG ou un WebP. */
export const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
export const FAKE_WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
