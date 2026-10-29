import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportBatch } from './batches';
import { groupByColumns, runImport, sortIds } from './server';

const profile = vi.hoisted(() => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}));
vi.mock('@/lib/server/profile', () => profile);

const USER = '0b7c7a2e-5f0e-4b8e-9a51-0e3c0f6d9a11';
// 2026-10-24 à 23 h 30 à Paris = 21 h 30 UTC : « aujourd'hui » est le 24 à Paris.
const NOW = new Date('2026-10-24T21:30:00.000Z');

type Row = Record<string, unknown>;

/**
 * Base en mémoire qui imite PostgREST pour ce dont l'import a besoin : upsert sur une clé unique
 * (seules les colonnes envoyées sont mises à jour), select avec eq et in.
 */
function fakeDatabase() {
  const tables: Record<string, Row[]> = { items: [], outfit_history: [], refusals: [], outfit_plans: [] };
  const upserts: Array<{ table: string; rows: Row[]; options: Record<string, unknown> }> = [];
  let nextId = 1;
  let failOn: string | null = null;

  function keyOf(row: Row, columns: string[]) {
    return columns.map((c) => JSON.stringify(row[c])).join('|');
  }

  function upsert(table: string, rows: Row[], options: Record<string, unknown>) {
    upserts.push({ table, rows, options });
    const columns = String(options.onConflict).split(',');
    const result: Row[] = [];
    for (const row of rows) {
      const existing = tables[table].find((r) => keyOf(r, columns) === keyOf(row, columns));
      if (existing) {
        if (options.ignoreDuplicates) continue;
        Object.assign(existing, row);
        result.push(existing);
      } else {
        const id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
        const inserted = { id, photo_path: null, cutout_path: null, ...row };
        tables[table].push(inserted);
        result.push(inserted);
      }
    }
    return result;
  }

  const client = {
    from(table: string) {
      return {
        upsert(rows: Row[], options: Record<string, unknown>) {
          if (failOn === table) {
            const failed = Promise.resolve({ data: null, error: { code: '42501', message: 'refusé' } });
            return Object.assign(failed, { select: () => failed });
          }
          const result = upsert(table, rows, options);
          const done = Promise.resolve({ data: null, error: null });
          return Object.assign(done, { select: () => Promise.resolve({ data: result, error: null }) });
        },
        select() {
          const filters: Array<(row: Row) => boolean> = [];
          const query = {
            eq(column: string, value: unknown) {
              filters.push((row) => row[column] === value);
              return query;
            },
            in(column: string, values: unknown[]) {
              filters.push((row) => values.includes(row[column]));
              return query;
            },
            then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
              const data = tables[table].filter((row) => filters.every((f) => f(row)));
              return Promise.resolve({ data, error: null }).then(resolve, reject);
            },
          };
          return query;
        },
      };
    },
  };

  return {
    tables,
    upserts,
    failOn(table: string) {
      failOn = table;
    },
    supabase: client as unknown as SupabaseClient,
  };
}

function item(legacy: string, extra: Record<string, unknown> = {}) {
  return {
    legacy_id: legacy,
    name: `Pièce ${legacy}`,
    category: 'haut' as const,
    color: null,
    warmth: 2 as const,
    styles: ['decontracte' as const],
    rain_ok: false,
    dirty: false,
    created_at: '2026-07-04T16:00:00.000Z',
    ...extra,
  };
}

function fullBatch(): ImportBatch {
  return {
    items: [
      item('p_1', {
        photo_path: `${USER}/import/p_1-photo.jpg`,
        cutout_path: `${USER}/import/p_1-cutout.png`,
      }),
      item('p_2', { category: 'bas', photo_path: `${USER}/import/p_2-photo.png` }),
      item('p_3', { category: 'veste' }),
    ],
    history: [
      { date: '2026-10-01', legacy_ids: ['p_3', 'p_1', 'p_2'] },
      { date: '2026-10-02', legacy_ids: ['p_inconnue'] },
    ],
    refusals: [
      { legacy_ids: ['p_2', 'p_1'] },
      { legacy_ids: ['p_1', 'p_inconnue'] },
    ],
    plans: [
      { date: '2026-10-23', legacy_ids: ['p_1', 'p_2'], confirmed: true },
      { date: '2026-10-24', legacy_ids: ['p_1', 'p_2'], confirmed: true },
      { date: '2026-10-25', legacy_ids: ['p_3', 'p_1', 'p_inconnue'], confirmed: false },
    ],
    city: { name: 'Paris', lat: 48.8566, lon: 2.3522, timezone: 'Europe/Paris' },
  };
}

beforeEach(() => {
  profile.getProfile.mockReset().mockResolvedValue({ timezone: 'Europe/Paris' });
  profile.updateProfile.mockReset().mockResolvedValue(undefined);
});

