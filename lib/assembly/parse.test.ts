import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fakeArms, fakePhoto } from '@/lib/import/assemblage-fixtures';
import { MAX_ARM_ROWS, declaresArms, parseAssembly, parseAssemblyArms, parseAssemblyPhoto } from './parse';

// Repères de référence (scripts/assemblage/ref_fixture.py, et « bras » pour les bras pliés) : tirés
// de photos portées personnelles, générés en local et jamais commités. Lus par fs et non par import
// (le fichier peut manquer, et l'inférence de type d'un JSON de cette taille ralentirait tsc) ; sans
// eux, les tests qui les lisent sont sautés.
type Reference = { photos: Record<string, Record<string, unknown>> };
function readReference(name: string): Reference | null {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return existsSync(url) ? (JSON.parse(readFileSync(url, 'utf8')) as Reference) : null;
}
const reference = readReference('reference.json');
const armsReference = readReference('arms-reference.json');

/** Photo synthétique valable (les repères de lib/import/assemblage-fixtures). */
const photo = { ...fakePhoto(), key: 'PHOTO_A' };

const SIZE: [number, number] = [1200, 1600];

describe('lib/assembly/parse', () => {
  it.skipIf(!reference)('accepte les repères de toutes les photos de référence', () => {
    for (const value of Object.values(reference!.photos)) {
      expect(parseAssemblyPhoto(value), (value as { key: string }).key).not.toBeNull();
    }
  });

  it('accepte une colonne assembly complète, avec ou sans manches', () => {
    expect(parseAssembly({ v: 1, photo, sleevesPath: null })?.photo.key).toBe(photo.key);
    expect(parseAssembly({ v: 1, photo, sleevesPath: 'u/assemblage/manches/a01.webp' })?.sleevesPath).toBe(
      'u/assemblage/manches/a01.webp',
    );
  });

  it('refuse une structure incomplète ou implausible', () => {
    expect(parseAssembly(null)).toBeNull();
    expect(parseAssembly({ v: 2, photo, sleevesPath: null })).toBeNull();
    expect(parseAssembly({ v: 1, photo, sleevesPath: '' })).toBeNull();
    expect(parseAssemblyPhoto({ ...photo, key: '../x' })).toBeNull();
    expect(parseAssemblyPhoto({ ...photo, eye: [5000, 10] })).toBeNull();
    expect(parseAssemblyPhoto({ ...photo, topLow: 'bas' })).toBeNull();
    expect(parseAssemblyPhoto({ ...photo, tucked: 1 })).toBeNull();
    expect(parseAssemblyPhoto({ ...photo, centers: [[500, 1], [400, 2]] })).toBeNull();
  });
});

