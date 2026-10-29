import { describe, expect, it } from 'vitest';
import { SERVER_ERROR } from '@/components/gestion/action-errors';
import { AuthError } from '@/lib/server/auth';
import type { AssemblyPhoto, Item } from '@/lib/types';
import {
  MARK_ERROR,
  RETURN_MAX_AGE_MS,
  SIGNED_OUT,
  chosenCategory,
  decodeReturn,
  encodeReturn,
  gridImagePath,
  markFailure,
  mirrorNote,
  openedFromGrid,
  piecesLabel,
  presentCategories,
  toGridItem,
  withDirty,
  withLatest,
  type GridItem,
} from './grid';
import { itemZone } from './zone';

const USER = '0a1b2c3d-0000-4000-8000-00000000a11d';
const ITEM = '22222222-3333-4444-8555-666666666666';
const PHOTO: AssemblyPhoto = {
  key: 'PHOTO_A',
  size: [1200, 1600],
  eye: [600, 380],
  centers: [[380, 620]],
  topLow: 480,
  bottomHigh: 500,
  onePiece: false,
  tucked: false,
};

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'a',
    name: 'Jean brut',
    category: 'bas',
    color: null,
    warmth: 2,
    styles: [],
    rain_ok: false,
    dirty: false,
    photo_path: `${USER}/a.jpg`,
    cutout_path: `${USER}/a-cutout.png`,
    legacy_id: null,
    created_at: '2026-10-01T08:00:00Z',
    ...overrides,
  };
}

function grid(overrides: Partial<GridItem> = {}): GridItem {
  return {
    id: 'a',
    name: 'Jean brut',
    category: 'bas',
    dirty: false,
    src: null,
    fit: 'contain',
    zone: null,
    redoPhoto: false,
    ...overrides,
  };
}

describe('toGridItem', () => {
  const urls = new Map([
    [`${USER}/a-cutout.png`, 'https://storage.test/a-cutout.png?token=1'],
    [`${USER}/a.jpg`, 'https://storage.test/a.jpg?token=1'],
  ]);

  it('détourage : son URL signée, en contain', () => {
    expect(toGridItem(item(), urls)).toEqual({
      id: 'a',
      name: 'Jean brut',
      category: 'bas',
      dirty: false,
      src: 'https://storage.test/a-cutout.png?token=1',
      fit: 'contain',
      zone: null,
      redoPhoto: false,
    });
  });

  it('sans détourage : la photo d’origine, en cover, avec « Photo à refaire »', () => {
    expect(toGridItem(item({ cutout_path: null }), urls)).toMatchObject({
      src: 'https://storage.test/a.jpg?token=1',
      fit: 'cover',
      redoPhoto: true,
    });
  });

  it('pièce assemblée : la zone de sa photo portée, jamais « Photo à refaire »', () => {
    const assembly = { v: 1 as const, photo: PHOTO, sleevesPath: null };
    expect(toGridItem(item({ assembly }), urls)).toMatchObject({
      zone: { zone: itemZone('bas', PHOTO), size: [1200, 1600] },
      redoPhoto: false,
    });
  });

  it('sans URL signée (chemin refusé, signature en échec) : pas d’image', () => {
    expect(toGridItem(item(), new Map()).src).toBeNull();
    expect(toGridItem(item({ photo_path: null, cutout_path: null }), urls)).toMatchObject({ src: null, redoPhoto: true });
  });
});

describe('gridImagePath', () => {
  it('le détourage, sinon la photo d’origine', () => {
    expect(gridImagePath(item())).toBe(`${USER}/a-cutout.png`);
    expect(gridImagePath(item({ cutout_path: null }))).toBe(`${USER}/a.jpg`);
    expect(gridImagePath(item({ cutout_path: null, photo_path: null }))).toBeNull();
  });
});

describe('presentCategories et chosenCategory', () => {
  const items = [grid({ category: 'accessoire' }), grid({ category: 'haut' }), grid({ category: 'bas' })];

  it('catégories qui ont des pièces, dans l’ordre habituel', () => {
    expect(presentCategories(items)).toEqual(['haut', 'bas', 'accessoire']);
    expect(presentCategories([])).toEqual([]);
  });

  it('la catégorie de l’adresse si elle a des pièces, sinon la première', () => {
    const present = presentCategories(items);
    expect(chosenCategory('bas', present)).toBe('bas');
    expect(chosenCategory('robe', present)).toBe('haut');
    expect(chosenCategory('n’importe quoi', present)).toBe('haut');
    expect(chosenCategory(null, present)).toBe('haut');
    expect(chosenCategory('bas', [])).toBeNull();
  });
});

describe('mirrorNote', () => {
  it('seulement pour ce que le miroir ne propose pas, accordé', () => {
    expect(mirrorNote('accessoire')).toBe('Pas proposés sur le miroir.');
    expect(mirrorNote('chaussures')).toBe('Pas proposées sur le miroir.');
    for (const category of ['haut', 'bas', 'robe', 'veste'] as const) expect(mirrorNote(category)).toBeNull();
  });
});

describe('withDirty', () => {
  it('ne change que les pièces données', () => {
    const items = [grid({ id: 'a', dirty: true }), grid({ id: 'b', dirty: true }), grid({ id: 'c' })];
    expect(withDirty(items, ['a', 'c'], false).map((entry) => [entry.id, entry.dirty])).toEqual([
      ['a', false],
      ['b', true],
      ['c', false],
    ]);
    expect(items[0].dirty).toBe(true);
  });
});