describe('runImport', () => {
  it('écrit pièces, historique, refus, plans et ville, avec owner explicite', async () => {
    const db = fakeDatabase();
    const counts = await runImport(db.supabase, USER, fullBatch(), NOW);

    expect(counts).toEqual({ items: 3, withoutCutout: 2, history: 1, refusals: 1, plans: 2, city: 'Paris' });
    expect(profile.getProfile).toHaveBeenCalled();
    expect(profile.updateProfile).toHaveBeenCalledWith(db.supabase, USER, {
      city: 'Paris',
      lat: 48.8566,
      lon: 2.3522,
      timezone: 'Europe/Paris',
    });

    const ids = Object.fromEntries(db.tables.items.map((row) => [row.legacy_id, row.id as string]));
    expect(db.tables.items.every((row) => row.owner === USER)).toBe(true);
    expect(db.tables.outfit_history).toEqual([
      expect.objectContaining({ owner: USER, date: '2026-10-01', item_ids: [ids.p_3, ids.p_1, ids.p_2], title: null }),
    ]);
    // created_at ancien et fixe : « Recommencer » n'efface jamais un refus importé.
    expect(db.tables.refusals).toEqual([
      expect.objectContaining({ owner: USER, item_ids: sortIds([ids.p_1, ids.p_2]), created_at: '2000-01-01T00:00:00Z' }),
    ]);
    // Le 23 est passé ; le 24 (aujourd'hui à Paris, même à 23 h 30) et le 25 sont gardés.
    expect(db.tables.outfit_plans.map((row) => [row.date, row.item_ids, row.confirmed])).toEqual([
      ['2026-10-24', [ids.p_1, ids.p_2], true],
      ['2026-10-25', [ids.p_3, ids.p_1], false],
    ]);
    const refusalUpsert = db.upserts.find((u) => u.table === 'refusals');
    expect(refusalUpsert?.options).toEqual({ onConflict: 'owner,item_ids', ignoreDuplicates: true });
    expect(db.upserts.find((u) => u.table === 'items')?.options).toEqual({ onConflict: 'owner,legacy_id' });
  });

  it("rejouer l'import donne les mêmes pièces, sans doublon", async () => {
    const db = fakeDatabase();
    await runImport(db.supabase, USER, fullBatch(), NOW);
    const before = structuredClone(db.tables);
    const counts = await runImport(db.supabase, USER, fullBatch(), NOW);

    expect(counts.items).toBe(3);
    expect(db.tables.items).toEqual(before.items);
    expect(db.tables.outfit_history).toEqual(before.outfit_history);
    expect(db.tables.refusals).toEqual(before.refusals);
    expect(db.tables.outfit_plans.map((r) => r.date)).toEqual(before.outfit_plans.map((r) => r.date));
  });

  it("un import de db.json seul n'efface pas les photos déjà importées", async () => {
    const db = fakeDatabase();
    await runImport(db.supabase, USER, fullBatch(), NOW);
    const withoutImages = fullBatch();
    withoutImages.items = withoutImages.items.map((entry) => {
      const copy = { ...entry };
      delete copy.photo_path;
      delete copy.cutout_path;
      return copy;
    });
    const counts = await runImport(db.supabase, USER, withoutImages, NOW);

    const p1 = db.tables.items.find((row) => row.legacy_id === 'p_1');
    expect(p1?.photo_path).toBe(`${USER}/import/p_1-photo.jpg`);
    expect(p1?.cutout_path).toBe(`${USER}/import/p_1-cutout.png`);
    expect(counts.withoutCutout).toBe(2);
  });

  it('chaque upsert de pièces a exactement les mêmes colonnes sur toutes ses lignes', async () => {
    const db = fakeDatabase();
    await runImport(db.supabase, USER, fullBatch(), NOW);
    const itemUpserts = db.upserts.filter((u) => u.table === 'items');
    expect(itemUpserts).toHaveLength(3); // photo + détourage, photo seule, rien
    for (const { rows } of itemUpserts) {
      const shapes = new Set(rows.map((row) => Object.keys(row).sort().join(',')));
      expect(shapes.size).toBe(1);
    }
  });

  it("retrouve en base les pièces d'un envoi précédent", async () => {
    const db = fakeDatabase();
    const first = fullBatch();
    await runImport(db.supabase, USER, { ...first, history: [], refusals: [], plans: [] }, NOW);
    const counts = await runImport(
      db.supabase,
      USER,
      { items: [], history: first.history, refusals: first.refusals, plans: first.plans, city: null },
      NOW,
    );
    expect(counts).toEqual({ items: 0, withoutCutout: 0, history: 1, refusals: 1, plans: 2, city: null });
    // Sans ville dans l'envoi, « aujourd'hui » vient du fuseau du profil.
    expect(profile.getProfile).toHaveBeenCalledTimes(2);
    expect(profile.updateProfile).toHaveBeenCalledTimes(1);
  });

  it('remonte une erreur de la base', async () => {
    const db = fakeDatabase();
    db.failOn('items');
    await expect(runImport(db.supabase, USER, fullBatch(), NOW)).rejects.toEqual({ code: '42501', message: 'refusé' });
  });
});

describe('groupByColumns et sortIds', () => {
  it('regroupe par colonnes présentes, et retire les clés undefined', () => {
    const groups = groupByColumns<Record<string, unknown>>([
      { a: 1, b: 2 },
      { a: 1 },
      { b: 2, a: 3 },
      { a: 4, b: undefined },
    ]);
    expect(groups).toEqual([
      [{ a: 1, b: 2 }, { b: 2, a: 3 }],
      [{ a: 1 }, { a: 4 }],
    ]);
    expect(Object.keys(groups[1][1])).toEqual(['a']);
  });

  it('trie les uuid en minuscules', () => {
    expect(sortIds(['B0000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000000'])).toEqual([
      'a0000000-0000-4000-8000-000000000000',
      'b0000000-0000-4000-8000-000000000000',
    ]);
  });
});