describe('bras pliés (photo.arms)', () => {
  it("une photo sans bras pliés n'a pas de clé arms : elle reste celle de la version 1", () => {
    expect('arms' in parseAssemblyPhoto(photo)!).toBe(false);
    expect('arms' in parseAssemblyPhoto({ ...fakePhoto(), key: 'PHOTO_A', arms: null })!).toBe(false);
    expect(declaresArms(fakePhoto())).toBe(false);
    expect(declaresArms(fakePhoto({ arms: null }))).toBe(false);
    expect(declaresArms(fakePhoto({ arms: {} }))).toBe(true);
  });

  it.skipIf(!reference)('aucune photo de référence sans bras pliés n’a de clé arms', () => {
    for (const value of Object.values(reference!.photos)) {
      const parsed = parseAssemblyPhoto(value);
      expect(parsed && 'arms' in parsed).toBe(false);
    }
  });

  it.skipIf(!armsReference)('garde à l’identique les bras pliés de toutes les photos de référence', () => {
    let withArms = 0;
    for (const [key, value] of Object.entries(armsReference!.photos)) {
      const parsed = parseAssemblyPhoto({ ...value, key });
      expect(parsed, key).not.toBeNull();
      if (value.arms === undefined) {
        expect(parsed && 'arms' in parsed, key).toBe(false);
        continue;
      }
      withArms++;
      expect(parsed?.arms, key).toEqual(value.arms);
    }
    // Toutes, sauf les cas synthétiques « _nodata » (sans données de bras).
    expect(withArms).toBe(Object.keys(armsReference!.photos).filter((key) => !key.endsWith('_nodata')).length);
    expect(withArms).toBeGreaterThan(0);
  });

  it('lit une colonne assembly avec bras pliés, chemins Storage compris', () => {
    const arms = fakeArms('PHOTO_1', {
      arms: { path: 'u/assemblage/bras/PHOTO_1.webp', box: [360, 600, 480, 400] },
      body: { path: 'u/assemblage/corps/PHOTO_1.webp', box: [-1, 200, 1202, 1401] },
      sleeves: null,
    });
    const assembly = parseAssembly({ v: 1, photo: { ...fakePhoto(), key: 'PHOTO_1', arms }, sleevesPath: null });
    expect(assembly?.photo.arms).toEqual(arms);
    expect(parseAssemblyArms(arms, SIZE)).toEqual(arms);
  });

  // Chaque variante cassée : les bras sont ignorés, la photo reste valable (rendu d'avant).
  const broken: Array<[string, Record<string, unknown>]> = [
    ['version inconnue', { v: 2 }],
    ['pas différent', { step: 4 }],
    ['première ligne différente', { from: 200 }],
    ['champ inattendu', { extra: true }],
    ['couche absente', { body: undefined }],
    ['manches absentes (null attendu)', { sleeves: undefined }],
    ['champ en trop dans une couche', { arms: { path: 'bras/PHOTO_A.webp', box: [360, 600, 480, 400], url: 'x' } }],
    ['boîte non entière', { arms: { path: 'bras/PHOTO_A.webp', box: [360.5, 600, 480, 400] } }],
    ['boîte vide', { arms: { path: 'bras/PHOTO_A.webp', box: [360, 600, 0, 400] } }],
    ['boîte à 3 valeurs', { arms: { path: 'bras/PHOTO_A.webp', box: [360, 600, 480] } }],
    ['boîte trop à gauche', { body: { path: 'corps/PHOTO_A.webp', box: [-2, 200, 1202, 1400] } }],
    ['boîte trop large', { body: { path: 'corps/PHOTO_A.webp', box: [0, 200, 1202, 1400] } }],
    ['boîte trop basse', { body: { path: 'corps/PHOTO_A.webp', box: [0, 200, 1200, 1402] } }],
    ['chemin qui remonte', { arms: { path: '../bras/PHOTO_A.webp', box: [360, 600, 480, 400] } }],
    ['chemin pas WebP', { arms: { path: 'bras/PHOTO_A.png', box: [360, 600, 480, 400] } }],
    ['chemin vide', { arms: { path: '', box: [360, 600, 480, 400] } }],
    ['longueurs différentes', { R: [[760, 800], null, null] }],
    ['tableau vide', { L: [], R: [], sleeveL: [], sleeveR: [] }],
    ['bords inversés', { L: [[440, 400], null, null, null] }],
    ['bord hors de la photo', { L: [[400, 1300], null, null, null] }],
    ['bord négatif', { L: [[-3, 10], null, null, null] }],
    ['bord non fini', { L: [[Number.NaN, 10], null, null, null] }],
    ['bord à 3 valeurs', { L: [[1, 2, 3], null, null, null] }],
    ['bord en texte', { L: [['1', '2'], null, null, null] }],
    ['poignet en texte', { wrist: { L: 'x', R: null } }],
    ['poignet sans côté', { wrist: { L: 650 } }],
    ['poignet avec un côté de trop', { wrist: { L: 650, R: null, C: null } }],
    ['bas de manche sous la photo', { cuff: { L: 1700, R: null } }],
  ];

  it.each(broken)('ignore des bras pliés illisibles : %s', (_label, overrides) => {
    const arms = fakeArms('PHOTO_A', overrides);
    expect(parseAssemblyArms(arms, SIZE)).toBeNull();
    const parsed = parseAssemblyPhoto({ ...fakePhoto({ arms }), key: 'PHOTO_A' });
    expect(parsed).not.toBeNull();
    expect(parsed && 'arms' in parsed).toBe(false);
  });

  it('borne le nombre de lignes et refuse des lignes sous le bas de la photo', () => {
    const rows = (n: number) => Array.from({ length: n }, () => null);
    const many = { L: rows(MAX_ARM_ROWS + 1), R: rows(MAX_ARM_ROWS + 1), sleeveL: rows(MAX_ARM_ROWS + 1), sleeveR: rows(MAX_ARM_ROWS + 1) };
    expect(parseAssemblyArms(fakeArms('PHOTO_A', many), [1200, 4000])).toBeNull();
    // 271 lignes : la dernière est à 250 + 270 × 5 = 1 600 px sous les yeux, la hauteur de la photo.
    const tall = { L: rows(271), R: rows(271), sleeveL: rows(271), sleeveR: rows(271) };
    expect(parseAssemblyArms(fakeArms('PHOTO_A', tall), SIZE)).not.toBeNull();
    const taller = { L: rows(272), R: rows(272), sleeveL: rows(272), sleeveR: rows(272) };
    expect(parseAssemblyArms(fakeArms('PHOTO_A', taller), SIZE)).toBeNull();
  });
});
