import { describe, expect, it } from 'vitest';
import {
  ItemValidationError,
  MAX_NAME_LENGTH,
  checkDraft,
  isUuid,
  normalizeColor,
  normalizeDraft,
  normalizeName,
  normalizeStyles,
} from './validate';
import { cutoutPathFor, isCutoutPath, isUploadedPhotoPath, newUuid, photoPathFor } from './paths';
import { parseItemRow, sortItems } from './rows';

const VALID = {
  name: 'Pull col roulé marine',
  category: 'haut',
  color: '#1f2a44',
  warmth: 3,
  styles: ['decontracte', 'habille'],
  rain_ok: false,
};

describe('normalizeName', () => {
  it('nettoie les espaces', () => {
    expect(normalizeName('  Jean   brut \n')).toBe('Jean brut');
  });

  it('tronque à 80 caractères sans couper un caractère', () => {
    const long = 'é'.repeat(100);
    expect(normalizeName(long)).toHaveLength(MAX_NAME_LENGTH);
    const emojiLike = '\u{1F9E5}'.repeat(90); // caractère hors du plan de base (2 unités UTF-16)
    expect(Array.from(normalizeName(emojiLike))).toHaveLength(MAX_NAME_LENGTH);
  });

  it('refuse un nom vide ou absent', () => {
    expect(() => normalizeName('   ')).toThrow(ItemValidationError);
    expect(() => normalizeName(undefined)).toThrow(ItemValidationError);
    expect(() => normalizeName(42)).toThrow(ItemValidationError);
  });
});

describe('normalizeColor', () => {
  it('renvoie #RRGGBB en majuscules', () => {
    expect(normalizeColor('#1f2a44')).toBe('#1F2A44');
    expect(normalizeColor('1f2a44')).toBe('#1F2A44');
    expect(normalizeColor(' #abc ')).toBe('#AABBCC');
  });

  it('renvoie null pour tout le reste', () => {
    for (const value of ['', 'marine', '#12345', '#1234567', 'rgb(0,0,0)', null, undefined, 123]) {
      expect(normalizeColor(value), String(value)).toBeNull();
    }
  });
});

describe('normalizeStyles', () => {
  it('dédoublonne et garde l’ordre de STYLES', () => {
    expect(normalizeStyles(['sport', 'decontracte', 'sport'])).toEqual(['decontracte', 'sport']);
  });

  it('refuse une liste vide, un style inconnu ou autre chose qu’une liste', () => {
    expect(() => normalizeStyles([])).toThrow('Choisis au moins un style.');
    expect(() => normalizeStyles(['decontracte', 'quotidien'])).toThrow('Style inconnu.');
    expect(() => normalizeStyles('sport')).toThrow(ItemValidationError);
  });
});

describe('normalizeDraft', () => {
  it('accepte une fiche complète et la normalise', () => {
    expect(normalizeDraft(VALID)).toEqual({
      name: 'Pull col roulé marine',
      category: 'haut',
      color: '#1F2A44',
      warmth: 3,
      styles: ['decontracte', 'habille'],
      rain_ok: false,
    });
  });

  it('une couleur invalide devient « aucune » au lieu de refuser la fiche', () => {
    expect(normalizeDraft({ ...VALID, color: 'bleu' }).color).toBeNull();
    expect(normalizeDraft({ ...VALID, color: null }).color).toBeNull();
  });

  it('ignore les champs en trop', () => {
    expect(normalizeDraft({ ...VALID, owner: 'quelqu’un', dirty: true })).not.toHaveProperty('owner');
  });

  it('refuse les valeurs inconnues', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...VALID, category: 'pantalon' }, 'Catégorie inconnue.'],
      [{ ...VALID, warmth: 4 }, 'Chaleur inconnue.'],
      [{ ...VALID, warmth: '2' }, 'Chaleur inconnue.'],
      [{ ...VALID, warmth: 2.5 }, 'Chaleur inconnue.'],
      [{ ...VALID, styles: ['chic'] }, 'Style inconnu.'],
      [{ ...VALID, styles: [] }, 'Choisis au moins un style.'],
      [{ ...VALID, rain_ok: 'oui' }, 'Indique si le vêtement supporte la pluie.'],
      [{ ...VALID, name: '' }, 'Donne un nom au vêtement.'],
    ];
    for (const [input, message] of cases) {
      expect(() => normalizeDraft(input), message).toThrow(message);
    }
  });

  it('refuse ce qui n’est pas un objet', () => {
    for (const input of [null, undefined, 'fiche', [VALID]]) {
      expect(() => normalizeDraft(input)).toThrow('Fiche illisible.');
    }
  });

  it('checkDraft renvoie le message au lieu de lever une erreur', () => {
    expect(checkDraft({ ...VALID, category: 'x' })).toEqual({ ok: false, error: 'Catégorie inconnue.' });
    expect(checkDraft(VALID)).toMatchObject({ ok: true, draft: { color: '#1F2A44' } });
  });
});