describe('withLatest', () => {
  it('garde la liste, l’ordre et l’état au sale ; reprend les URL relues des pièces encore là', () => {
    const shown = [
      grid({ id: 'a', dirty: false, src: 'https://x/a-1' }),
      grid({ id: 'b', dirty: true, src: 'https://x/b-1' }),
      grid({ id: 'c', dirty: true, src: 'https://x/c-1' }),
    ];
    // Relue : « a » remise propre n'y est plus, « b » re-signée, « c » sans URL (signature en échec).
    const latest = [grid({ id: 'c', dirty: true, src: null }), grid({ id: 'b', dirty: true, src: 'https://x/b-2' })];
    expect(withLatest(shown, latest).map((entry) => [entry.id, entry.dirty, entry.src])).toEqual([
      ['a', false, 'https://x/a-1'],
      ['b', true, 'https://x/b-2'],
      ['c', true, 'https://x/c-1'],
    ]);
  });

  it('une pièce passée au sale ailleurs apparaît, à la fin', () => {
    const shown = [grid({ id: 'a', dirty: false, src: 'https://x/a-1' })];
    const latest = [
      grid({ id: 'd', dirty: true, src: 'https://x/d-1' }),
      grid({ id: 'e', dirty: true, src: 'https://x/e-1' }),
    ];
    expect(withLatest(shown, latest).map((entry) => [entry.id, entry.dirty])).toEqual([
      ['a', false],
      ['d', true],
      ['e', true],
    ]);
    // Liste de la visite vide (« Rien au sale. ») : les pièces relues la remplissent.
    expect(withLatest([], latest).map((entry) => entry.id)).toEqual(['d', 'e']);
  });

  it('rien de changé : les mêmes objets', () => {
    const shown = [grid({ id: 'a', src: 'https://x/a-1' })];
    expect(withLatest(shown, [grid({ id: 'a', src: 'https://x/a-1' })])[0]).toBe(shown[0]);
  });
});

describe('markFailure', () => {
  it('le texte court, sauf une session perdue', () => {
    expect(markFailure(SERVER_ERROR)).toBe(MARK_ERROR);
    expect(markFailure('La connexion a été coupée. Réessaie.')).toBe(MARK_ERROR);
    expect(markFailure(SIGNED_OUT)).toBe(SIGNED_OUT);
  });

  it('SIGNED_OUT est bien le message de requireUser() sans session', () => {
    expect(new AuthError(401).message).toBe(SIGNED_OUT);
  });
});

describe('piecesLabel', () => {
  it('accorde « pièce »', () => {
    expect(piecesLabel(1)).toBe('1 pièce');
    expect(piecesLabel(24)).toBe('24 pièces');
  });
});

describe('encodeReturn et decodeReturn', () => {
  const NOW = Date.parse('2026-10-26T08:00:00Z');

  it('relit la place gardée', () => {
    const place = { y: 1240, category: 'bas' as const, at: NOW - 60_000, to: `/gestion/garde-robe/${ITEM}` };
    expect(decodeReturn(encodeReturn(place), NOW)).toEqual(place);
  });

  it('catégorie inconnue : la place sans catégorie', () => {
    expect(decodeReturn(JSON.stringify({ y: 10, category: 'pyjama', at: NOW }), NOW)).toEqual({
      y: 10,
      category: null,
      at: NOW,
      to: null,
    });
  });

  it('page ouverte absente ou hors de l’app : la place sans page', () => {
    for (const to of [undefined, 42, '', 'gestion/garde-robe', '//exemple.com/x', 'https://exemple.com/', `/${'a'.repeat(200)}`]) {
      expect(decodeReturn(JSON.stringify({ y: 10, category: 'bas', at: NOW, to }), NOW)?.to, String(to)).toBeNull();
    }
  });

  it('absente, mal formée ou trop ancienne : null', () => {
    for (const raw of [
      null,
      '',
      'pas du json',
      '42',
      JSON.stringify({ y: -1, category: 'bas', at: NOW }),
      JSON.stringify({ y: 'haut', category: 'bas', at: NOW }),
      JSON.stringify({ y: 10, category: 'bas' }),
      JSON.stringify({ y: 10, category: 'bas', at: NOW - RETURN_MAX_AGE_MS - 1 }),
      JSON.stringify({ y: 10, category: 'bas', at: NOW + 60_000 }),
    ]) {
      expect(decodeReturn(raw, NOW), String(raw)).toBeNull();
    }
  });
});

describe('openedFromGrid', () => {
  const NOW = Date.parse('2026-10-26T08:00:00Z');
  const FICHE = `/gestion/garde-robe/${ITEM}`;

  it('vrai seulement sur la page ouverte depuis la grille', () => {
    const place = { y: 0, category: 'haut' as const, at: NOW, to: FICHE };
    expect(openedFromGrid(place, FICHE)).toBe(true);
    // Place gardée pour une autre page : la page précédente n'est pas la grille.
    expect(openedFromGrid({ ...place, to: '/gestion/garde-robe/au-sale' }, FICHE)).toBe(false);
    expect(openedFromGrid({ ...place, to: null }, FICHE)).toBe(false);
    expect(openedFromGrid(null, FICHE)).toBe(false);
  });
});
