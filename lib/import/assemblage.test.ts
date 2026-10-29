import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  ASSEMBLY_LIMITS,
  armsEntryName,
  assemblyArmsPath,
  assemblyCutoutPath,
  assemblyPhotoPath,
  assemblySleevesPath,
  buildAssemblyBatches,
  checkBytes,
  checkEntry,
  isAssemblyManifest,
  parseAssemblyManifest,
  planFiles,
  toAssemblyPayloads,
  uploadPlan,
  type AssemblyManifest,
} from './assemblage';
import {
  FAKE_JPEG,
  FAKE_WEBP,
  fakeArms,
  fakeArmsManifest,
  fakeItem,
  fakeManifest,
  fakePhoto,
} from './assemblage-fixtures';

const USER = '0b7c7a2e-5f0e-4b8e-9a51-0e3c0f6d9a11';
const photo = fakePhoto;
const item = fakeItem;

function parsed(json: unknown = fakeManifest()): AssemblyManifest {
  const result = parseAssemblyManifest(json);
  if (!result.ok) throw new Error(result.error);
  return result.manifest;
}

function errorOf(json: unknown): string {
  const result = parseAssemblyManifest(json);
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error;
}

describe('parseAssemblyManifest', () => {
  it('lit les photos et les pièces, et normalise couleur et styles', () => {
    const manifest = parsed();
    expect([...manifest.photos.keys()]).toEqual(['PHOTO_A', 'PHOTO_B']);
    expect(manifest.photos.get('PHOTO_A')).toEqual({
      key: 'PHOTO_A',
      size: [1200, 1600],
      eye: [600, 380.5],
      centers: [
        [380, 620],
        [390, 621.5],
      ],
      topLow: 480,
      bottomHigh: 500,
      onePiece: false,
      tucked: false,
    });
    expect(manifest.items).toEqual([
      {
        legacy_id: 'a01',
        name: 'Veste test',
        category: 'veste',
        color: '#A0B0C0',
        warmth: 2,
        styles: ['decontracte'],
        rain_ok: false,
        photo: 'PHOTO_A',
        sleeves: true,
      },
      expect.objectContaining({ legacy_id: 'a19', color: null, styles: ['sport'], sleeves: false }),
      expect.objectContaining({ legacy_id: 'a18', category: 'robe', photo: 'PHOTO_B' }),
    ]);
  });

  it('reconnaît le format, et refuse une autre version', () => {
    expect(isAssemblyManifest(fakeManifest())).toBe(true);
    expect(isAssemblyManifest({ version: 1, pieces: [] })).toBe(false);
    expect(isAssemblyManifest(null)).toBe(false);
    expect(errorOf({ ...fakeManifest(), format: 'autre' })).toBe("Ce fichier n'est pas un paquet d'assemblage.");
    expect(errorOf(fakeManifest({ version: 2 }))).toBe('Version du paquet non prise en charge (« 2 », 1 attendue).');
  });

  it('refuse une clé de photo qui sortirait de son dossier', () => {
    const photos = { '../PHOTO_A': photo({ original: undefined, cutout: undefined }) };
    expect(errorOf(fakeManifest({ photos }))).toBe(
      'Nom de photo refusé : « ../PHOTO_A » (lettres, chiffres, _ et -, 64 au plus).',
    );
  });

  it('refuse des repères illisibles et des noms de fichiers inattendus', () => {
    const base = fakeManifest();
    expect(errorOf({ ...base, photos: { ...base.photos, PHOTO_A: photo({ eye: [600] }) } })).toBe(
      'Photo PHOTO_A : repères illisibles (taille, yeux, milieux ou lignes).',
    );
    expect(errorOf({ ...base, photos: { ...base.photos, PHOTO_A: photo({ centers: [[390, 1], [380, 1]] }) } })).toContain(
      'repères illisibles',
    );
    expect(errorOf({ ...base, photos: { ...base.photos, PHOTO_A: photo({ original: '../x.jpg' }) } })).toBe(
      "Photo PHOTO_A : photo d'origine inattendue (photos/PHOTO_A.jpg attendu).",
    );
    expect(errorOf({ ...base, photos: { ...base.photos, PHOTO_A: photo({ cutout: 'photos/PHOTO_A.png' }) } })).toBe(
      'Photo PHOTO_A : photo détourée inattendue (photos/PHOTO_A.webp attendu).',
    );
  });

  it('nomme la pièce fautive et le champ en cause', () => {
    const withItem = (overrides: Record<string, unknown>) => fakeManifest({ items: [item(overrides)] });
    expect(errorOf(withItem({ legacy_id: 'g/01' }))).toBe(
      'Pièce n° 1 : identifiant refusé (« g/01 » ; lettres, chiffres, _ et -, 64 au plus).',
    );
    expect(errorOf(withItem({ name: '  ' }))).toBe('Pièce a01 : le nom doit faire de 1 à 80 caractères.');
    expect(errorOf(withItem({ name: 'x'.repeat(81) }))).toBe('Pièce a01 : le nom doit faire de 1 à 80 caractères.');
    expect(errorOf(withItem({ category: 'pull' }))).toBe('Pièce a01 : catégorie inconnue (« pull »).');
    expect(errorOf(withItem({ color: 'gris' }))).toBe('Pièce a01 : couleur invalide (« gris », #RRGGBB attendu).');
    expect(errorOf(withItem({ warmth: 4 }))).toBe('Pièce a01 : chaleur invalide (1, 2 ou 3 attendu).');
    expect(errorOf(withItem({ styles: [] }))).toBe('Pièce a01 : styles absents.');
    expect(errorOf(withItem({ styles: ['chic'] }))).toBe('Pièce a01 : style inconnu (« chic »).');
    expect(errorOf(withItem({ rain_ok: 'non' }))).toBe('Pièce a01 : rain_ok doit valoir true ou false.');
    expect(errorOf(withItem({ photo: 'PHOTO_Z' }))).toBe('Pièce a01 : photo « PHOTO_Z » absente du manifeste.');
    expect(errorOf(withItem({ sleeves: 'manches/a02.webp' }))).toBe(
      'Pièce a01 : manches inattendues (manches/a01.webp attendu).',
    );
  });

  it('refuse un identifiant en double, une liste vide et les paquets trop gros', () => {
    expect(errorOf(fakeManifest({ items: [item(), item({ name: 'Autre' })] }))).toBe('Identifiant de pièce en double : a01.');
    expect(errorOf(fakeManifest({ items: [] }))).toBe('Aucune pièce dans ce paquet.');

    const many = Array.from({ length: ASSEMBLY_LIMITS.items + 1 }, (_, i) => item({ legacy_id: `g${i}`, sleeves: null }));
    expect(errorOf(fakeManifest({ items: many }))).toBe('Trop de pièces : 301 (300 au plus).');

    const photos = Object.fromEntries(
      Array.from({ length: ASSEMBLY_LIMITS.photos + 1 }, (_, i) => [`P${i}`, photo({ original: undefined, cutout: undefined })]),
    );
    expect(errorOf(fakeManifest({ photos }))).toBe('Trop de photos : 301 (300 au plus).');
  });
});

