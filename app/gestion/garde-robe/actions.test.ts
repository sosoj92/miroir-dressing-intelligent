import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

// Server actions de la garde-robe, sans réseau : Supabase, fetch (fal.ai) et le SDK Claude sont simulés.
const { state, create, revalidatePath, redirect } = vi.hoisted(() => ({
  state: { supabase: null as unknown },
  create: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${path};307;` });
  }),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.supabase }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect, RedirectType: { push: 'push', replace: 'replace' } }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    beta = { messages: { create } };
  },
}));

import {
  analyzePhoto,
  createItem,
  deleteItem,
  discardUpload,
  redoCutout,
  replacePhoto,
  setDirty,
  setDirtyMany,
  updateItem,
} from './actions';
import { FILE_REF_COLUMNS, FILE_REF_FILTERS } from '@/lib/items/cleanup';
import {
  NOTICE_CUTOUT_FAILED,
  NOTICE_CUTOUT_KEY_MISSING,
  NOTICE_DRAFT_FAILED,
  NOTICE_DRAFT_KEY_MISSING,
} from '@/lib/items/pipeline';
import { EXTERNAL_URL_SECONDS } from '@/lib/server/storage';
import { cutoutPng, paintedPng } from '@/e2e/fixtures/png';

const USER = '0a1b2c3d-0000-4000-8000-00000000a11d';
const OTHER = '0a1b2c3d-0000-4000-8000-0000000000ff';
const PHOTO = `${USER}/11111111-2222-4333-8444-555555555555.jpg`;
const CUTOUT = `${USER}/66666666-7777-4888-9999-000000000000-cutout.png`;
const ITEM_ID = '22222222-3333-4444-8555-666666666666';
const DRAFT = { name: 'Jean brut', category: 'bas', color: '#1f2a44', warmth: 2, styles: ['decontracte'], rain_ok: false };

type Result = { data?: unknown; error?: unknown };

/** Requête Supabase simulée : chaque méthode renvoie la requête, et `await` donne `result`. */
function query(result: Result) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return builder;
    };
  }
  builder.single = async () => result;
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return { builder, calls };
}

/**
 * `tables` : réponse de chaque requête sur une table, ou une liste de réponses données dans
 * l'ordre des requêtes (la dernière sert ensuite pour toutes les suivantes).
 */
function fakeSupabase(
  options: { session?: boolean; tables?: Record<string, Result | Result[]>; download?: Uint8Array } = {},
) {
  const queries: Array<{ table: string; calls: Array<[string, unknown[]]> }> = [];
  const queues = new Map<string, Result[]>();
  function nextResult(table: string): Result {
    const configured = options.tables?.[table];
    if (!Array.isArray(configured)) return configured ?? { data: null, error: null };
    const queue = queues.get(table) ?? [...configured];
    queues.set(table, queue);
    return (queue.length > 1 ? queue.shift() : queue[0]) ?? { data: null, error: null };
  }
  const storage = {
    createSignedUrl: vi.fn(async (path: string) => ({
      data: { signedUrl: `https://projet.supabase.co/sign/${path}?token=jeton-factice` },
      error: null,
    })),
    upload: vi.fn(async () => ({ data: {}, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    // Fichier relu par le serveur (PNG déjà détouré envoyé par le téléphone).
    download: vi.fn(async () =>
      options.download
        ? { data: new Blob([new Uint8Array(options.download)]), error: null }
        : { data: null, error: new Error('absent') },
    ),
  };
  const client = {
    auth: {
      getClaims: async () =>
        options.session === false
          ? { data: null, error: null }
          : { data: { claims: { sub: USER, email: 'moi@example.com' } }, error: null },
    },
    storage: { from: vi.fn(() => storage) },
    from: vi.fn((table: string) => {
      const { builder, calls } = query(nextResult(table));
      queries.push({ table, calls });
      return builder;
    }),
  };
  state.supabase = client;
  return { client, storage, queries };
}

let fetchMock: ReturnType<typeof vi.fn>;
let errorLog: MockInstance;

beforeEach(() => {
  vi.stubEnv('ALLOWED_USER_ID', USER);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://projet.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'cle-publique-factice');
  vi.stubEnv('FAL_KEY', '');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  create.mockReset();
  revalidatePath.mockClear();
  redirect.mockClear();
});

afterEach(() => {
  // Jamais d'URL signée (jeton) dans les journaux.
  for (const call of errorLog.mock.calls) expect(call.join(' ')).not.toContain('jeton-factice');
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('analyzePhoto', () => {
  it('sans FAL_KEY ni ANTHROPIC_API_KEY : remarques qui nomment les variables, fiche à remplir', async () => {
    const { storage } = fakeSupabase();
    const result = await analyzePhoto(PHOTO);
    expect(result).toEqual({
      ok: true,
      photoPath: PHOTO,
      cutoutPath: null,
      cutoutUrl: null,
      draft: null,
      notices: [NOTICE_CUTOUT_KEY_MISSING, NOTICE_DRAFT_KEY_MISSING],
    });
    expect(NOTICE_CUTOUT_KEY_MISSING).toBe(
      'Détourage indisponible : FAL_KEY absente. Une photo PNG déjà détourée (fond transparent) passe sans elle.',
    );
    expect(NOTICE_DRAFT_KEY_MISSING).toBe('Fiche automatique indisponible : ANTHROPIC_API_KEY absente.');
    expect(storage.createSignedUrl).toHaveBeenCalledWith(PHOTO, EXTERNAL_URL_SECONDS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('sans session : « Connexion requise. »', async () => {
    const { storage } = fakeSupabase({ session: false });
    await expect(analyzePhoto(PHOTO)).resolves.toEqual({ ok: false, error: 'Connexion requise.' });
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it("refuse le dossier d'un autre compte et les chemins inattendus", async () => {
    const { storage } = fakeSupabase();
    for (const path of [
      `${OTHER}/11111111-2222-4333-8444-555555555555.jpg`,
      `${USER}/../${OTHER}/11111111-2222-4333-8444-555555555555.jpg`,
      `${USER}/photo.jpg`,
      CUTOUT,
      42,
      null,
    ]) {
      await expect(analyzePhoto(path as string)).resolves.toEqual({ ok: false, error: 'Photo refusée.' });
    }
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it('avec les clés : détourage copié dans le bucket et fiche proposée, dépenses enregistrées', async () => {
    vi.stubEnv('FAL_KEY', 'cle-fal-factice');
    vi.stubEnv('ANTHROPIC_API_KEY', 'cle-anthropic-factice');
    const { storage, queries } = fakeSupabase({ tables: { spend_ledger: { error: null } } });
    fetchMock.mockResolvedValueOnce(Response.json({ image: { url: 'https://v3.fal.media/files/a/b.png' } }));
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { 'content-type': 'image/png' } }),
    );
    create.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(DRAFT), citations: null }],
      usage: { input_tokens: 1500, output_tokens: 300 },
    });

    const result = await analyzePhoto(PHOTO);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notices).toEqual([]);
    expect(result.cutoutPath).toMatch(new RegExp(`^${USER}/[0-9a-f-]{36}-cutout\\.png$`));
    expect(result.cutoutUrl).toContain(result.cutoutPath);
    expect(result.draft).toMatchObject({ name: 'Jean brut', color: '#1F2A44' });

    expect(storage.upload).toHaveBeenCalledWith(result.cutoutPath, expect.any(ArrayBuffer), {
      contentType: 'image/png',
      upsert: false,
    });
    const spends = queries
      .filter((entry) => entry.table === 'spend_ledger')
      .map((entry) => entry.calls.find(([method]) => method === 'insert')?.[1][0]);
    expect(spends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ service: 'bria', cost_usd: 0.018 }),
        expect.objectContaining({ service: 'claude', cost_usd: 0.012 }),
      ]),
    );
  });

  it('PNG déjà détouré envoyé avec la photo : gardé tel quel, sans fal.ai ni dépense', async () => {
    vi.stubEnv('FAL_KEY', 'cle-fal-factice');
    const { storage, queries } = fakeSupabase({ download: cutoutPng() });
    const result = await analyzePhoto(PHOTO, CUTOUT);
    expect(result).toEqual({
      ok: true,
      photoPath: PHOTO,
      cutoutPath: CUTOUT,
      cutoutUrl: expect.stringContaining(CUTOUT),
      draft: null,
      notices: [NOTICE_DRAFT_KEY_MISSING],
    });
    expect(storage.download).toHaveBeenCalledWith(CUTOUT);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(queries.some((entry) => entry.table === 'spend_ledger')).toBe(false);
  });

  it('PNG envoyé mais sans transparence (ou illisible) : effacé, puis le détourage habituel', async () => {
    const opaque = paintedPng(40, 40, [{ x: 0, y: 0, width: 40, height: 40, rgb: [200, 30, 30] }]);
    for (const download of [opaque, undefined]) {
      const { storage } = fakeSupabase({ download, tables: { items: { data: [], error: null } } });
      const result = await analyzePhoto(PHOTO, CUTOUT);
      expect(result).toMatchObject({
        ok: true,
        cutoutPath: null,
        notices: [NOTICE_CUTOUT_KEY_MISSING, NOTICE_DRAFT_KEY_MISSING],
      });
      expect(storage.remove).toHaveBeenCalledWith([CUTOUT]);
    }
  });

  it('refuse un détourage envoyé hors du dossier ou qui n’en est pas un', async () => {
    const { storage } = fakeSupabase({ download: cutoutPng() });
    for (const path of [`${OTHER}/66666666-7777-4888-9999-000000000000-cutout.png`, PHOTO, `${USER}/x.png`, 7]) {
      await expect(analyzePhoto(PHOTO, path as string)).resolves.toEqual({ ok: false, error: 'Détourage refusé.' });
    }
    expect(storage.download).not.toHaveBeenCalled();
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it('autre erreur : remarques génériques, seul le nom de l’erreur est journalisé', async () => {
    vi.stubEnv('FAL_KEY', 'cle-fal-factice');
    vi.stubEnv('ANTHROPIC_API_KEY', 'cle-anthropic-factice');
    fakeSupabase();
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    create.mockResolvedValue({
      stop_reason: 'refusal',
      content: [],
      usage: { input_tokens: 0, output_tokens: 0 },
    });

    const result = await analyzePhoto(PHOTO);
    expect(result).toMatchObject({ ok: true, cutoutPath: null, draft: null });
    if (result.ok) expect(result.notices).toEqual([NOTICE_CUTOUT_FAILED, NOTICE_DRAFT_FAILED]);
    const logged = errorLog.mock.calls.map((call) => call.join(' '));
    expect(logged).toEqual(expect.arrayContaining([expect.stringContaining('FalError'), expect.stringContaining('ClaudeError')]));
  });
});

