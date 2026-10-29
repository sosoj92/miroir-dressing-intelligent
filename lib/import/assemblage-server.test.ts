import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILE_REF_COLUMNS } from '@/lib/items/cleanup';
import { fakeItemsTable, type FakeItemRow } from '@/lib/items/fake-items-table';
import {
  assemblyArmsPath,
  assemblyCutoutPath,
  assemblyPhotoPath,
  assemblySleevesPath,
  parseAssemblyManifest,
  toAssemblyPayloads,
  type AssemblyItemPayload,
} from './assemblage';
import { fakeArmsManifest, fakeManifest } from './assemblage-fixtures';
import {
  assemblyRows,
  removeReplacedFiles,
  runAssemblyImport,
  validateAssemblyBatch,
  validateAssemblyCleanup,
} from './assemblage-server';

const USER = '0b7c7a2e-5f0e-4b8e-9a51-0e3c0f6d9a11';
const OTHER = '0b7c7a2e-5f0e-4b8e-9a51-0e3c0f6d9aff';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function payloads(manifest: unknown = fakeManifest()): AssemblyItemPayload[] {
  const parsed = parseAssemblyManifest(manifest);
  if (!parsed.ok) throw new Error(parsed.error);
  return toAssemblyPayloads(parsed.manifest, USER);
}

/** Copie modifiable d'une fiche (via JSON, comme ce que reçoit la server action). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function errorOf(input: unknown): string {
  const result = validateAssemblyBatch(input, USER);
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error;
}

describe('validateAssemblyBatch', () => {
  it('accepte les fiches construites par le navigateur, sans champ en trop', () => {
    const items = payloads();
    const extra = clone(items).map((item) => ({ ...item, dirty: true, owner: OTHER, created_at: '2020-01-01' }));
    const result = validateAssemblyBatch({ items: extra }, USER);
    expect(result).toEqual({ ok: true, items });
  });

  it("refuse les chemins d'un autre compte, d'une autre photo ou d'autres manches", () => {
    const [jacket] = clone(payloads());
    expect(errorOf({ items: [{ ...jacket, photo_path: `${OTHER}/assemblage/PHOTO_A.jpg` }] })).toBe(
      'Pièce a01 : chemin refusé.',
    );
    expect(errorOf({ items: [{ ...jacket, cutout_path: `${USER}/assemblage/PHOTO_B.webp` }] })).toBe(
      'Pièce a01 : chemin refusé.',
    );
    expect(errorOf({ items: [{ ...jacket, photo_path: `${USER}/assemblage/../PHOTO_A.jpg` }] })).toBe(
      'Pièce a01 : chemin refusé.',
    );
    const sleeves = { ...jacket.assembly, sleevesPath: `${USER}/assemblage/manches/a02.webp` };
    expect(errorOf({ items: [{ ...jacket, assembly: sleeves }] })).toBe('Pièce a01 : chemin refusé.');
    // Une clé de photo hors du motif ne passe pas parseAssembly.
    const badKey = { ...jacket.assembly, photo: { ...jacket.assembly.photo, key: '../x' } };
    expect(errorOf({ items: [{ ...jacket, assembly: badKey }] })).toBe("Pièce a01 : repères d'assemblage illisibles.");
  });

  it('refuse une fiche invalide, un doublon, une liste vide ou trop longue', () => {
    const [jacket, bottom] = clone(payloads());
    expect(errorOf({ items: [{ ...jacket, warmth: 0 }] })).toBe('Pièce a01 : chaleur invalide (1, 2 ou 3 attendu).');
    expect(errorOf({ items: [{ ...jacket, assembly: { v: 2 } }] })).toBe("Pièce a01 : repères d'assemblage illisibles.");
    expect(errorOf({ items: [jacket, { ...bottom, legacy_id: 'a01', assembly: { ...bottom.assembly } }] })).toBe(
      'Identifiant de pièce en double.',
    );
    expect(errorOf({ items: [] })).toBe('Aucune pièce à importer.');
    expect(errorOf({ items: Array.from({ length: 301 }, () => jacket) })).toBe('Trop de pièces dans un envoi (300 au plus).');
    expect(errorOf(null)).toBe("Données d'import invalides.");
    expect(errorOf({ items: [{ ...jacket, legacy_id: 'g 01' }] })).toBe('Pièce n° 1 : identifiant refusé.');
  });
});

describe('assemblyRows', () => {
  it("construit des lignes uniformes, avec l'owner, sans dirty ni created_at", () => {
    const rows = assemblyRows(USER, payloads());
    expect(rows[0]).toEqual({
      owner: USER,
      legacy_id: 'a01',
      name: 'Veste test',
      category: 'veste',
      color: '#A0B0C0',
      warmth: 2,
      styles: ['decontracte'],
      rain_ok: false,
      photo_path: `${USER}/assemblage/PHOTO_A.jpg`,
      cutout_path: `${USER}/assemblage/PHOTO_A.webp`,
      assembly: expect.objectContaining({ v: 1, sleevesPath: `${USER}/assemblage/manches/a01.webp` }),
    });
    const columns = rows.map((row) => Object.keys(row).sort().join(','));
    expect(new Set(columns).size).toBe(1);
    for (const row of rows) {
      expect(row).not.toHaveProperty('dirty');
      expect(row).not.toHaveProperty('created_at');
    }
  });

  it('refuse des repères incomplets avant toute écriture', () => {
    const [jacket] = payloads();
    expect(() => assemblyRows(USER, [{ ...jacket, assembly: { ...jacket.assembly, v: 2 as 1 } }])).toThrow(
      "Pièce a01 : repères d'assemblage illisibles.",
    );
  });
});

/** Pièce déjà en base, avec les chemins de ses fichiers. */
function stored(legacy_id: string, photo: string, cutout: string, sleevesPath: string | null = null): FakeItemRow {
  return { owner: USER, legacy_id, photo_path: photo, cutout_path: cutout, assembly: sleevesPath ? { v: 1, sleevesPath } : null };
}