describe('uploadPlan', () => {
  it('envoie chaque photo une seule fois, même partagée par plusieurs pièces', () => {
    const plan = uploadPlan(parsed(), USER);
    expect(plan.photos.map((entry) => entry.key)).toEqual(['PHOTO_A', 'PHOTO_B']);
    expect(plan.photos[0].files).toEqual([
      {
        entry: 'photos/PHOTO_A.jpg',
        label: 'photos/PHOTO_A.jpg',
        path: `${USER}/assemblage/PHOTO_A.jpg`,
        kind: 'jpg',
        contentType: 'image/jpeg',
      },
      {
        entry: 'photos/PHOTO_A.webp',
        label: 'photos/PHOTO_A.webp',
        path: `${USER}/assemblage/PHOTO_A.webp`,
        kind: 'webp',
        contentType: 'image/webp',
      },
    ]);
    expect(plan.sleeves).toEqual([
      expect.objectContaining({ entry: 'manches/a01.webp', path: `${USER}/assemblage/manches/a01.webp`, kind: 'webp' }),
    ]);
    const paths = planFiles(plan).map((file) => file.path);
    expect(paths).toHaveLength(5);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("n'envoie pas une photo qu'aucune pièce n'utilise, et suit le dossier du manifeste", () => {
    const manifest = parsed(fakeManifest({ items: [item({ sleeves: null })] }));
    const plan = uploadPlan(manifest, USER, 'paquet/');
    expect(plan.photos.map((entry) => entry.key)).toEqual(['PHOTO_A']);
    expect(plan.photos[0].files[0]).toMatchObject({ entry: 'paquet/photos/PHOTO_A.jpg', label: 'photos/PHOTO_A.jpg' });
    expect(plan.sleeves).toEqual([]);
  });
});

describe('fichiers du paquet', () => {
  const [jpg, webp] = uploadPlan(parsed(), USER).photos[0].files;
  const JPEG = FAKE_JPEG;
  const WEBP = FAKE_WEBP;
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('vérifie la présence et la taille annoncée avant de décompresser', () => {
    expect(checkEntry(jpg, 1000)).toBeNull();
    expect(checkEntry(jpg, undefined)).toBe('Fichier absent du zip : photos/PHOTO_A.jpg.');
    expect(checkEntry(webp, ASSEMBLY_LIMITS.fileBytes + 1)).toBe('Fichier trop lourd : photos/PHOTO_A.webp (10 Mo au plus).');
  });

  it('vérifie le type par les octets magiques, pas par le nom', () => {
    expect(checkBytes(jpg, JPEG)).toBeNull();
    expect(checkBytes(webp, WEBP)).toBeNull();
    expect(checkBytes(jpg, WEBP)).toBe("photos/PHOTO_A.jpg n'est pas une image JPEG.");
    expect(checkBytes(webp, PNG)).toBe("photos/PHOTO_A.webp n'est pas une image WebP.");
    expect(checkBytes(webp, strToU8('RIFF\x24\x00\x00\x00WAVE'))).toBe("photos/PHOTO_A.webp n'est pas une image WebP.");
  });
});

describe('toAssemblyPayloads', () => {
  it('construit les fiches avec les chemins de la photo partagée et les repères', () => {
    const payloads = toAssemblyPayloads(parsed(), USER);
    expect(payloads.map((payload) => payload.legacy_id)).toEqual(['a01', 'a19', 'a18']);
    const [jacket, bottom, dress] = payloads;
    expect(jacket).toEqual({
      legacy_id: 'a01',
      name: 'Veste test',
      category: 'veste',
      color: '#A0B0C0',
      warmth: 2,
      styles: ['decontracte'],
      rain_ok: false,
      photo_path: assemblyPhotoPath(USER, 'PHOTO_A'),
      cutout_path: assemblyCutoutPath(USER, 'PHOTO_A'),
      assembly: { v: 1, photo: parsed().photos.get('PHOTO_A'), sleevesPath: assemblySleevesPath(USER, 'a01') },
    });
    // Même photo pour la veste et le bas ; ni `dirty` ni `created_at` dans les fiches.
    expect(bottom.photo_path).toBe(jacket.photo_path);
    expect(bottom.assembly.sleevesPath).toBeNull();
    expect(dress.cutout_path).toBe(`${USER}/assemblage/PHOTO_B.webp`);
    for (const payload of payloads) {
      expect(payload).not.toHaveProperty('dirty');
      expect(payload).not.toHaveProperty('created_at');
    }
  });

  it('découpe les envois sous la taille maximale', () => {
    const payloads = toAssemblyPayloads(parsed(), USER);
    expect(buildAssemblyBatches(payloads)).toEqual([{ items: payloads }]);
    const size = JSON.stringify({ items: [payloads[0]] }).length;
    const batches = buildAssemblyBatches(payloads, size + 10);
    expect(batches.map((batch) => batch.items.map((entry) => entry.legacy_id))).toEqual([['a01'], ['a19'], ['a18']]);
    expect(() => buildAssemblyBatches(payloads, 50)).toThrow('Pièce a01 : fiche trop grosse pour être envoyée.');
  });
});

describe('bras pliés dans le paquet (photos[clé].arms)', () => {
  it('lit les bras pliés quand le paquet en a, et accepte toujours un paquet sans', () => {
    const manifest = parsed(fakeArmsManifest());
    expect(manifest.photos.get('PHOTO_A')?.arms).toEqual(fakeArms('PHOTO_A'));
    expect(manifest.photos.get('PHOTO_B')).not.toHaveProperty('arms');
    expect(parsed().photos.get('PHOTO_A')).not.toHaveProperty('arms');
    // Photo sans manches sous l'ourlet : `sleeves` vaut null.
    expect(parsed(fakeArmsManifest({ sleeves: null })).photos.get('PHOTO_A')?.arms?.sleeves).toBeNull();
  });

  it('refuse des bras pliés annoncés mais illisibles, et des couches mal nommées', () => {
    expect(errorOf(fakeArmsManifest({ step: 4 }))).toBe(
      'Photo PHOTO_A : bras pliés illisibles (couches, bords, poignets ou manches).',
    );
    expect(errorOf(fakeArmsManifest({ R: [[760, 800]] }))).toContain('bras pliés illisibles');
    expect(errorOf(fakeArmsManifest({ arms: { path: 'bras/PHOTO_B.webp', box: [360, 600, 480, 400] } }))).toBe(
      'Photo PHOTO_A : couche des bras inattendue (bras/PHOTO_A.webp attendu).',
    );
    expect(errorOf(fakeArmsManifest({ body: { path: 'photos/PHOTO_A.webp', box: [0, 0, 1200, 1600] } }))).toBe(
      'Photo PHOTO_A : couche des bras inattendue (corps/PHOTO_A.webp attendu).',
    );
    expect(errorOf(fakeArmsManifest({ sleeves: { path: 'manches/a01.webp', box: [362, 640, 476, 120] } }))).toBe(
      'Photo PHOTO_A : couche des bras inattendue (manches-photo/PHOTO_A.webp attendu).',
    );
  });

  it('envoie les couches une seule fois par photo, avec sa photo, même partagée par deux pièces', () => {
    const plan = uploadPlan(parsed(fakeArmsManifest()), USER, 'paquet/');
    expect(plan.photos.map((entry) => [entry.key, entry.arms])).toEqual([
      ['PHOTO_A', true],
      ['PHOTO_B', false],
    ]);
    expect(plan.photos[0].files.map((file) => [file.entry, file.label, file.path, file.kind, file.contentType])).toEqual([
      ['paquet/photos/PHOTO_A.jpg', 'photos/PHOTO_A.jpg', `${USER}/assemblage/PHOTO_A.jpg`, 'jpg', 'image/jpeg'],
      ['paquet/photos/PHOTO_A.webp', 'photos/PHOTO_A.webp', `${USER}/assemblage/PHOTO_A.webp`, 'webp', 'image/webp'],
      ['paquet/bras/PHOTO_A.webp', 'bras/PHOTO_A.webp', `${USER}/assemblage/bras/PHOTO_A.webp`, 'webp', 'image/webp'],
      ['paquet/corps/PHOTO_A.webp', 'corps/PHOTO_A.webp', `${USER}/assemblage/corps/PHOTO_A.webp`, 'webp', 'image/webp'],
      [
        'paquet/manches-photo/PHOTO_A.webp',
        'manches-photo/PHOTO_A.webp',
        `${USER}/assemblage/manches-photo/PHOTO_A.webp`,
        'webp',
        'image/webp',
      ],
    ]);
    expect(plan.photos[1].files).toHaveLength(2);
    const paths = planFiles(plan).map((file) => file.path);
    expect(paths).toHaveLength(2 + 3 + 2 + 1); // PHOTO_A et ses 3 couches, PHOTO_B, manches de a01
    expect(new Set(paths).size).toBe(paths.length);

    // Sans manches de la photo : deux couches seulement.
    const bare = uploadPlan(parsed(fakeArmsManifest({ sleeves: null })), USER);
    expect(bare.photos[0].files.map((file) => file.label)).toEqual([
      'photos/PHOTO_A.jpg',
      'photos/PHOTO_A.webp',
      'bras/PHOTO_A.webp',
      'corps/PHOTO_A.webp',
    ]);
    // Paquet sans bras pliés : aucun fichier de plus.
    expect(uploadPlan(parsed(), USER).photos.every((entry) => entry.files.length === 2 && !entry.arms)).toBe(true);
  });

  it('vérifie les couches comme les photos : présence, taille annoncée, octets WebP', () => {
    const layer = uploadPlan(parsed(fakeArmsManifest()), USER).photos[0].files[2];
    expect(layer.label).toBe('bras/PHOTO_A.webp');
    expect(checkEntry(layer, undefined)).toBe('Fichier absent du zip : bras/PHOTO_A.webp.');
    expect(checkEntry(layer, ASSEMBLY_LIMITS.fileBytes + 1)).toBe('Fichier trop lourd : bras/PHOTO_A.webp (10 Mo au plus).');
    expect(checkBytes(layer, FAKE_WEBP)).toBeNull();
    expect(checkBytes(layer, FAKE_JPEG)).toBe("bras/PHOTO_A.webp n'est pas une image WebP.");
  });

  it('enregistre les bras pliés avec les chemins Storage des couches, pour chaque pièce de la photo', () => {
    const [jacket, bottom, dress] = toAssemblyPayloads(parsed(fakeArmsManifest()), USER);
    const zip = fakeArms('PHOTO_A');
    const expected = {
      ...zip,
      arms: { path: assemblyArmsPath(USER, 'PHOTO_A', 'arms'), box: zip.arms.box },
      body: { path: assemblyArmsPath(USER, 'PHOTO_A', 'body'), box: zip.body.box },
      sleeves: { path: assemblyArmsPath(USER, 'PHOTO_A', 'sleeves'), box: zip.sleeves.box },
    };
    expect(jacket.assembly.photo.arms).toEqual(expected);
    expect(bottom.assembly.photo.arms).toEqual(expected);
    expect(dress.assembly.photo).not.toHaveProperty('arms');
    expect(expected.arms.path).toBe(`${USER}/assemblage/bras/PHOTO_A.webp`);
    expect(expected.body.path).toBe(`${USER}/assemblage/corps/PHOTO_A.webp`);
    expect(expected.sleeves.path).toBe(`${USER}/assemblage/manches-photo/PHOTO_A.webp`);
    expect(armsEntryName('PHOTO_A', 'sleeves')).toBe('manches-photo/PHOTO_A.webp');
    // Le manifeste lu garde les chemins du zip (ils servent à lire les fichiers).
    expect(parsed(fakeArmsManifest()).photos.get('PHOTO_A')?.arms?.arms.path).toBe('bras/PHOTO_A.webp');
  });

  it('découpe toujours les envois sous la taille maximale avec les bras pliés', () => {
    const payloads = toAssemblyPayloads(parsed(fakeArmsManifest()), USER);
    const size = JSON.stringify({ items: [payloads[0]] }).length;
    const batches = buildAssemblyBatches(payloads, size + 10);
    expect(batches.map((batch) => batch.items.map((entry) => entry.legacy_id))).toEqual([['a01'], ['a19'], ['a18']]);
  });
});
