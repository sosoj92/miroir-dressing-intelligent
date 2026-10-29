import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callsTo, fakeSupabase } from '@/lib/mirror/fake-supabase';
import { forgetDisplayUrls } from '@/lib/server/display-urls';
import { DISPLAY_URL_SECONDS } from '@/lib/server/storage';
import { loadGridItems } from './data';

// Lecture de la grille, avec un faux client Supabase : aucune requête réseau.

const USER = '0a1b2c3d-0000-4000-8000-00000000a11d';
const OTHER = '0a1b2c3d-0000-4000-8000-0000000000ff';

function row(overrides: Record<string, unknown>) {
  return {
    name: 'Pièce',
    color: null,
    warmth: 2,
    styles: [],
    rain_ok: false,
    dirty: false,
    photo_path: null,
    cutout_path: null,
    legacy_id: null,
    created_at: '2026-10-01T08:00:00Z',
    assembly: null,
    ...overrides,
  };
}

beforeEach(() => {
  forgetDisplayUrls();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadGridItems', () => {
  it('pièces du compte, triées par catégorie, avec l’URL signée de leur image', async () => {
    const { client, calls } = fakeSupabase({
      items: {
        data: [
          row({ id: 'b1', category: 'bas', cutout_path: `${USER}/b1-cutout.png`, photo_path: `${USER}/b1.jpg` }),
          row({ id: 'h1', category: 'haut', photo_path: `${USER}/h1.jpg`, dirty: true }),
          // Chemin d'un autre compte : jamais signé, la vignette reste sans image.
          row({ id: 'h2', category: 'haut', cutout_path: `${OTHER}/h2-cutout.png` }),
          { id: 'illisible' },
        ],
        error: null,
      },
    });

    const items = await loadGridItems(client, USER);
    expect(items.map((item) => [item.id, item.category, item.dirty, item.src])).toEqual([
      ['h1', 'haut', true, `https://storage.test/${USER}/h1.jpg?token=secret`],
      ['h2', 'haut', false, null],
      ['b1', 'bas', false, `https://storage.test/${USER}/b1-cutout.png?token=secret`],
    ]);
    // Le filtre sur owner double RLS.
    expect(callsTo(calls, 'items', 'eq')).toEqual([['owner', USER]]);
    expect(callsTo(calls, 'storage:items', 'createSignedUrls')).toEqual([
      [[`${USER}/h1.jpg`, `${USER}/b1-cutout.png`], DISPLAY_URL_SECONDS],
    ]);
  });

  it('vue « au sale » : seulement les pièces au sale', async () => {
    const { client, calls } = fakeSupabase({ items: { data: [], error: null } });
    await expect(loadGridItems(client, USER, { dirtyOnly: true })).resolves.toEqual([]);
    expect(callsTo(calls, 'items', 'eq')).toEqual([
      ['owner', USER],
      ['dirty', true],
    ]);
    expect(callsTo(calls, 'storage:items', 'createSignedUrls')).toEqual([]);
  });

  it('un second rendu resert les mêmes URL, sans signer de nouveau', async () => {
    const data = [row({ id: 'b1', category: 'bas', cutout_path: `${USER}/b1-cutout.png` })];
    const { client, calls } = fakeSupabase({ items: { data, error: null } });
    const first = await loadGridItems(client, USER);
    const second = await loadGridItems(client, USER);
    expect(second[0].src).toBe(first[0].src);
    expect(callsTo(calls, 'storage:items', 'createSignedUrls')).toHaveLength(1);
  });

  it('erreur de lecture : elle remonte', async () => {
    const { client } = fakeSupabase({ items: { data: null, error: { name: 'PostgrestError' } } });
    await expect(loadGridItems(client, USER)).rejects.toMatchObject({ name: 'PostgrestError' });
  });
});
