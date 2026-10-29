import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Server action importAssembly, sans réseau : Supabase est simulé.
const { state, revalidatePath, forgetDisplayUrls } = vi.hoisted(() => ({
  state: { supabase: null as unknown },
  revalidatePath: vi.fn(),
  forgetDisplayUrls: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.supabase }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/server/display-urls', () => ({ forgetDisplayUrls }));

import { assemblyPhotoPath, parseAssemblyManifest, toAssemblyPayloads } from '@/lib/import/assemblage';
import { fakeManifest } from '@/lib/import/assemblage-fixtures';
import { fakeItemsTable } from '@/lib/items/fake-items-table';
import { finishAssemblyImport, importAssembly } from './actions';

const USER = '0a1b2c3d-0000-4000-8000-00000000a11d';
const OTHER = '0a1b2c3d-0000-4000-8000-0000000000ff';

function payloads(userId = USER) {
  const parsed = parseAssemblyManifest(fakeManifest());
  if (!parsed.ok) throw new Error(parsed.error);
  return toAssemblyPayloads(parsed.manifest, userId);
}

function fakeSupabase(options: { session?: boolean; existing?: string[]; upsertFails?: boolean } = {}) {
  const calls: Array<[string, unknown[]]> = [];
  let upserted: Array<{ legacy_id: string }> | null = null;
  state.supabase = {
    auth: {
      getClaims: async () =>
        options.session === false ? { data: null, error: null } : { data: { claims: { sub: USER } }, error: null },
    },
    from: () => {
      const builder: Record<string, unknown> = {};
      let isUpsert = false;
      for (const method of ['select', 'eq', 'in', 'upsert']) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, args]);
          if (method === 'upsert') {
            isUpsert = true;
            upserted = args[0] as Array<{ legacy_id: string }>;
          }
          return builder;
        };
      }
      builder.then = (resolve: (value: unknown) => unknown) => {
        if (isUpsert && options.upsertFails) {
          return Promise.resolve({ data: null, error: { message: 'base indisponible' } }).then(resolve);
        }
        const data = isUpsert
          ? (upserted ?? []).map((row) => ({ legacy_id: row.legacy_id }))
          : (options.existing ?? []).map((legacy_id) => ({ legacy_id }));
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return builder;
    },
  };
  return { calls, upserted: () => upserted };
}

beforeEach(() => {
  vi.stubEnv('ALLOWED_USER_ID', USER);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://projet.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'cle-publique-factice');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  revalidatePath.mockClear();
  forgetDisplayUrls.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('importAssembly', () => {
  it('sans session : « Connexion requise. », rien n’est écrit', async () => {
    const { calls } = fakeSupabase({ session: false });
    await expect(importAssembly({ items: payloads() })).resolves.toEqual({ ok: false, error: 'Connexion requise.' });
    expect(calls).toEqual([]);
    expect(forgetDisplayUrls).not.toHaveBeenCalled();
  });

  it('refuse les chemins d’un autre compte avant toute écriture', async () => {
    const { calls } = fakeSupabase();
    await expect(importAssembly({ items: payloads(OTHER) })).resolves.toEqual({
      ok: false,
      error: 'Pièce a01 : chemin refusé.',
    });
    expect(calls).toEqual([]);
  });

  it('enregistre les pièces (upsert sur owner, legacy_id) et renvoie les compteurs', async () => {
    const supabase = fakeSupabase({ existing: ['a01'] });
    await expect(importAssembly({ items: payloads() })).resolves.toEqual({
      ok: true,
      counts: { created: 2, updated: 1 },
      replaced: [],
    });
    const rows = supabase.upserted() ?? [];
    expect(rows.map((row) => row.legacy_id)).toEqual(['a01', 'a19', 'a18']);
    expect(rows[0]).toMatchObject({ owner: USER, photo_path: `${USER}/assemblage/PHOTO_A.jpg` });
    expect(rows[0]).not.toHaveProperty('dirty');
    expect(supabase.calls).toContainEqual(['upsert', [rows, { onConflict: 'owner,legacy_id' }]]);
    expect(revalidatePath).toHaveBeenCalledWith('/gestion/garde-robe');
    // Fichiers réécrits aux mêmes chemins : les URL d'affichage déjà signées sont oubliées.
    expect(forgetDisplayUrls).toHaveBeenCalledWith(USER);
  });

  it('enregistrement en échec : les URL sont oubliées quand même (photos déjà réécrites)', async () => {
    fakeSupabase({ upsertFails: true });
    await expect(importAssembly({ items: payloads() })).resolves.toEqual({
      ok: false,
      error: "L'import a échoué. Réessaie : il reprend sans doublon.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(forgetDisplayUrls).toHaveBeenCalledWith(USER);
  });
});

describe('finishAssemblyImport', () => {
  /** Table `items` en mémoire, avec une session (ou non). */
  function withTable(session = true) {
    const table = fakeItemsTable({
      rows: [{ owner: USER, legacy_id: 'a19', photo_path: assemblyPhotoPath(USER, 'PHOTO_A'), cutout_path: null, assembly: null }],
    });
    const getClaims = async () =>
      session ? { data: { claims: { sub: USER } }, error: null } : { data: null, error: null };
    state.supabase = Object.assign(table.client, { auth: { getClaims } });
    return table;
  }

  it('sans session : « Connexion requise. », rien n’est supprimé', async () => {
    const { removed, calls } = withTable(false);
    await expect(finishAssemblyImport({ paths: [assemblyPhotoPath(USER, 'OLD_1')] })).resolves.toEqual({
      ok: false,
      error: 'Connexion requise.',
    });
    expect(calls).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('refuse une demande illisible', async () => {
    const { removed } = withTable();
    await expect(finishAssemblyImport({ paths: 'tout' })).resolves.toEqual({ ok: false, error: "Données d'import invalides." });
    expect(removed).toEqual([]);
  });

  it("supprime les fichiers remplacés que plus aucune pièce ne cite, et seulement ceux du compte", async () => {
    const { removed } = withTable();
    const unused = assemblyPhotoPath(USER, 'OLD_1');
    await expect(
      finishAssemblyImport({ paths: [unused, assemblyPhotoPath(USER, 'PHOTO_A'), `${OTHER}/assemblage/OLD_1.jpg`] }),
    ).resolves.toEqual({ ok: true });
    expect(removed).toEqual([[unused]]);
  });
});