const PHOTO_A = assemblyPhotoPath(USER, 'PHOTO_A');
const CUTOUT_A = assemblyCutoutPath(USER, 'PHOTO_A');
const SLEEVES_G01 = assemblySleevesPath(USER, 'a01');

/**
 * Ce que fait le navigateur (assemblage-client.ts) : chaque envoi, puis, une fois le dernier écrit,
 * la fin de l'import avec les fichiers remplacés de tous les envois (finishAssemblyImport).
 */
async function importAll(client: SupabaseClient, batches: AssemblyItemPayload[][]) {
  const counts = { created: 0, updated: 0 };
  const replaced = new Set<string>();
  for (const items of batches) {
    const result = await runAssemblyImport(client, USER, items);
    counts.created += result.counts.created;
    counts.updated += result.counts.updated;
    for (const path of result.replaced) replaced.add(path);
  }
  await removeReplacedFiles(client, USER, [...replaced]);
  return counts;
}

describe('runAssemblyImport', () => {
  it('upsert sur (owner, legacy_id) et compte les pièces créées et mises à jour', async () => {
    const { client, calls, removed } = fakeItemsTable({ rows: [stored('a19', PHOTO_A, CUTOUT_A)] });
    await expect(importAll(client, [payloads()])).resolves.toEqual({ created: 2, updated: 1 });

    const lookup = calls.filter((call) => call.method === 'in');
    expect(lookup).toEqual([{ method: 'in', args: ['legacy_id', ['a01', 'a19', 'a18']] }]);
    expect(calls).toContainEqual({ method: 'eq', args: ['owner', USER] });
    expect(calls[0]).toEqual({ method: 'select', args: [`legacy_id, ${FILE_REF_COLUMNS}`] });

    const upsert = calls.find((call) => call.method === 'upsert');
    expect(upsert?.args[1]).toEqual({ onConflict: 'owner,legacy_id' });
    expect((upsert?.args[0] as Array<{ owner: string }>).every((row) => row.owner === USER)).toBe(true);
    // Mêmes fichiers qu'avant : rien à supprimer.
    expect(removed).toEqual([]);
  });

  it('rejouer le même import ne crée rien et ne supprime rien', async () => {
    const { client, removed } = fakeItemsTable({
      rows: [
        stored('a01', PHOTO_A, CUTOUT_A, SLEEVES_G01),
        stored('a19', PHOTO_A, CUTOUT_A),
        stored('a18', assemblyPhotoPath(USER, 'PHOTO_B'), assemblyCutoutPath(USER, 'PHOTO_B')),
      ],
    });
    await expect(importAll(client, [payloads()])).resolves.toEqual({ created: 0, updated: 3 });
    expect(removed).toEqual([]);
  });

  it("nouvelle photo d'une pièce : l'ancienne est supprimée, sauf si une autre pièce s'en sert", async () => {
    const own = [assemblyPhotoPath(USER, 'OLD_1'), assemblyCutoutPath(USER, 'OLD_1')];
    const shared = [assemblyPhotoPath(USER, 'OLD_2'), assemblyCutoutPath(USER, 'OLD_2')];
    const { client, removed } = fakeItemsTable({
      rows: [
        stored('a19', own[0], own[1]), // seule pièce sur OLD_1
        stored('a01', shared[0], shared[1], SLEEVES_G01),
        stored('a35', shared[0], shared[1]), // hors de l'envoi : garde OLD_2
      ],
    });
    await expect(importAll(client, [payloads()])).resolves.toEqual({ created: 1, updated: 2 });
    expect(removed).toEqual([own]);
  });

  it("après « Reprendre la photo », rejouer l'import supprime la photo à plat et les manches retirées", async () => {
    const flat = [`${USER}/11111111-2222-4333-8444-555555555555.jpg`, `${USER}/66666666-7777-4888-9999-000000000000-cutout.png`];
    const { client, removed, rows } = fakeItemsTable({
      rows: [stored('a19', flat[0], flat[1]), stored('a18', PHOTO_A, CUTOUT_A, assemblySleevesPath(USER, 'a18'))],
    });
    await expect(importAll(client, [payloads()])).resolves.toEqual({ created: 1, updated: 2 });
    expect(removed).toHaveLength(1);
    expect(new Set(removed[0])).toEqual(new Set([...flat, assemblySleevesPath(USER, 'a18')]));
    expect(rows.find((row) => row.legacy_id === 'a19')).toMatchObject({ photo_path: PHOTO_A, cutout_path: CUTOUT_A });
  });

  it("un envoi ne supprime rien lui-même : il dit quels fichiers ses pièces ne citent plus", async () => {
    const old = [assemblyPhotoPath(USER, 'OLD_1'), assemblyCutoutPath(USER, 'OLD_1')];
    const { client, removed } = fakeItemsTable({ rows: [stored('a19', old[0], old[1])] });
    await expect(runAssemblyImport(client, USER, payloads())).resolves.toEqual({
      counts: { created: 2, updated: 1 },
      replaced: old,
    });
    expect(removed).toEqual([]);
  });

  it('deux envois qui échangent des photos : rien de ce que cite le second envoi ne part après le premier', async () => {
    // En base : a19 sur PHOTO_B, a18 sur OLD_3. Le paquet met a19 sur PHOTO_A (premier envoi) et
    // a18 sur PHOTO_B (second envoi). Après le premier, plus aucune ligne ne cite PHOTO_B.
    const photoB = [assemblyPhotoPath(USER, 'PHOTO_B'), assemblyCutoutPath(USER, 'PHOTO_B')];
    const old3 = [assemblyPhotoPath(USER, 'OLD_3'), assemblyCutoutPath(USER, 'OLD_3')];
    const { client, removed, rows } = fakeItemsTable({
      rows: [stored('a19', photoB[0], photoB[1]), stored('a18', old3[0], old3[1])],
    });
    const all = payloads();
    const first = all.filter((item) => item.legacy_id !== 'a18');
    const second = all.filter((item) => item.legacy_id === 'a18');
    expect(second[0]).toMatchObject({ photo_path: photoB[0] });

    await expect(importAll(client, [first, second])).resolves.toEqual({ created: 1, updated: 2 });
    // Seuls les fichiers d'OLD_3 partent ; ceux de PHOTO_B, cités par a18, restent.
    expect(removed).toHaveLength(1);
    expect(new Set(removed[0])).toEqual(new Set(old3));
    expect(rows.find((row) => row.legacy_id === 'a18')).toMatchObject({ photo_path: photoB[0], cutout_path: photoB[1] });
  });

  it('fin de l’import : une liste bornée de chemins, sinon refus', () => {
    expect(validateAssemblyCleanup({ paths: [PHOTO_A] })).toEqual({ ok: true, paths: [PHOTO_A] });
    expect(validateAssemblyCleanup({ paths: [] })).toEqual({ ok: true, paths: [] });
    const refused = { ok: false, error: "Données d'import invalides." };
    expect(validateAssemblyCleanup(null)).toEqual(refused);
    expect(validateAssemblyCleanup({ paths: PHOTO_A })).toEqual(refused);
    expect(validateAssemblyCleanup({ paths: [PHOTO_A, 3] })).toEqual(refused);
    expect(validateAssemblyCleanup({ paths: Array.from({ length: 1801 }, () => PHOTO_A) })).toEqual(refused);
  });

  it("fin de l'import : seuls les chemins du compte que plus rien ne cite sont supprimés", async () => {
    const { client, removed } = fakeItemsTable({ rows: [stored('a19', PHOTO_A, CUTOUT_A)] });
    const unused = assemblyPhotoPath(USER, 'OLD_1');
    await removeReplacedFiles(client, USER, [PHOTO_A, unused, `${OTHER}/assemblage/OLD_1.jpg`, '../x']);
    expect(removed).toEqual([[unused]]);
  });

  it("si la relecture des fichiers échoue, l'import réussit et rien n'est supprimé", async () => {
    const { client, removed } = fakeItemsTable({
      rows: [stored('a19', assemblyPhotoPath(USER, 'OLD_1'), assemblyCutoutPath(USER, 'OLD_1'))],
      failReadsAfter: 1, // la recherche des pièces existantes passe, la garde échoue
    });
    await expect(importAll(client, [payloads()])).resolves.toEqual({ created: 2, updated: 1 });
    expect(removed).toEqual([]);
  });
});

