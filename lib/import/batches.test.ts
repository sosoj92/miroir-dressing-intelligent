import { describe, expect, it } from 'vitest';
import {
  addCounts,
  BATCH_LIMITS,
  buildBatches,
  EMPTY_COUNTS,
  ImportTooLargeError,
  jsonBytes,
  MAX_IMPORT_BYTES,
  toItemPayload,
  type ImportBatch,
  type ImportItemPayload,
} from './batches';
import type { ImportItem } from './prototype';

const CITY = { name: 'Paris', lat: 48.8566, lon: 2.3522, timezone: 'Europe/Paris' };

function item(i: number): ImportItemPayload {
  return {
    legacy_id: `p_${String(i).padStart(8, '0')}`,
    name: `Pièce ${i}`,
    category: 'haut',
    color: '#232B3E',
    warmth: 2,
    styles: ['decontracte'],
    rain_ok: false,
    dirty: false,
    created_at: '2026-07-04T16:00:00.000Z',
  };
}

function data(items: number, history = 0): ImportBatch {
  return {
    items: Array.from({ length: items }, (_, i) => item(i)),
    history: Array.from({ length: history }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      legacy_ids: ['p_00000000'],
    })),
    refusals: [],
    plans: [],
    city: CITY,
  };
}

describe('toItemPayload', () => {
  const converted: ImportItem = {
    legacy_id: 'p_demo0001',
    name: 'Pull marine',
    category: 'haut',
    color: '#232B3E',
    warmth: 2,
    styles: ['decontracte'],
    rain_ok: false,
    dirty: false,
    created_at: null,
    photo_file: 'pull-marine.svg',
    cutout_file: null,
  };

  it("n'envoie photo_path, cutout_path et created_at que s'ils existent", () => {
    const payload = toItemPayload(converted, { photo_path: null });
    expect(payload).not.toHaveProperty('photo_path');
    expect(payload).not.toHaveProperty('cutout_path');
    expect(payload).not.toHaveProperty('created_at');
    expect(payload).not.toHaveProperty('photo_file');
  });

  it('ajoute les chemins des images envoyées', () => {
    const payload = toItemPayload(converted, { photo_path: 'u/import/p_demo0001-photo.jpg', cutout_path: 'u/c.png' });
    expect(payload.photo_path).toBe('u/import/p_demo0001-photo.jpg');
    expect(payload.cutout_path).toBe('u/c.png');
  });
});

describe('buildBatches', () => {
  it('un petit import part en un seul envoi, ville comprise', () => {
    const batches = buildBatches(data(9, 10));
    expect(batches).toHaveLength(1);
    expect(batches[0].items).toHaveLength(9);
    expect(batches[0].history).toHaveLength(10);
    expect(batches[0].city).toEqual(CITY);
  });

  it('aucun envoi ne dépasse la limite en octets, et tout est envoyé dans l’ordre', () => {
    const source = data(1200, 3000);
    const batches = buildBatches(source, 50_000);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) expect(jsonBytes(batch)).toBeLessThanOrEqual(50_000);
    expect(batches.flatMap((b) => b.items)).toEqual(source.items);
    expect(batches.flatMap((b) => b.history)).toEqual(source.history);
    // La ville part dans le premier envoi seulement.
    expect(batches.map((b) => b.city !== null)).toEqual([true, ...batches.slice(1).map(() => false)]);
    // Les pièces partent avant l'historique qui les cite.
    const lastItemBatch = batches.findLastIndex((b) => b.items.length > 0);
    const firstHistoryBatch = batches.findIndex((b) => b.history.length > 0);
    expect(lastItemBatch).toBeLessThanOrEqual(firstHistoryBatch);
  });

  it('respecte aussi le nombre maximal de pièces par envoi', () => {
    const batches = buildBatches(data(BATCH_LIMITS.items * 2 + 1));
    expect(batches.map((b) => b.items.length)).toEqual([BATCH_LIMITS.items, BATCH_LIMITS.items, 1]);
    for (const batch of batches) expect(jsonBytes(batch)).toBeLessThanOrEqual(MAX_IMPORT_BYTES);
  });

  it('reste sous 1 Mo (limite des server actions) et sous 4 Mo (docs/conception.md §3.1)', () => {
    expect(MAX_IMPORT_BYTES).toBeLessThan(1024 * 1024);
  });

  it('un import vide donne un seul envoi vide', () => {
    expect(buildBatches({ items: [], history: [], refusals: [], plans: [], city: null })).toEqual([
      { items: [], history: [], refusals: [], plans: [], city: null },
    ]);
  });

  it('refuse une entrée qui ne tient pas dans un envoi', () => {
    expect(() => buildBatches(data(1), 100)).toThrow(ImportTooLargeError);
  });
});

describe('addCounts', () => {
  it('additionne les compteurs des envois', () => {
    const first = { items: 5, withoutCutout: 2, history: 0, refusals: 0, plans: 0, city: 'Paris' };
    const second = { items: 4, withoutCutout: 4, history: 10, refusals: 1, plans: 1, city: null };
    expect(addCounts(addCounts(EMPTY_COUNTS, first), second)).toEqual({
      items: 9,
      withoutCutout: 6,
      history: 10,
      refusals: 1,
      plans: 1,
      city: 'Paris',
    });
  });
});
