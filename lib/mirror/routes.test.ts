import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@/lib/types';
import { callsTo, fakeSupabase, type FakeResult } from './fake-supabase';
import { VERSION_ITEM_COLUMNS } from './version';

// Routes /api/miroir/* avec session, profil et base simulés : aucun réseau.
const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  client: { current: null as unknown },
}));

vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('@/lib/server/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/auth')>()),
  requireUser: mocks.requireUser,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks.client.current }));
vi.mock('@/lib/server/profile', () => ({ getProfile: mocks.getProfile, updateProfile: mocks.updateProfile }));
vi.mock('@/lib/weather', () => ({ fetchDayWeather: async () => null }));

import { AuthError } from '@/lib/server/auth';
import { GET as getMirror } from '@/app/api/miroir/route';
import { POST as accept } from '@/app/api/miroir/accepter/route';
import { POST as refuse } from '@/app/api/miroir/refuser/route';
import { POST as restart } from '@/app/api/miroir/recommencer/route';
import { GET as getKeys, POST as saveKeys } from '@/app/api/miroir/touches/route';

const USER = '0a1b2c3d-0000-4000-8000-00000000a11d';
const A = '0a1b2c3d-0000-4000-8000-00000000000a';
const B = '0a1b2c3d-0000-4000-8000-00000000000b';

const PROFILE: Profile = {
  photo_path: null,
  city: 'Paris',
  lat: 48.8566,
  lon: 2.3522,
  timezone: 'Europe/Paris',
  key_map: {},
  key_test_requested: false,
  gestures_enabled: true,
  gesture_sensitivity: 1,
  tryon_cap_eur: 12,
  evening_hour: 18,
};

function useDatabase(results: Record<string, FakeResult | FakeResult[]>) {
  const fake = fakeSupabase(results);
  mocks.client.current = fake.client;
  return fake.calls;
}

