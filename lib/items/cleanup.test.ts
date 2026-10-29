import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILE_REF_COLUMNS, FILE_REF_FILTERS, removeUnusedItemFiles } from './cleanup';
import { fakeItemsTable, type FakeItemRow } from './fake-items-table';

const USER = '0a1b2c3d-0000-4000-8000-00000000a11d';
const OTHER = '0a1b2c3d-0000-4000-8000-0000000000ff';
const PHOTO = `${USER}/assemblage/photos/PHOTO_A.jpg`;
const CUTOUT = `${USER}/assemblage/photos/PHOTO_A.webp`;
const SLEEVES = `${USER}/assemblage/manches/a01.webp`;

/** Une veste avec manches et un bas sur la même photo portée. */
const JACKET: FakeItemRow = {
  owner: USER,
  legacy_id: 'a01',
  photo_path: PHOTO,
  cutout_path: CUTOUT,
  assembly: { v: 1, photo: { key: 'PHOTO_A' }, sleevesPath: SLEEVES },
};
const BOTTOM: FakeItemRow = { owner: USER, legacy_id: 'a19', photo_path: PHOTO, cutout_path: CUTOUT, assembly: null };

/** Pièces sans rapport, pour dépasser le plafond de lignes de PostgREST. */
function filler(count: number): FakeItemRow[] {
  return Array.from({ length: count }, (_, index) => ({
    owner: USER,
    legacy_id: `f${index}`,
    photo_path: `${USER}/autre-${index}.jpg`,
    cutout_path: null,
    assembly: null,
  }));
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('removeUnusedItemFiles', () => {
  it('supprime seulement ce que plus aucune pièce ne cite (photo partagée gardée, manches libérées)', async () => {
    const { client, removed } = fakeItemsTable({ rows: [BOTTOM] });
    await expect(removeUnusedItemFiles(client, USER, [PHOTO, CUTOUT, SLEEVES])).resolves.toEqual([SLEEVES]);
    expect(removed).toEqual([[SLEEVES]]);
  });

  it('une photo citée seulement par ses manches (colonne JSON) reste en place', async () => {
    const { client, removed } = fakeItemsTable({ rows: [{ ...JACKET, photo_path: null, cutout_path: null }] });
    await expect(removeUnusedItemFiles(client, USER, [SLEEVES])).resolves.toEqual([]);
    expect(removed).toEqual([]);
  });

  it('au-delà du plafond de lignes (max_rows), une photo encore partagée reste en place', async () => {
    // 1 200 pièces, réponses plafonnées à 1 000 : la pièce qui garde la photo est la dernière.
    const { client, removed, calls } = fakeItemsTable({ rows: [...filler(1200), BOTTOM], maxRows: 1000 });
    await expect(removeUnusedItemFiles(client, USER, [PHOTO, CUTOUT])).resolves.toEqual([]);
    expect(removed).toEqual([]);
    // Une requête par colonne, filtrée sur les candidats et sur le compte.
    expect(calls.filter((call) => call.method === 'select').map((call) => call.args[0])).toEqual(
      FILE_REF_FILTERS.map(() => FILE_REF_COLUMNS),
    );
    expect(calls.filter((call) => call.method === 'in')).toEqual(
      FILE_REF_FILTERS.map((column) => ({ method: 'in', args: [column, [PHOTO, CUTOUT]] })),
    );
    expect(calls.filter((call) => call.method === 'eq')).toEqual(
      FILE_REF_FILTERS.map(() => ({ method: 'eq', args: ['owner', USER] })),
    );
  });

  it("ne supprime jamais un chemin hors du dossier du compte, ni ne le met dans une requête", async () => {
    const { client, removed, calls } = fakeItemsTable();
    const foreign = [`${OTHER}/a.jpg`, `${USER}/../${OTHER}/a.jpg`, `${USER}/a,b).jpg`, 'a.jpg', '', null, undefined];
    await expect(removeUnusedItemFiles(client, USER, [...foreign, `${USER}/x.jpg`])).resolves.toEqual([`${USER}/x.jpg`]);
    expect(removed).toEqual([[`${USER}/x.jpg`]]);
    for (const call of calls.filter((entry) => entry.method === 'in')) expect(call.args[1]).toEqual([`${USER}/x.jpg`]);

    const empty = fakeItemsTable();
    await expect(removeUnusedItemFiles(empty.client, USER, foreign)).resolves.toEqual([]);
    expect(empty.calls).toEqual([]);
  });

  it('beaucoup de candidats : listes courtes (URL de PostgREST), sans doublon', async () => {
    const paths = Array.from({ length: 100 }, (_, index) => `${USER}/assemblage/photos/P${index}.jpg`);
    const { client, removed, calls } = fakeItemsTable({ rows: [{ owner: USER, photo_path: paths[73] }] });
    const unused = await removeUnusedItemFiles(client, USER, [...paths, ...paths]);
    expect(unused).toHaveLength(99);
    expect(unused).not.toContain(paths[73]);
    expect(removed).toEqual([unused]);
    const lists = calls.filter((call) => call.method === 'in').map((call) => call.args[1] as string[]);
    expect(lists.every((list) => list.length <= 40)).toBe(true);
    expect(new Set(lists.flat())).toEqual(new Set(paths));
  });

  it('si une lecture échoue, rien n’est supprimé', async () => {
    const { client, removed } = fakeItemsTable({ rows: [], failReadsAfter: 2 });
    await expect(removeUnusedItemFiles(client, USER, [PHOTO, CUTOUT, SLEEVES])).resolves.toEqual([]);
    expect(removed).toEqual([]);
  });
});

describe('removeUnusedItemFiles : couches des bras pliés', () => {
  const ARMS = `${USER}/assemblage/bras/PHOTO_A.webp`;
  const BODY = `${USER}/assemblage/corps/PHOTO_A.webp`;
  const PHOTO_SLEEVES = `${USER}/assemblage/manches-photo/PHOTO_A.webp`;
  const layer = (path: string) => ({ path, box: [0, 0, 10, 10] });
  const withArms = (row: FakeItemRow): FakeItemRow => ({
    ...row,
    assembly: {
      v: 1,
      photo: { key: 'PHOTO_A', arms: { arms: layer(ARMS), body: layer(BODY), sleeves: layer(PHOTO_SLEEVES) } },
      sleevesPath: null,
    },
  });

  it('une couche encore citée par une autre pièce (chemin JSON imbriqué) reste en place', async () => {
    const { client, removed, calls } = fakeItemsTable({ rows: [withArms({ ...BOTTOM, photo_path: null, cutout_path: null })] });
    await expect(removeUnusedItemFiles(client, USER, [ARMS, BODY, PHOTO_SLEEVES, SLEEVES])).resolves.toEqual([SLEEVES]);
    expect(removed).toEqual([[SLEEVES]]);
    expect(calls.filter((call) => call.method === 'in').map((call) => call.args[0])).toEqual([...FILE_REF_FILTERS]);
    expect(FILE_REF_FILTERS).toContain('assembly->photo->arms->body->>path');
  });

  it('supprimer la dernière pièce de la photo libère ses couches', async () => {
    const { client, removed } = fakeItemsTable({ rows: [] });
    await expect(removeUnusedItemFiles(client, USER, [PHOTO, CUTOUT, ARMS, BODY, PHOTO_SLEEVES])).resolves.toEqual([
      PHOTO,
      CUTOUT,
      ARMS,
      BODY,
      PHOTO_SLEEVES,
    ]);
    expect(removed).toEqual([[PHOTO, CUTOUT, ARMS, BODY, PHOTO_SLEEVES]]);
  });
});