describe('createItem', () => {
  it('enregistre la fiche validée puis ouvre sa fiche', async () => {
    const { queries } = fakeSupabase({ tables: { items: { data: { id: ITEM_ID }, error: null } } });
    await expect(createItem({ photoPath: PHOTO, cutoutPath: CUTOUT, draft: DRAFT as never })).rejects.toThrow(
      'NEXT_REDIRECT',
    );
    const insert = queries.find((entry) => entry.table === 'items')?.calls.find(([method]) => method === 'insert');
    expect(insert?.[1][0]).toEqual({
      name: 'Jean brut',
      category: 'bas',
      color: '#1F2A44',
      warmth: 2,
      styles: ['decontracte'],
      rain_ok: false,
      photo_path: PHOTO,
      cutout_path: CUTOUT,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/gestion/garde-robe');
    // replace : le retour arrière depuis la fiche ne revient pas sur l'ajout terminé.
    expect(redirect).toHaveBeenCalledWith(`/gestion/garde-robe/${ITEM_ID}`, 'replace');
  });

  it('refuse une fiche invalide ou des chemins étrangers, sans rien écrire', async () => {
    const { queries } = fakeSupabase();
    await expect(createItem({ photoPath: PHOTO, cutoutPath: null, draft: { ...DRAFT, category: 'x' } as never })).resolves.toEqual({
      ok: false,
      error: 'Catégorie inconnue.',
    });
    await expect(
      createItem({ photoPath: PHOTO, cutoutPath: `${OTHER}/66666666-7777-4888-9999-000000000000-cutout.png`, draft: DRAFT as never }),
    ).resolves.toEqual({ ok: false, error: 'Détourage refusé.' });
    await expect(createItem({ photoPath: `${OTHER}/x.jpg`, cutoutPath: null, draft: DRAFT as never })).resolves.toEqual({
      ok: false,
      error: 'Photo refusée.',
    });
    await expect(createItem(null as never)).resolves.toEqual({ ok: false, error: 'Fiche illisible.' });
    expect(queries).toEqual([]);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('updateItem', () => {
  it('enregistre la fiche sans quitter la page : la grille et la fiche sont rafraîchies', async () => {
    const { queries } = fakeSupabase({ tables: { items: { data: [{ id: ITEM_ID }], error: null } } });
    await expect(updateItem(ITEM_ID, DRAFT as never)).resolves.toEqual({ ok: true });
    const calls = queries.find((entry) => entry.table === 'items')?.calls;
    expect(calls?.find(([method]) => method === 'update')?.[1][0]).toEqual({
      name: 'Jean brut',
      category: 'bas',
      color: '#1F2A44',
      warmth: 2,
      styles: ['decontracte'],
      rain_ok: false,
    });
    expect(calls).toContainEqual(['eq', ['id', ITEM_ID]]);
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/gestion/garde-robe');
    expect(revalidatePath).toHaveBeenCalledWith(`/gestion/garde-robe/${ITEM_ID}`);
  });

  it('refuse un id mal formé ou une fiche invalide avant toute requête', async () => {
    const { queries } = fakeSupabase();
    await expect(updateItem('pas-un-uuid', DRAFT as never)).resolves.toEqual({ ok: false, error: 'Vêtement introuvable.' });
    await expect(updateItem(ITEM_ID, { ...DRAFT, name: '  ' } as never)).resolves.toEqual({
      ok: false,
      error: 'Donne un nom au vêtement.',
    });
    expect(queries).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('pièce absente (autre compte, supprimée) : « introuvable », sans revalidation', async () => {
    fakeSupabase({ tables: { items: { data: [], error: null } } });
    await expect(updateItem(ITEM_ID, DRAFT as never)).resolves.toEqual({ ok: false, error: 'Vêtement introuvable.' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('sans session : « Connexion requise. », rien n’est écrit', async () => {
    const { queries } = fakeSupabase({ session: false });
    await expect(updateItem(ITEM_ID, DRAFT as never)).resolves.toEqual({ ok: false, error: 'Connexion requise.' });
    expect(queries).toEqual([]);
  });
});

describe('setDirty', () => {
  it('valide l’id et la valeur avant toute requête', async () => {
    const { queries } = fakeSupabase();
    await expect(setDirty('pas-un-uuid', true)).resolves.toEqual({ ok: false, error: 'Vêtement introuvable.' });
    await expect(setDirty(ITEM_ID, 'oui' as never)).resolves.toEqual({ ok: false, error: 'Valeur refusée.' });
    expect(queries).toEqual([]);
  });

  it('met à jour la pièce', async () => {
    fakeSupabase({ tables: { items: { data: [{ id: ITEM_ID }], error: null } } });
    await expect(setDirty(ITEM_ID, true)).resolves.toEqual({ ok: true, dirty: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/gestion/garde-robe/${ITEM_ID}`);
  });
});

describe('setDirtyMany', () => {
  const SECOND_ID = '33333333-4444-4555-8666-777777777777';

  it('sans session : « Connexion requise. », rien n’est écrit', async () => {
    const { queries } = fakeSupabase({ session: false });
    await expect(setDirtyMany([ITEM_ID], false)).resolves.toEqual({ ok: false, error: 'Connexion requise.' });
    expect(queries).toEqual([]);
  });

  it('valide la liste et la valeur avant toute requête', async () => {
    const { queries } = fakeSupabase();
    for (const ids of [[], [ITEM_ID, 'pas-un-uuid'], 'oui', null, Array.from({ length: 501 }, () => ITEM_ID)]) {
      await expect(setDirtyMany(ids as never, false)).resolves.toEqual({ ok: false, error: 'Vêtement introuvable.' });
    }
    await expect(setDirtyMany([ITEM_ID], 'non' as never)).resolves.toEqual({ ok: false, error: 'Valeur refusée.' });
    expect(queries).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('remet propres les pièces du compte en une requête, avec une seule revalidation', async () => {
    const { queries } = fakeSupabase({ tables: { items: { data: [{ id: ITEM_ID }, { id: SECOND_ID }], error: null } } });
    await expect(setDirtyMany([ITEM_ID, SECOND_ID, ITEM_ID], false)).resolves.toEqual({
      ok: true,
      dirty: false,
      count: 2,
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toEqual({
      table: 'items',
      calls: [
        ['update', [{ dirty: false }]],
        ['in', ['id', [ITEM_ID, SECOND_ID]]],
        ['eq', ['owner', USER]],
        ['select', ['id']],
      ],
    });
    expect(revalidatePath.mock.calls).toEqual([['/gestion/garde-robe', 'layout']]);
  });

  it('aucune pièce modifiée (autre compte, pièce supprimée) : « introuvable », sans revalidation', async () => {
    fakeSupabase({ tables: { items: { data: [], error: null } } });
    await expect(setDirtyMany([ITEM_ID], false)).resolves.toEqual({ ok: false, error: 'Vêtement introuvable.' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('erreur de la base : message court, journalisé par son nom', async () => {
    fakeSupabase({ tables: { items: { data: null, error: { name: 'PostgrestError', message: 'détail interne' } } } });
    await expect(setDirtyMany([ITEM_ID], false)).resolves.toEqual({
      ok: false,
      error: "Le changement n'a pas pu être enregistré. Réessaie.",
    });
    expect(errorLog).toHaveBeenCalledWith('setDirtyMany : PostgrestError');
  });
});

describe('redoCutout', () => {
  it('refuse une photo importée du prototype (la personne est dessus) : rien ne part chez fal.ai', async () => {
    vi.stubEnv('FAL_KEY', 'cle-fal-factice');
    const { storage } = fakeSupabase({
      tables: { items: { data: { photo_path: `${USER}/import/p_x-photo.jpg`, cutout_path: null }, error: null } },
    });
    await expect(redoCutout(ITEM_ID)).resolves.toEqual({
      ok: false,
      error: "Ce vêtement n'a pas de photo à détourer.",
    });
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuse un id mal formé avant toute requête', async () => {
    const { queries } = fakeSupabase();
    await expect(redoCutout('pas-un-uuid')).resolves.toEqual({ ok: false, error: 'Vêtement introuvable.' });
    expect(queries).toEqual([]);
  });

  it('photo à plat du téléphone : URL signée de 10 min, puis détourage (sans FAL_KEY : message qui la nomme)', async () => {
    const { storage } = fakeSupabase({
      tables: { items: { data: { photo_path: PHOTO, cutout_path: null }, error: null } },
    });
    await expect(redoCutout(ITEM_ID)).resolves.toEqual({ ok: false, error: NOTICE_CUTOUT_KEY_MISSING });
    expect(storage.createSignedUrl).toHaveBeenCalledWith(PHOTO, EXTERNAL_URL_SECONDS);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// Photo portée partagée (docs/conception.md §3.2) : une veste (avec manches) et un bas.
const WORN_PHOTO = `${USER}/assemblage/PHOTO_A.jpg`;
const WORN_CUTOUT = `${USER}/assemblage/PHOTO_A.webp`;
const SLEEVES = `${USER}/assemblage/manches/a01.webp`;
const JACKET_ROW = {
  photo_path: WORN_PHOTO,
  cutout_path: WORN_CUTOUT,
  assembly: { v: 1, photo: { key: 'PHOTO_A' }, sleevesPath: SLEEVES },
};
const BOTTOM_REFS = { photo_path: WORN_PHOTO, cutout_path: WORN_CUTOUT, sleeves_path: null };

describe('deleteItem', () => {
  it('efface la ligne puis ses fichiers, et retourne à la grille', async () => {
    const { storage, queries } = fakeSupabase({
      tables: {
        items: [
          { data: [{ photo_path: PHOTO, cutout_path: CUTOUT, assembly: null }], error: null },
          { data: [], error: null }, // aucune autre pièce n'utilise ces fichiers
        ],
      },
    });
    await expect(deleteItem(ITEM_ID)).rejects.toThrow('NEXT_REDIRECT');
    expect(storage.remove).toHaveBeenCalledWith([PHOTO, CUTOUT]);
    // Après la suppression, on relit les pièces qui citent encore ces fichiers, colonne par colonne.
    expect(queries.slice(1).map((entry) => entry.calls)).toEqual(
      FILE_REF_FILTERS.map((column) => [
        ['select', [FILE_REF_COLUMNS]],
        ['eq', ['owner', USER]],
        ['in', [column, [PHOTO, CUTOUT]]],
      ]),
    );
  });

  it("supprimer la veste garde la photo portée du bas, et n'efface que ses manches", async () => {
    const { storage } = fakeSupabase({
      tables: { items: [{ data: [JACKET_ROW], error: null }, { data: [BOTTOM_REFS], error: null }] },
    });
    await expect(deleteItem(ITEM_ID)).rejects.toThrow('NEXT_REDIRECT');
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith([SLEEVES]);
  });

  it('si les pièces restantes ne peuvent pas être relues, aucun fichier n’est effacé', async () => {
    const { storage } = fakeSupabase({
      tables: {
        items: [
          { data: [JACKET_ROW], error: null },
          { data: null, error: { name: 'PostgrestError', code: '500' } },
        ],
      },
    });
    await expect(deleteItem(ITEM_ID)).rejects.toThrow('NEXT_REDIRECT');
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('pièce absente : message, rien d’effacé', async () => {
    const { storage } = fakeSupabase({ tables: { items: { data: [], error: null } } });
    await expect(deleteItem(ITEM_ID)).resolves.toEqual({ ok: false, error: 'Vêtement introuvable.' });
    expect(storage.remove).not.toHaveBeenCalled();
  });
});

describe('replacePhoto', () => {
  it('refuse une pièce assemblée : rien ne part chez fal.ai, la pièce ne change pas', async () => {
    vi.stubEnv('FAL_KEY', 'cle-fal-factice');
    const { storage, queries } = fakeSupabase({
      tables: {
        items: [
          { data: JACKET_ROW, error: null }, // lecture des chemins actuels : la pièce a des repères
          { data: [], error: null }, // aucune pièce n'utilise la photo reçue
        ],
      },
    });

    await expect(replacePhoto(ITEM_ID, PHOTO)).resolves.toEqual({
      ok: false,
      error: 'Cette pièce se change en réimportant le paquet.',
    });
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    const calls = queries.flatMap((entry) => entry.calls);
    expect(calls.some(([method]) => method === 'update')).toBe(false);
    // Seule la photo reçue, inutilisée, est effacée ; la photo portée, son détourage et les manches restent.
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith([PHOTO]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('pièce à plat : nouvelle photo et nouveau détourage, les anciens fichiers effacés', async () => {
    vi.stubEnv('FAL_KEY', 'cle-fal-factice');
    const OLD_PHOTO = `${USER}/aaaaaaaa-2222-4333-8444-555555555555.jpg`;
    const OLD_CUTOUT = `${USER}/aaaaaaaa-7777-4888-9999-000000000000-cutout.png`;
    const { storage, queries } = fakeSupabase({
      tables: {
        items: [
          { data: { photo_path: OLD_PHOTO, cutout_path: OLD_CUTOUT, assembly: null }, error: null },
          { data: [{ id: ITEM_ID }], error: null }, // mise à jour
          { data: [], error: null }, // plus aucune pièce n'utilise les anciens fichiers
        ],
        spend_ledger: { error: null },
      },
    });
    fetchMock.mockResolvedValueOnce(Response.json({ image: { url: 'https://v3.fal.media/files/a/b.png' } }));
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { 'content-type': 'image/png' } }),
    );

    await expect(replacePhoto(ITEM_ID, PHOTO)).resolves.toEqual({ ok: true });
    const update = queries
      .filter((entry) => entry.table === 'items')
      .flatMap((entry) => entry.calls)
      .find(([method]) => method === 'update');
    expect(update?.[1][0]).toEqual({ photo_path: PHOTO, cutout_path: expect.stringMatching(/-cutout\.png$/) });
    expect(storage.remove).toHaveBeenCalledWith([OLD_PHOTO, OLD_CUTOUT]);
    expect(revalidatePath).toHaveBeenCalledWith(`/gestion/garde-robe/${ITEM_ID}`);
  });

  it('PNG déjà détouré : enregistré comme détourage sans fal.ai, les anciens fichiers effacés', async () => {
    vi.stubEnv('FAL_KEY', 'cle-fal-factice');
    const OLD_PHOTO = `${USER}/aaaaaaaa-2222-4333-8444-555555555555.jpg`;
    const OLD_CUTOUT = `${USER}/aaaaaaaa-7777-4888-9999-000000000000-cutout.png`;
    const { storage, queries } = fakeSupabase({
      download: cutoutPng(),
      tables: {
        items: [
          { data: { photo_path: OLD_PHOTO, cutout_path: OLD_CUTOUT, assembly: null }, error: null },
          { data: [{ id: ITEM_ID }], error: null }, // mise à jour
          { data: [], error: null }, // plus aucune pièce n'utilise les anciens fichiers
        ],
      },
    });

    await expect(replacePhoto(ITEM_ID, PHOTO, CUTOUT)).resolves.toEqual({ ok: true });
    const update = queries
      .filter((entry) => entry.table === 'items')
      .flatMap((entry) => entry.calls)
      .find(([method]) => method === 'update');
    expect(update?.[1][0]).toEqual({ photo_path: PHOTO, cutout_path: CUTOUT });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith([OLD_PHOTO, OLD_CUTOUT]);
  });

  it('pièce assemblée : la photo et le PNG reçus sont effacés, rien ne change', async () => {
    const { storage, queries } = fakeSupabase({
      download: cutoutPng(),
      tables: { items: [{ data: JACKET_ROW, error: null }, { data: [], error: null }] },
    });
    await expect(replacePhoto(ITEM_ID, PHOTO, CUTOUT)).resolves.toMatchObject({ ok: false });
    expect(storage.remove).toHaveBeenCalledWith([PHOTO, CUTOUT]);
    expect(storage.download).not.toHaveBeenCalled();
    expect(queries.flatMap((entry) => entry.calls).some(([method]) => method === 'update')).toBe(false);
  });

  it("id invalide : la photo reçue n'est pas effacée si une pièce l'utilise déjà", async () => {
    const { storage, queries } = fakeSupabase({
      tables: { items: { data: [{ photo_path: PHOTO, cutout_path: CUTOUT, sleeves_path: null }], error: null } },
    });
    await expect(replacePhoto('pas-un-uuid', PHOTO)).resolves.toEqual({ ok: false, error: 'Vêtement introuvable.' });
    expect(storage.remove).not.toHaveBeenCalled();
    expect(queries.every((entry) => entry.calls.some(([method]) => method === 'in'))).toBe(true);
  });

  it("détourage impossible : la photo reçue n'est effacée que si aucune pièce ne l'utilise", async () => {
    const used = fakeSupabase({
      tables: {
        items: [
          { data: { photo_path: PHOTO, cutout_path: CUTOUT, assembly: null }, error: null }, // la pièce elle-même
          { data: [{ photo_path: PHOTO, cutout_path: CUTOUT, sleeves_path: null }], error: null },
        ],
      },
    });
    await expect(replacePhoto(ITEM_ID, PHOTO)).resolves.toEqual({ ok: false, error: NOTICE_CUTOUT_KEY_MISSING });
    expect(used.storage.remove).not.toHaveBeenCalled();

    const fresh = fakeSupabase({
      tables: {
        items: [
          { data: { photo_path: `${USER}/import/p_x-photo.jpg`, cutout_path: null, assembly: null }, error: null },
          { data: [], error: null },
        ],
      },
    });
    await expect(replacePhoto(ITEM_ID, PHOTO)).resolves.toEqual({ ok: false, error: NOTICE_CUTOUT_KEY_MISSING });
    expect(fresh.storage.remove).toHaveBeenCalledTimes(1);
    expect(fresh.storage.remove).toHaveBeenCalledWith([PHOTO]);
  });
});

describe('discardUpload', () => {
  it("n'efface pas des fichiers déjà utilisés par une pièce", async () => {
    const { storage } = fakeSupabase({ tables: { items: { data: [{ id: ITEM_ID }], error: null } } });
    await expect(discardUpload(PHOTO, CUTOUT)).resolves.toEqual({ ok: true });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('efface la photo et le détourage abandonnés', async () => {
    const { storage } = fakeSupabase({ tables: { items: { data: [], error: null } } });
    await expect(discardUpload(PHOTO, CUTOUT)).resolves.toEqual({ ok: true });
    expect(storage.remove).toHaveBeenCalledWith([PHOTO, CUTOUT]);
  });
});
