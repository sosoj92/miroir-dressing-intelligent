import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REUSE_SECONDS, displayUrls, forgetDisplayUrls } from './display-urls';
import { DISPLAY_URL_SECONDS } from './storage';

const USER = '0a1b2c3d-0000-4000-8000-00000000a11d';
const OTHER = '0a1b2c3d-0000-4000-8000-0000000000ff';
const A = `${USER}/a-cutout.png`;
const B = `${USER}/b.jpg`;

type Signing = { bucket: string; paths: string[]; expiresIn: number };

/** Storage simulé : chaque signature donne un jeton différent, comme Supabase. */
function fakeStorage(options: { fail?: boolean; refuse?: string[] } = {}) {
  const signings: Signing[] = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (paths: string[], expiresIn: number) => {
          signings.push({ bucket, paths, expiresIn });
          if (options.fail) return { data: null, error: { name: 'StorageApiError' } };
          const token = signings.length;
          return {
            data: paths.map((path) =>
              options.refuse?.includes(path)
                ? { path, signedUrl: '', error: 'Object not found' }
                : { path, signedUrl: `https://storage.test/${bucket}/${path}?token=${token}`, error: null },
            ),
            error: null,
          };
        },
      }),
    },
  };
  return { supabase: client as unknown as SupabaseClient, signings };
}

beforeEach(() => {
  forgetDisplayUrls();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T08:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('displayUrls', () => {
  it('resert la même URL pour le même chemin, sans signer de nouveau', async () => {
    const { supabase, signings } = fakeStorage();
    const first = await displayUrls(supabase, USER, 'items', [A, B]);
    vi.advanceTimersByTime(10 * 60 * 1000);
    const second = await displayUrls(supabase, USER, 'items', [B, A, A]);

    expect(second.get(A)).toBe(first.get(A));
    expect(second.get(B)).toBe(first.get(B));
    expect(signings).toEqual([{ bucket: 'items', paths: [A, B], expiresIn: DISPLAY_URL_SECONDS }]);
  });

  it('ne signe que les chemins qui n’ont pas encore d’URL', async () => {
    const { supabase, signings } = fakeStorage();
    await displayUrls(supabase, USER, 'items', [A]);
    const urls = await displayUrls(supabase, USER, 'items', [A, B]);

    expect(signings.map((signing) => signing.paths)).toEqual([[A], [B]]);
    expect([...urls.keys()]).toEqual([A, B]);
  });

  it('signe de nouveau après la première moitié de la vie de l’URL', async () => {
    const { supabase, signings } = fakeStorage();
    const first = await displayUrls(supabase, USER, 'items', [A]);
    vi.advanceTimersByTime(REUSE_SECONDS * 1000 - 1);
    expect((await displayUrls(supabase, USER, 'items', [A])).get(A)).toBe(first.get(A));
    vi.advanceTimersByTime(1);
    const renewed = await displayUrls(supabase, USER, 'items', [A]);

    expect(renewed.get(A)).not.toBe(first.get(A));
    expect(signings).toHaveLength(2);
    // Chaque URL envoyée reste valable au moins 30 min.
    expect(DISPLAY_URL_SECONDS - REUSE_SECONDS).toBeGreaterThanOrEqual(30 * 60);
  });

  it('ignore les chemins absents ou hors du dossier du compte, et ne les signe jamais', async () => {
    const { supabase, signings } = fakeStorage();
    const urls = await displayUrls(supabase, USER, 'items', [
      null,
      undefined,
      '',
      `${OTHER}/a.png`,
      `${USER}/../${OTHER}/a.png`,
    ]);
    expect(urls.size).toBe(0);
    expect(signings).toEqual([]);
  });

  it('ne donne jamais à un compte l’URL déjà signée pour un autre', async () => {
    const { supabase, signings } = fakeStorage();
    await displayUrls(supabase, USER, 'items', [A]);
    const urls = await displayUrls(supabase, OTHER, 'items', [A]);
    expect(urls.size).toBe(0);
    expect(signings).toHaveLength(1);
  });

  it('garde les buckets séparés', async () => {
    const { supabase, signings } = fakeStorage();
    await displayUrls(supabase, USER, 'items', [A]);
    const urls = await displayUrls(supabase, USER, 'profile', [A]);
    expect(urls.get(A)).toBe(`https://storage.test/profile/${A}?token=2`);
    expect(signings.map((signing) => signing.bucket)).toEqual(['items', 'profile']);
  });

  it('ne garde rien après une erreur, ni pour un fichier refusé', async () => {
    const failing = fakeStorage({ fail: true });
    await expect(displayUrls(failing.supabase, USER, 'items', [A])).rejects.toMatchObject({ name: 'StorageApiError' });

    const { supabase, signings } = fakeStorage({ refuse: [B] });
    const urls = await displayUrls(supabase, USER, 'items', [A, B]);
    expect([...urls.keys()]).toEqual([A]);
    await displayUrls(supabase, USER, 'items', [A, B]);
    expect(signings.map((signing) => signing.paths)).toEqual([[A, B], [B]]);
  });
});

describe('forgetDisplayUrls', () => {
  it('oublie les URL d’un compte seulement : elles sont signées de nouveau', async () => {
    const { supabase, signings } = fakeStorage();
    const other = `${OTHER}/c.png`;
    await displayUrls(supabase, USER, 'items', [A]);
    await displayUrls(supabase, OTHER, 'items', [other]);

    forgetDisplayUrls(USER);
    await displayUrls(supabase, USER, 'items', [A]);
    await displayUrls(supabase, OTHER, 'items', [other]);
    expect(signings.map((signing) => signing.paths)).toEqual([[A], [other], [A]]);
  });

  it('après un import, oublie aussi les couches des bras pliés réécrites aux mêmes chemins', async () => {
    const { supabase, signings } = fakeStorage();
    const layers = [`${USER}/assemblage/bras/PHOTO_1.webp`, `${USER}/assemblage/corps/PHOTO_1.webp`, `${USER}/assemblage/manches-photo/PHOTO_1.webp`];
    const first = await displayUrls(supabase, USER, 'items', layers);
    forgetDisplayUrls(USER);
    const second = await displayUrls(supabase, USER, 'items', layers);
    expect(signings.map((signing) => signing.paths)).toEqual([layers, layers]);
    for (const path of layers) expect(second.get(path)).not.toBe(first.get(path));
  });
});
