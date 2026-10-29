import { describe, expect, it } from 'vitest';
import { BATCH_LIMITS } from './batches';
import { validateImportBatch } from './validate';

const USER = '0b7c7a2e-5f0e-4b8e-9a51-0e3c0f6d9a11';
const OTHER = '6f1d1c4e-2b7a-4c55-8e0e-7d0a3c2b1f00';

function item(overrides: Record<string, unknown> = {}) {
  return {
    legacy_id: 'p_demo0001',
    name: 'Pull marine',
    category: 'haut',
    color: '#232b3e',
    warmth: 2,
    styles: ['decontracte'],
    rain_ok: false,
    dirty: false,
    created_at: '2026-07-04T16:00:00.000Z',
    photo_path: `${USER}/import/p_demo0001-photo.jpg`,
    cutout_path: `${USER}/import/p_demo0001-cutout.png`,
    ...overrides,
  };
}

function batch(overrides: Record<string, unknown> = {}) {
  return {
    items: [item()],
    history: [{ date: '2026-10-01', legacy_ids: ['p_demo0001'] }],
    refusals: [{ legacy_ids: ['p_demo0001'] }],
    plans: [{ date: '2026-10-25', legacy_ids: ['p_demo0001'], confirmed: true }],
    city: { name: 'Paris', lat: 48.8566, lon: 2.3522, timezone: 'Europe/Paris' },
    ...overrides,
  };
}

function rejected(input: unknown) {
  expect(validateImportBatch(input, USER)).toEqual({ ok: false, error: "Données d'import invalides." });
}

describe('validateImportBatch', () => {
  it('accepte un envoi correct et normalise la couleur', () => {
    const result = validateImportBatch(batch(), USER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.batch.items[0].color).toBe('#232B3E');
    expect(result.batch.items[0].photo_path).toBe(`${USER}/import/p_demo0001-photo.jpg`);
    expect(result.batch.city?.timezone).toBe('Europe/Paris');
  });

  it("n'ajoute pas de chemin absent (un db.json seul n'efface pas les photos)", () => {
    const result = validateImportBatch(
      batch({ items: [item({ photo_path: undefined, cutout_path: undefined, created_at: undefined })] }),
      USER,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.batch.items[0])).not.toContain('photo_path');
    expect(Object.keys(result.batch.items[0])).not.toContain('cutout_path');
    expect(Object.keys(result.batch.items[0])).not.toContain('created_at');
  });

  it("refuse un chemin qui n'appartient pas au compte ou à la fiche", () => {
    rejected(batch({ items: [item({ photo_path: `${OTHER}/import/p_demo0001-photo.jpg` })] }));
    rejected(batch({ items: [item({ photo_path: `${USER}/import/../p_demo0001-photo.jpg` })] }));
    rejected(batch({ items: [item({ photo_path: `${USER}/import/p_demo0002-photo.jpg` })] }));
    rejected(batch({ items: [item({ photo_path: `${USER}/import/p_demo0001-photo.svg` })] }));
    rejected(batch({ items: [item({ cutout_path: `${USER}/import/p_demo0001-cutout.jpg` })] }));
    rejected(batch({ items: [item({ cutout_path: null })] }));
  });

  it('refuse les champs hors du modèle', () => {
    rejected(batch({ items: [item({ legacy_id: '../x' })] }));
    rejected(batch({ items: [item({ name: '' })] }));
    rejected(batch({ items: [item({ name: 'x'.repeat(81) })] }));
    rejected(batch({ items: [item({ category: 'chapeau' })] }));
    rejected(batch({ items: [item({ color: 'bleu' })] }));
    rejected(batch({ items: [item({ warmth: 4 })] }));
    rejected(batch({ items: [item({ warmth: '2' })] }));
    rejected(batch({ items: [item({ styles: [] })] }));
    rejected(batch({ items: [item({ styles: ['decontracte', 'decontracte'] })] }));
    rejected(batch({ items: [item({ styles: ['quotidien'] })] }));
    rejected(batch({ items: [item({ rain_ok: 'non' })] }));
    rejected(batch({ items: [item({ dirty: undefined })] }));
    rejected(batch({ items: [item({ created_at: 'hier' })] }));
  });

  it('refuse les doublons et les dates invalides', () => {
    rejected(batch({ items: [item(), item()] }));
    rejected(batch({ history: [{ date: '2026-02-30', legacy_ids: ['p_demo0001'] }] }));
    rejected(batch({ history: [{ date: '01/10/2026', legacy_ids: ['p_demo0001'] }] }));
    rejected(
      batch({
        history: [
          { date: '2026-10-01', legacy_ids: ['p_demo0001'] },
          { date: '2026-10-01', legacy_ids: ['p_demo0001'] },
        ],
      }),
    );
    rejected(batch({ refusals: [{ legacy_ids: [] }] }));
    rejected(batch({ refusals: [{ legacy_ids: ['p_demo0001', 'p_demo0001'] }] }));
    rejected(batch({ plans: [{ date: '2026-10-25', legacy_ids: ['p_demo0001'], confirmed: 'oui' }] }));
  });

  it('refuse un envoi trop long', () => {
    const items = Array.from({ length: BATCH_LIMITS.items + 1 }, (_, i) =>
      item({ legacy_id: `p_${i}`, photo_path: undefined, cutout_path: undefined }),
    );
    rejected(batch({ items }));
  });

  it('refuse une ville invalide et une forme inattendue', () => {
    rejected(batch({ city: { name: 'Paris', lat: 48.8, lon: 2.3, timezone: 'Paris' } }));
    rejected(batch({ city: undefined }));
    rejected(batch({ items: 'non' }));
    rejected(null);
    rejected([]);
  });
});