function post(body: unknown): Request {
  return new Request('http://localhost/api/miroir', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const OWNED = { items: { data: [{ id: A }, { id: B }], error: null } };

/**
 * Ce que renvoie PostgREST pour VERSION_ITEM_COLUMNS, lu depuis la liste des colonnes : les
 * colonnes simples telles quelles, et `alias:assembly->a->b` comme `->` (null dès qu'un niveau
 * manque ou n'est pas un objet).
 */
function postgrestProjection(row: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const column of VERSION_ITEM_COLUMNS.split(', ')) {
    const [alias, path] = column.includes(':') ? column.split(':') : [column, column];
    const [first, ...keys] = path.split('->');
    let value: unknown = row[first];
    for (const key of keys) {
      value = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : null;
    }
    projected[alias] = value ?? null;
  }
  return projected;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T10:00:00Z')); // midi à Paris
  mocks.requireUser.mockReset().mockResolvedValue({ id: USER, email: null });
  mocks.getProfile.mockReset().mockResolvedValue(PROFILE);
  mocks.updateProfile.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('authentification', () => {
  it('sans session : 401 partout, sans toucher à la base', async () => {
    mocks.requireUser.mockRejectedValue(new AuthError(401));
    const calls = useDatabase({});
    for (const response of [
      await getMirror(),
      await accept(post({ date: '2026-10-24', item_ids: [A] })),
      await refuse(post({ item_ids: [A] })),
      await restart(post({ date: '2026-10-24', today: '2026-10-24' })),
      await getKeys(),
      await saveKeys(post({ keyMap: {} })),
    ]) {
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(calls).toEqual([]);
  });

  it('autre compte : 403', async () => {
    mocks.requireUser.mockRejectedValue(new AuthError(403));
    useDatabase({});
    expect((await getMirror()).status).toBe(403);
  });
});

describe('GET /api/miroir', () => {
  it('renvoie les données, jamais mises en cache', async () => {
    useDatabase({ items: { data: [], error: null } });
    const response = await getMirror();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ today: '2026-10-24', targetDate: '2026-10-24', items: [] });
  });

  it('une erreur de base donne 500 sans détail', async () => {
    useDatabase({ items: { data: null, error: new Error('relation "items" does not exist') } });
    const response = await getMirror();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Erreur du serveur.' });
  });
});

describe('POST /api/miroir/accepter', () => {
  it('aujourd’hui : upsert outfit_history (owner, date)', async () => {
    const calls = useDatabase(OWNED);
    const response = await accept(post({ date: '2026-10-24', item_ids: [A, B], title: 'Pull et jean' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, saved: 'history' });
    expect(callsTo(calls, 'outfit_history', 'upsert')).toEqual([
      [{ owner: USER, date: '2026-10-24', item_ids: [A, B], title: 'Pull et jean' }, { onConflict: 'owner,date' }],
    ]);
    expect(callsTo(calls, 'outfit_plans', 'upsert')).toEqual([]);
  });

  it('demain : upsert outfit_plans avec confirmed à vrai', async () => {
    vi.setSystemTime(new Date('2026-10-24T17:30:00Z')); // 19 h 30 à Paris
    const calls = useDatabase(OWNED);
    const response = await accept(post({ date: '2026-10-25', item_ids: [A, B] }));
    expect(await response.json()).toEqual({ ok: true, saved: 'plan' });
    const [[row, options]] = callsTo(calls, 'outfit_plans', 'upsert') as [[Record<string, unknown>, unknown]];
    expect(row).toMatchObject({ owner: USER, date: '2026-10-25', item_ids: [A, B], confirmed: true });
    expect(options).toEqual({ onConflict: 'owner,date' });
  });

  it('« Prête pour demain » reçue après minuit : outfit_plans du jour, pas l’historique', async () => {
    vi.setSystemTime(new Date('2026-10-24T22:10:00Z')); // 0 h 10 à Paris, le 25
    const calls = useDatabase(OWNED);
    const response = await accept(post({ date: '2026-10-25', item_ids: [A, B], target: 'plan' }));
    expect(await response.json()).toEqual({ ok: true, saved: 'plan' });
    const [[row]] = callsTo(calls, 'outfit_plans', 'upsert') as [[Record<string, unknown>]];
    expect(row).toMatchObject({ owner: USER, date: '2026-10-25', item_ids: [A, B], confirmed: true });
    expect(callsTo(calls, 'outfit_history', 'upsert')).toEqual([]);
  });

  it('« Bonne journée » reçue après minuit : historique de la veille', async () => {
    vi.setSystemTime(new Date('2026-10-24T22:10:00Z')); // 0 h 10 à Paris, le 25
    const calls = useDatabase(OWNED);
    const response = await accept(post({ date: '2026-10-24', item_ids: [A, B], title: 'Pull et jean', target: 'history' }));
    expect(await response.json()).toEqual({ ok: true, saved: 'history' });
    expect(callsTo(calls, 'outfit_history', 'upsert')).toEqual([
      [{ owner: USER, date: '2026-10-24', item_ids: [A, B], title: 'Pull et jean' }, { onConflict: 'owner,date' }],
    ]);
  });

  it('refuse une date passée ou lointaine', async () => {
    useDatabase(OWNED);
    for (const date of ['2026-10-23', '2026-10-26']) {
      const response = await accept(post({ date, item_ids: [A] }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false });
    }
  });

  it('refuse une pièce qui n’appartient pas au compte', async () => {
    const calls = useDatabase({ items: { data: [{ id: A }], error: null } });
    const response = await accept(post({ date: '2026-10-24', item_ids: [A, B] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'Pièce inconnue.' });
    expect(callsTo(calls, 'outfit_history', 'upsert')).toEqual([]);
  });

  it('refuse un corps illisible avec 400, pas 500', async () => {
    useDatabase(OWNED);
    const response = await accept(post('{pas du json'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'Requête invalide.' });
  });
});

describe('POST /api/miroir/refuser', () => {
  it('ids triés, upsert ignoreDuplicates', async () => {
    const calls = useDatabase(OWNED);
    const response = await refuse(post({ item_ids: [B, A] }));
    expect(response.status).toBe(200);
    expect(callsTo(calls, 'refusals', 'upsert')).toEqual([
      [{ owner: USER, item_ids: [A, B] }, { onConflict: 'owner,item_ids', ignoreDuplicates: true }],
    ]);
  });

  it('refuse des ids qui ne sont pas des uuid', async () => {
    useDatabase(OWNED);
    expect((await refuse(post({ item_ids: ['1 or 1=1'] }))).status).toBe(400);
  });
});

describe('POST /api/miroir/recommencer', () => {
  it('aujourd’hui : efface le plan, la tenue portée et les refus faits pendant ce choix', async () => {
    const calls = useDatabase({
      refusals: [
        {
          data: [
            { id: 'r-matin', item_ids: [A], created_at: '2026-10-24T06:00:00Z' },
            // La veille après 18 h, le miroir proposait déjà le 24 : ce refus est de ce choix.
            { id: 'r-veille', item_ids: [B], created_at: '2026-10-23T21:30:00Z' },
            { id: 'r-nuit', item_ids: [A, B], created_at: '2026-10-23T22:30:00Z' }, // 0 h 30 à Paris, le 24
            { id: 'r-apres-midi', item_ids: [B, A], created_at: '2026-10-23T14:00:00Z' }, // choix du 23 : reste
          ],
          error: null,
        },
        { data: null, error: null },
      ],
    });
    const response = await restart(post({ date: '2026-10-24', today: '2026-10-24' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(callsTo(calls, 'outfit_plans', 'delete')).toHaveLength(1);
    expect(callsTo(calls, 'outfit_plans', 'eq')).toEqual([
      ['owner', USER],
      ['date', '2026-10-24'],
    ]);
    expect(callsTo(calls, 'outfit_history', 'delete')).toHaveLength(1);
    expect(callsTo(calls, 'outfit_history', 'eq')).toEqual([
      ['owner', USER],
      ['date', '2026-10-24'],
    ]);
    expect(callsTo(calls, 'refusals', 'delete')).toHaveLength(1);
    expect(callsTo(calls, 'refusals', 'in')).toEqual([['id', ['r-matin', 'r-veille', 'r-nuit']]]);
  });

  it('demain : la tenue portée et les refus du matin restent ; ceux du soir partent', async () => {
    vi.setSystemTime(new Date('2026-10-24T17:30:00Z')); // 19 h 30 à Paris
    const calls = useDatabase({
      refusals: [
        {
          data: [
            { id: 'r-matin', item_ids: [A], created_at: '2026-10-24T06:00:00Z' },
            { id: 'r-soir', item_ids: [B], created_at: '2026-10-24T16:45:00Z' }, // 18 h 45 à Paris
          ],
          error: null,
        },
        { data: null, error: null },
      ],
    });
    const response = await restart(post({ date: '2026-10-25', today: '2026-10-24' }));
    expect(response.status).toBe(200);
    expect(callsTo(calls, 'outfit_plans', 'eq')).toEqual([
      ['owner', USER],
      ['date', '2026-10-25'],
    ]);
    expect(callsTo(calls, 'outfit_history', 'delete')).toEqual([]);
    expect(callsTo(calls, 'refusals', 'in')).toEqual([['id', ['r-soir']]]);
  });

  it('sans refus de ce choix, aucun refus n’est effacé', async () => {
    const calls = useDatabase({ refusals: { data: [{ id: 'r-ancien', item_ids: [A], created_at: '2026-10-22T08:00:00Z' }], error: null } });
    expect((await restart(post({ date: '2026-10-24', today: '2026-10-24' }))).status).toBe(200);
    expect(callsTo(calls, 'refusals', 'delete')).toEqual([]);
  });

  it('reçu après minuit : les refus du jour que la tablette affichait', async () => {
    vi.setSystemTime(new Date('2026-10-24T22:10:00Z')); // 0 h 10 à Paris, le 25
    const calls = useDatabase({
      refusals: [{ data: [{ id: 'r-soir', created_at: '2026-10-24T19:00:00Z' }], error: null }, { data: null, error: null }],
    });
    const response = await restart(post({ date: '2026-10-25', today: '2026-10-24' }));
    expect(response.status).toBe(200);
    expect(callsTo(calls, 'refusals', 'in')).toEqual([['id', ['r-soir']]]);
  });

  it('refuse une date passée ou lointaine, sans rien effacer', async () => {
    const calls = useDatabase({});
    for (const body of [
      { date: '2026-10-26', today: '2026-10-24' },
      { date: '2026-10-22', today: '2026-10-22' },
      { date: '2026-10-24' },
    ]) {
      const response = await restart(post(body));
      expect(response.status).toBe(400);
    }
    expect(callsTo(calls, 'outfit_plans', 'delete')).toEqual([]);
    expect(callsTo(calls, 'refusals', 'delete')).toEqual([]);
  });

  it('une erreur de base donne 500 sans détail', async () => {
    useDatabase({ outfit_plans: { data: null, error: new Error('permission denied for table outfit_plans') } });
    const response = await restart(post({ date: '2026-10-24', today: '2026-10-24' }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Erreur du serveur.' });
  });
});

describe('/api/miroir/touches', () => {
  const keyMap = {
    next: { code: 'KeyD', key: 'd' },
    previous: { code: 'KeyA', key: 'a' },
    bottomNext: { code: 'KeyW', key: 'w' },
    bottomPrevious: { code: 'KeyS', key: 's' },
    jacket: { code: 'KeyV', key: 'v' },
    accept: { code: 'KeyJ', key: 'j' },
    refuse: { code: 'KeyK', key: 'k' },
    restart: { code: 'KeyL', key: 'l' },
  };

  it('GET : l’empreinte des données et le nombre de refus, sans URL ni repères lourds', async () => {
    const calls = useDatabase({ refusals: { data: null, error: null, count: 3 } });
    // Plus de demande de test des touches depuis le téléphone (fin de la manette) : un ancien
    // key_test_requested resté vrai n'est plus renvoyé.
    mocks.getProfile.mockResolvedValue({ ...PROFILE, key_test_requested: true });
    const response = await getKeys();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['refusals', 'version']);
    expect(body.version).toMatch(/^v2-[0-9a-f]{16}.[0-9a-f]{16}$/);
    // Les refus sont comptés sans lire leurs lignes (il peut y en avoir des milliers).
    expect(body.refusals).toBe(3);
    expect(callsTo(calls, 'refusals', 'select')).toEqual([['id', { count: 'exact', head: true }]]);
    expect(callsTo(calls, 'refusals', 'eq')).toEqual([['owner', USER]]);
    // Pièces propres et tenue prévue confirmée du jour visé, comme GET /api/miroir.
    expect(callsTo(calls, 'items', 'select')).toEqual([[VERSION_ITEM_COLUMNS]]);
    expect(callsTo(calls, 'items', 'eq')).toEqual([
      ['owner', USER],
      ['dirty', false],
    ]);
    expect(callsTo(calls, 'outfit_plans', 'eq')).toEqual([
      ['owner', USER],
      ['date', '2026-10-24'],
      ['confirmed', true],
    ]);
    expect(callsTo(calls, 'storage:items', 'createSignedUrls')).toEqual([]);
  });

  it('GET : la même empreinte que GET /api/miroir sur les mêmes lignes ; elle change avec elles', async () => {
    const assembly = { v: 1, photo: { size: [1000, 1600] }, sleevesPath: `${USER}/assemblage/manches/a.webp` };
    const row = (id: string, category: string, extra: { assembly?: unknown } = {}): Record<string, unknown> => ({
      id,
      name: `Pièce ${id.slice(-1)}`,
      category,
      color: '#1F2A44',
      warmth: 2,
      styles: ['decontracte'],
      rain_ok: false,
      dirty: false,
      photo_path: null,
      cutout_path: `${USER}/${id.slice(-1)}.png`,
      legacy_id: null,
      created_at: '2026-10-01T08:00:00Z',
      ...extra,
    });
    const full = [row(A, 'haut', { assembly }), row(B, 'bas', { assembly: null })];
    const projected = full.map(postgrestProjection);
    const plan = { date: '2026-10-24', item_ids: [B, A], confirmed: true };

    useDatabase({ items: { data: full, error: null }, outfit_plans: { data: plan, error: null } });
    const fromMirror = ((await (await getMirror()).json()) as { version: string }).version;
    // Lignes dans un autre ordre : même empreinte.
    useDatabase({ items: { data: [...projected].reverse(), error: null }, outfit_plans: { data: plan, error: null } });
    const fromKeys = ((await (await getKeys()).json()) as { version: string }).version;
    expect(fromKeys).toBe(fromMirror);

    // Le bas passe au sale (il disparaît des pièces propres) : l'empreinte change.
    useDatabase({ items: { data: projected.slice(0, 1), error: null }, outfit_plans: { data: plan, error: null } });
    expect(((await (await getKeys()).json()) as { version: string }).version).not.toBe(fromMirror);

    // Import rejoué : mêmes chemins, repères mesurés de nouveau. L'empreinte change aussi.
    const remeasured = [row(A, 'haut', { assembly: { ...assembly, photo: { ...assembly.photo, eye: [501, 200] } } }), full[1]];
    useDatabase({ items: { data: remeasured.map(postgrestProjection), error: null }, outfit_plans: { data: plan, error: null } });
    expect(((await (await getKeys()).json()) as { version: string }).version).not.toBe(fromMirror);
  });

  it('GET : un refus effacé sur le téléphone (« Remettre ») donne un compte plus bas', async () => {
    useDatabase({ refusals: { data: null, error: null, count: 3 } });
    expect(((await (await getKeys()).json()) as { refusals: number }).refusals).toBe(3);
    useDatabase({ refusals: { data: null, error: null, count: 2 } });
    expect(((await (await getKeys()).json()) as { refusals: number }).refusals).toBe(2);
    // Comptage en échec : pas de nombre, l'empreinte reste.
    useDatabase({ refusals: { data: null, error: new Error('timeout'), count: null } });
    const body = (await (await getKeys()).json()) as { refusals: unknown; version: unknown };
    expect(body.refusals).toBeNull();
    expect(body.version).toMatch(/^v2-/);
  });

  it('GET : base en échec, 200 sans empreinte', async () => {
    useDatabase({ items: { data: null, error: new Error('timeout') } });
    const response = await getKeys();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: null, refusals: null });
  });

  it('POST : enregistre key_map et remet key_test_requested à faux', async () => {
    useDatabase({});
    const response = await saveKeys(post({ keyMap }));
    expect(response.status).toBe(200);
    expect(mocks.updateProfile).toHaveBeenCalledWith(expect.anything(), USER, {
      key_map: keyMap,
      key_test_requested: false,
    });
  });

  it('POST : refuse une correspondance incomplète', async () => {
    useDatabase({});
    const response = await saveKeys(post({ keyMap: { next: keyMap.next } }));
    expect(response.status).toBe(400);
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });
});