describe('isUuid', () => {
  it('reconnaît un uuid et refuse le reste', () => {
    expect(isUuid('0a1b2c3d-0000-4000-8000-00000000a11d')).toBe(true);
    expect(isUuid('0A1B2C3D-0000-4000-8000-00000000A11D')).toBe(true);
    for (const value of ['', '42', 'nouveau', '0a1b2c3d-0000-4000-8000-00000000a11d/x', null, 7]) {
      expect(isUuid(value), String(value)).toBe(false);
    }
  });
});

describe('chemins du bucket items', () => {
  const USER = '0a1b2c3d-0000-4000-8000-0000000000aa';
  const ID = '11111111-2222-4333-8444-555555555555';

  it('reconnaît les chemins fabriqués par l’app', () => {
    expect(isUploadedPhotoPath(USER, photoPathFor(USER, ID))).toBe(true);
    expect(isCutoutPath(USER, cutoutPathFor(USER, ID))).toBe(true);
  });

  it('refuse les autres dossiers et les autres formes', () => {
    const other = '00000000-0000-4000-8000-000000000000';
    expect(isUploadedPhotoPath(USER, photoPathFor(other, ID))).toBe(false);
    expect(isUploadedPhotoPath(USER, cutoutPathFor(USER, ID))).toBe(false);
    expect(isCutoutPath(USER, photoPathFor(USER, ID))).toBe(false);
    expect(isUploadedPhotoPath(USER, `${USER}/../${other}/${ID}.jpg`)).toBe(false);
    expect(isUploadedPhotoPath(USER, `${USER}/import/${ID}.jpg`)).toBe(false);
    expect(isUploadedPhotoPath(USER, null)).toBe(false);
  });

  it('newUuid fabrique un uuid v4', () => {
    expect(newUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('lignes items', () => {
  it('parseItemRow lit une ligne et ignore ce qui ne ressemble pas à une pièce', () => {
    const row = {
      id: 'a',
      name: 'Jean',
      category: 'bas',
      color: '#112233',
      warmth: 2,
      styles: ['sport', 'inconnu'],
      rain_ok: true,
      dirty: false,
      photo_path: 'u/p.jpg',
      cutout_path: null,
      legacy_id: null,
      created_at: '2026-10-24T08:00:00Z',
    };
    expect(parseItemRow(row)).toMatchObject({ category: 'bas', styles: ['sport'], cutout_path: null });
    expect(parseItemRow({ ...row, category: 'pantalon' })).toBeNull();
    expect(parseItemRow(null)).toBeNull();
  });

  it('sortItems range par catégorie puis de la plus récente à la plus ancienne', () => {
    const items = [
      { id: '1', category: 'veste', created_at: '2026-10-01T00:00:00Z' },
      { id: '2', category: 'haut', created_at: '2026-10-01T00:00:00Z' },
      { id: '3', category: 'accessoire', created_at: '2026-10-03T00:00:00Z' },
      { id: '4', category: 'haut', created_at: '2026-10-05T00:00:00Z' },
      { id: '5', category: 'bas', created_at: '2026-10-02T00:00:00Z' },
    ] as const;
    expect(sortItems(items).map((item) => item.id)).toEqual(['4', '2', '5', '1', '3']);
  });
});