const ARMS_A = assemblyArmsPath(USER, 'PHOTO_A', 'arms');
const BODY_A = assemblyArmsPath(USER, 'PHOTO_A', 'body');
const PHOTO_SLEEVES_A = assemblyArmsPath(USER, 'PHOTO_A', 'sleeves');

/** Pièce déjà en base sur une photo avec bras pliés (seuls les chemins comptent ici). */
function storedWithArms(legacy_id: string, key: string, sleeves = true): FakeItemRow {
  const layer = (name: 'arms' | 'body' | 'sleeves') => ({ path: assemblyArmsPath(USER, key, name), box: [0, 0, 10, 10] });
  return {
    owner: USER,
    legacy_id,
    photo_path: assemblyPhotoPath(USER, key),
    cutout_path: assemblyCutoutPath(USER, key),
    assembly: { v: 1, photo: { key, arms: { arms: layer('arms'), body: layer('body'), sleeves: sleeves ? layer('sleeves') : null } }, sleevesPath: null },
  };
}

describe('bras pliés côté serveur', () => {
  it('accepte les fiches avec bras pliés construites par le navigateur, et les écrit telles quelles', () => {
    const items = payloads(fakeArmsManifest());
    const result = validateAssemblyBatch({ items: clone(items) }, USER);
    expect(result).toEqual({ ok: true, items });
    const rows = assemblyRows(USER, items);
    expect(rows[0].assembly.photo.arms).toEqual(items[0].assembly.photo.arms);
    expect(rows[0].assembly.photo.arms?.arms.path).toBe(ARMS_A);
    expect(rows[2].assembly.photo).not.toHaveProperty('arms');
  });

  it("refuse les couches d'un autre compte, d'une autre photo, ou restées au chemin du zip", () => {
    const [jacket] = clone(payloads(fakeArmsManifest()));
    const withLayer = (name: 'arms' | 'body' | 'sleeves', path: string) => {
      const arms = { ...jacket.assembly.photo.arms!, [name]: { ...jacket.assembly.photo.arms![name]!, path } };
      return { items: [{ ...jacket, assembly: { ...jacket.assembly, photo: { ...jacket.assembly.photo, arms } } }] };
    };
    expect(errorOf(withLayer('arms', `${OTHER}/assemblage/bras/PHOTO_A.webp`))).toBe('Pièce a01 : chemin refusé.');
    expect(errorOf(withLayer('body', `${USER}/assemblage/corps/PHOTO_B.webp`))).toBe('Pièce a01 : chemin refusé.');
    expect(errorOf(withLayer('sleeves', 'manches-photo/PHOTO_A.webp'))).toBe('Pièce a01 : chemin refusé.');
    expect(errorOf(withLayer('arms', `${USER}/assemblage/corps/PHOTO_A.webp`))).toBe('Pièce a01 : chemin refusé.');
  });

  it('refuse des bras pliés illisibles au lieu de les ignorer', () => {
    const [jacket] = clone(payloads(fakeArmsManifest()));
    const arms = { ...jacket.assembly.photo.arms!, step: 4 };
    const broken = { ...jacket, assembly: { ...jacket.assembly, photo: { ...jacket.assembly.photo, arms } } };
    expect(errorOf({ items: [broken] })).toBe('Pièce a01 : bras pliés illisibles.');
    // Sans le champ, la fiche d'avant reste acceptée.
    const photo = { ...jacket.assembly.photo };
    delete photo.arms;
    expect(validateAssemblyBatch({ items: [{ ...jacket, assembly: { ...jacket.assembly, photo } }] }, USER).ok).toBe(true);
  });

  it('rejouer le même import avec bras pliés ne supprime rien', async () => {
    const { client, removed } = fakeItemsTable({
      rows: [
        { ...storedWithArms('a01', 'PHOTO_A'), assembly: payloads(fakeArmsManifest())[0].assembly },
        storedWithArms('a19', 'PHOTO_A'),
      ],
    });
    await expect(importAll(client, [payloads(fakeArmsManifest())])).resolves.toEqual({ created: 1, updated: 2 });
    expect(removed).toEqual([]);
  });

  it("réimporter un paquet sans bras pliés supprime les couches que plus aucune pièce ne cite", async () => {
    const { client, removed, rows } = fakeItemsTable({
      rows: [storedWithArms('a01', 'PHOTO_A'), storedWithArms('a19', 'PHOTO_A')],
    });
    await expect(importAll(client, [payloads()])).resolves.toEqual({ created: 1, updated: 2 });
    expect(removed).toHaveLength(1);
    expect(new Set(removed[0])).toEqual(new Set([ARMS_A, BODY_A, PHOTO_SLEEVES_A]));
    expect(rows.find((row) => row.legacy_id === 'a01')?.assembly).not.toHaveProperty('photo.arms');
  });

  it("nouvelle photo d'une pièce : ses anciennes couches restent si une autre pièce les cite", async () => {
    const { client, removed } = fakeItemsTable({
      rows: [
        storedWithArms('a19', 'OLD_1'), // seule pièce sur OLD_1 : tout part
        storedWithArms('a01', 'OLD_2'),
        storedWithArms('a35', 'OLD_2'), // hors de l'envoi : garde OLD_2 et ses couches
      ],
    });
    await expect(importAll(client, [payloads(fakeArmsManifest())])).resolves.toEqual({ created: 1, updated: 2 });
    expect(removed).toHaveLength(1);
    expect(new Set(removed[0])).toEqual(
      new Set([
        assemblyPhotoPath(USER, 'OLD_1'),
        assemblyCutoutPath(USER, 'OLD_1'),
        assemblyArmsPath(USER, 'OLD_1', 'arms'),
        assemblyArmsPath(USER, 'OLD_1', 'body'),
        assemblyArmsPath(USER, 'OLD_1', 'sleeves'),
      ]),
    );
  });
});
