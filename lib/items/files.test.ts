import { describe, expect, it } from 'vitest';
import { itemFiles, unusedFiles } from './files';

const USER = '0a1b2c3d-0000-4000-8000-00000000a11d';
const WORN_PHOTO = `${USER}/assemblage/PHOTO_A.jpg`;
const WORN_CUTOUT = `${USER}/assemblage/PHOTO_A.webp`;
const SLEEVES = `${USER}/assemblage/manches/a01.webp`;

// Une veste (avec manches) et un bas sont sur la même photo portée.
const JACKET = {
  photo_path: WORN_PHOTO,
  cutout_path: WORN_CUTOUT,
  assembly: { v: 1, photo: { key: 'PHOTO_A' }, sleevesPath: SLEEVES },
};
const BOTTOM = { photo_path: WORN_PHOTO, cutout_path: WORN_CUTOUT, sleeves_path: null };

describe('itemFiles', () => {
  it('liste la photo, le détourage et les manches, sans doublon', () => {
    expect(itemFiles(JACKET)).toEqual([WORN_PHOTO, WORN_CUTOUT, SLEEVES]);
    expect(itemFiles(BOTTOM)).toEqual([WORN_PHOTO, WORN_CUTOUT]);
    expect(itemFiles({ photo_path: WORN_PHOTO, cutout_path: WORN_PHOTO })).toEqual([WORN_PHOTO]);
    expect(itemFiles({ photo_path: null, cutout_path: '', assembly: 'texte' })).toEqual([]);
    // Colonne calculée `assembly->>sleevesPath` (requête des pièces restantes).
    expect(itemFiles({ photo_path: null, cutout_path: null, sleeves_path: SLEEVES })).toEqual([SLEEVES]);
  });
});

describe('unusedFiles', () => {
  it('supprimer la veste garde la photo du bas, mais pas les manches de la veste', () => {
    expect(unusedFiles(itemFiles(JACKET), [BOTTOM])).toEqual([SLEEVES]);
  });

  it('supprimer la dernière pièce d’une photo libère ses fichiers', () => {
    expect(unusedFiles(itemFiles(BOTTOM), [])).toEqual([WORN_PHOTO, WORN_CUTOUT]);
    const other = { photo_path: `${USER}/assemblage/PHOTO_B.jpg`, cutout_path: `${USER}/assemblage/PHOTO_B.webp` };
    expect(unusedFiles(itemFiles(BOTTOM), [other])).toEqual([WORN_PHOTO, WORN_CUTOUT]);
  });

  it('un fichier cité par une autre pièce, à n’importe quelle place, est gardé', () => {
    expect(unusedFiles([SLEEVES, null, undefined, SLEEVES], [{ sleeves_path: SLEEVES }])).toEqual([]);
    expect(unusedFiles([WORN_CUTOUT], [{ assembly: { sleevesPath: WORN_CUTOUT } }])).toEqual([]);
  });
});

describe('itemFiles : couches des bras pliés (docs/conception.md §3.2)', () => {
  const ARMS = `${USER}/assemblage/bras/PHOTO_A.webp`;
  const BODY = `${USER}/assemblage/corps/PHOTO_A.webp`;
  const PHOTO_SLEEVES = `${USER}/assemblage/manches-photo/PHOTO_A.webp`;
  const layer = (path: string) => ({ path, box: [0, 0, 10, 10] });
  const withArms = (sleeves: string | null) => ({
    ...JACKET,
    assembly: {
      ...JACKET.assembly,
      photo: { key: 'PHOTO_A', arms: { arms: layer(ARMS), body: layer(BODY), sleeves: sleeves ? layer(sleeves) : null } },
    },
  });

  it('liste les couches lues dans assembly.photo.arms, ou dans les colonnes calculées', () => {
    expect(itemFiles(withArms(PHOTO_SLEEVES))).toEqual([WORN_PHOTO, WORN_CUTOUT, SLEEVES, ARMS, BODY, PHOTO_SLEEVES]);
    expect(itemFiles(withArms(null))).toEqual([WORN_PHOTO, WORN_CUTOUT, SLEEVES, ARMS, BODY]);
    // Colonnes de FILE_REF_COLUMNS (requête des pièces restantes).
    expect(itemFiles({ ...BOTTOM, arms_path: ARMS, body_path: BODY, photo_sleeves_path: null })).toEqual([
      WORN_PHOTO,
      WORN_CUTOUT,
      ARMS,
      BODY,
    ]);
    // Sans bras pliés, rien de plus qu'avant.
    expect(itemFiles({ ...JACKET, assembly: { ...JACKET.assembly, photo: { key: 'PHOTO_A', arms: 'texte' } } })).toEqual(
      itemFiles(JACKET),
    );
  });

  it('supprimer la veste garde les couches de la photo tant que le bas les cite', () => {
    const bottom = { ...BOTTOM, arms_path: ARMS, body_path: BODY, photo_sleeves_path: PHOTO_SLEEVES };
    expect(unusedFiles(itemFiles(withArms(PHOTO_SLEEVES)), [bottom])).toEqual([SLEEVES]);
    expect(unusedFiles(itemFiles(withArms(PHOTO_SLEEVES)), [BOTTOM])).toEqual([SLEEVES, ARMS, BODY, PHOTO_SLEEVES]);
  });
});
