import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@/lib/types';

// Lecture des données du miroir avec un faux client Supabase, sans réseau ni météo réelle.
const { getProfile, fetchDayWeather } = vi.hoisted(() => ({ getProfile: vi.fn(), fetchDayWeather: vi.fn() }));
vi.mock('@/lib/server/profile', () => ({ getProfile, updateProfile: vi.fn() }));
vi.mock('@/lib/weather', () => ({ fetchDayWeather }));

import { callsTo, fakeSupabase } from './fake-supabase';
import { choiceDayOf, loadMirrorPayload, ownsAllItems, restartChoice } from './server';

const USER = '0a1b2c3d-0000-4000-8000-00000000a11d';
const ITEM_A = '0a1b2c3d-0000-4000-8000-00000000000a';
const ITEM_B = '0a1b2c3d-0000-4000-8000-00000000000b';

const PROFILE: Profile = {
  photo_path: null,
  city: 'Paris',
  lat: 48.8566,
  lon: 2.3522,
  timezone: 'Europe/Paris',
  key_map: { next: { code: 'KeyD', key: 'd' } },
  key_test_requested: true,
  gestures_enabled: true,
  gesture_sensitivity: 1,
  tryon_cap_eur: 12,
  evening_hour: 18,
};

function itemRow(id: string, category: string, cutout: string | null) {
  return {
    id,
    name: `Pièce ${id.slice(-1)}`,
    category,
    color: '#1F2A44',
    warmth: 2,
    styles: ['decontracte', 'inconnu'],
    rain_ok: true,
    dirty: false,
    photo_path: null,
    cutout_path: cutout,
    legacy_id: null,
    created_at: '2026-10-01T08:00:00Z',
  };
}

function supabase() {
  return fakeSupabase({
    items: {
      data: [
        itemRow(ITEM_A, 'haut', `${USER}/a.png`),
        itemRow(ITEM_B, 'bas', 'autre-compte/b.png'),
        itemRow('0a1b2c3d-0000-4000-8000-00000000000c', 'pyjama', null),
      ],
      error: null,
    },
    outfit_history: { data: [{ date: '2026-10-23', item_ids: [ITEM_A], title: null }], error: null },
    refusals: { data: [{ item_ids: [ITEM_B, ITEM_A] }], error: null },
    outfit_plans: { data: { date: '2026-10-25', item_ids: [ITEM_A, ITEM_B], confirmed: true }, error: null },
  });
}

beforeEach(() => {
  getProfile.mockReset().mockResolvedValue(PROFILE);
  fetchDayWeather.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadMirrorPayload', () => {
  it('le jour : pièces propres avec URL signée de leur détourage, historique, refus triés', async () => {
    const { client, calls } = supabase();
    const payload = await loadMirrorPayload(client, USER, new Date('2026-10-24T10:00:00Z'));

    expect(payload).toMatchObject({
      today: '2026-10-24',
      targetDate: '2026-10-24',
      isTomorrow: false,
      timezone: 'Europe/Paris',
      eveningHour: 18,
      keyMap: PROFILE.key_map,
    });
    // Plus de test des touches demandé par le téléphone : la tablette ne le reçoit plus.
    expect(payload).not.toHaveProperty('keyTestRequested');
    expect(payload.items.map((item) => item.id)).toEqual([ITEM_A, ITEM_B]);
    expect(payload.items[0].cutout_url).toBe(`https://storage.test/${USER}/a.png?token=secret`);
    // Un chemin hors du dossier du compte n'est jamais signé.
    expect(payload.items[1].cutout_url).toBeNull();
    expect(payload.items[0].styles).toEqual(['decontracte']);
    expect(callsTo(calls, 'storage:items', 'createSignedUrls')).toEqual([[[`${USER}/a.png`], 3600]]);

    expect(callsTo(calls, 'items', 'eq')).toEqual([
      ['owner', USER],
      ['dirty', false],
    ]);
    expect(callsTo(calls, 'outfit_history', 'gte')).toEqual([['date', '2026-10-10']]);
    expect(callsTo(calls, 'outfit_plans', 'eq')).toContainEqual(['date', '2026-10-24']);
    // Un brouillon (confirmed: false) n'est pas une tenue prévue.
    expect(callsTo(calls, 'outfit_plans', 'eq')).toContainEqual(['confirmed', true]);
    expect(payload.refusals).toEqual([{ item_ids: [ITEM_A, ITEM_B] }]);
    expect(callsTo(calls, 'refusals', 'select')).toEqual([['item_ids, created_at']]);
    expect(payload.history).toEqual([{ date: '2026-10-23', item_ids: [ITEM_A], title: null }]);
    expect(fetchDayWeather).toHaveBeenCalledWith({ lat: 48.8566, lon: 2.3522, timezone: 'Europe/Paris' }, '2026-10-24');
  });

  it('après l’heure du soir : demain, avec la météo et le plan de demain', async () => {
    const { client, calls } = supabase();
    const payload = await loadMirrorPayload(client, USER, new Date('2026-10-24T17:00:00Z')); // 19 h à Paris
    expect(payload.isTomorrow).toBe(true);
    expect(payload.targetDate).toBe('2026-10-25');
    expect(callsTo(calls, 'outfit_plans', 'eq')).toContainEqual(['date', '2026-10-25']);
    expect(payload.plan).toEqual({ date: '2026-10-25', item_ids: [ITEM_A, ITEM_B], confirmed: true });
    expect(fetchDayWeather).toHaveBeenCalledWith(expect.anything(), '2026-10-25');
  });

  it('plan : les chaussures et accessoires au sale en sont retirés, une pièce supprimée reste', async () => {
    const SHOES = '0a1b2c3d-0000-4000-8000-0000000000c5';
    const BELT = '0a1b2c3d-0000-4000-8000-0000000000ac';
    const GONE = '0a1b2c3d-0000-4000-8000-0000000000de';
    const { client, calls } = fakeSupabase({
      items: [
        { data: [itemRow(ITEM_A, 'haut', null), itemRow(ITEM_B, 'bas', null)], error: null },
        // Relecture des pièces du plan absentes de la liste (au sale ou supprimées).
        { data: [{ id: SHOES, category: 'chaussures' }, { id: BELT, category: 'accessoire' }], error: null },
      ],
      outfit_plans: { data: { date: '2026-10-25', item_ids: [ITEM_A, SHOES, ITEM_B, BELT, GONE], confirmed: true }, error: null },
    });
    const payload = await loadMirrorPayload(client, USER, new Date('2026-10-24T17:00:00Z'));
    expect(payload.plan).toEqual({ date: '2026-10-25', item_ids: [ITEM_A, ITEM_B, GONE], confirmed: true });
    expect(callsTo(calls, 'items', 'in')).toEqual([['id', [SHOES, BELT, GONE]]]);
    expect(callsTo(calls, 'items', 'eq')).toContainEqual(['owner', USER]);
  });

  it('plan : si la relecture échoue, le plan reste tel quel', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const SHOES = '0a1b2c3d-0000-4000-8000-0000000000c5';
    const { client } = fakeSupabase({
      items: [
        { data: [itemRow(ITEM_A, 'haut', null), itemRow(ITEM_B, 'bas', null)], error: null },
        { data: null, error: { name: 'PostgrestError', code: '500' } },
      ],
      outfit_plans: { data: { date: '2026-10-25', item_ids: [ITEM_A, ITEM_B, SHOES], confirmed: true }, error: null },
    });
    const payload = await loadMirrorPayload(client, USER, new Date('2026-10-24T17:00:00Z'));
    expect(payload.plan?.item_ids).toEqual([ITEM_A, ITEM_B, SHOES]);
  });

  it('une météo en panne ne casse pas le miroir', async () => {
    fetchDayWeather.mockRejectedValue(new Error('Open-Meteo indisponible'));
    const { client } = supabase();
    const payload = await loadMirrorPayload(client, USER, new Date('2026-10-24T10:00:00Z'));
    expect(payload.weather).toBeNull();
  });

  it('pièces assemblées : repères relus, détourage et manches signés ensemble, chemins étrangers refusés', async () => {
    const photo = {
      key: 'PHOTO_1',
      size: [1200, 1600],
      eye: [600, 390],
      centers: [[380, 610]],
      topLow: 480,
      bottomHigh: 500,
      onePiece: false,
      tucked: false,
    };
    const { client, calls } = fakeSupabase({
      items: {
        data: [
          {
            ...itemRow(ITEM_A, 'veste', `${USER}/assemblage/photos/PHOTO_1.webp`),
            assembly: { v: 1, photo, sleevesPath: `${USER}/assemblage/manches/a01.webp` },
          },
          {
            ...itemRow(ITEM_B, 'bas', `${USER}/assemblage/photos/PHOTO_1.webp`),
            assembly: { v: 1, photo, sleevesPath: 'autre-compte/manches/a02.webp' },
          },
          {
            ...itemRow('0a1b2c3d-0000-4000-8000-00000000000d', 'haut', `${USER}/d.png`),
            assembly: { v: 2, photo }, // invalide : pas d'assemblage
          },
        ],
        error: null,
      },
    });
    const payload = await loadMirrorPayload(client, USER, new Date('2026-10-24T10:00:00Z'));

    expect(callsTo(calls, 'items', 'select')[0][0]).toContain('assembly');
    // Une photo partagée n'est signée qu'une fois ; le chemin d'un autre compte jamais.
    expect(callsTo(calls, 'storage:items', 'createSignedUrls')).toEqual([
      [[`${USER}/assemblage/photos/PHOTO_1.webp`, `${USER}/d.png`, `${USER}/assemblage/manches/a01.webp`], 3600],
    ]);
    const [jacket, bottom, top] = payload.items;
    expect(jacket.assembly).toEqual({ v: 1, photo, sleevesPath: `${USER}/assemblage/manches/a01.webp` });
    expect(jacket.cutout_url).toBe(`https://storage.test/${USER}/assemblage/photos/PHOTO_1.webp?token=secret`);
    expect(jacket.sleeves_url).toBe(`https://storage.test/${USER}/assemblage/manches/a01.webp?token=secret`);
    expect(bottom.assembly?.photo.key).toBe('PHOTO_1');
    expect(bottom.sleeves_url).toBeNull();
    expect(top.assembly).toBeNull();
    expect(top.sleeves_url).toBeNull();
  });

  it('bras pliés : couches signées avec les détourages, URL portées par la pièce, chemins étrangers jamais signés', async () => {
    const photo = {
      key: 'PHOTO_1',
      size: [1200, 1600],
      eye: [600, 390],
      centers: [[380, 610]],
      topLow: 480,
      bottomHigh: 500,
      onePiece: false,
      tucked: false,
    };
    const layer = (path: string) => ({ path, box: [0, 0, 10, 10] });
    const arms = {
      v: 1,
      arms: layer(`${USER}/assemblage/bras/PHOTO_1.webp`),
      body: layer(`${USER}/assemblage/corps/PHOTO_1.webp`),
      sleeves: null,
      step: 5,
      from: 250,
      L: [[400, 440]],
      R: [null],
      sleeveL: [null],
      sleeveR: [null],
      wrist: { L: 650, R: null },
      cuff: { L: null, R: null },
    };
    const foreign = { ...arms, body: layer('autre-compte/assemblage/corps/PHOTO_2.webp'), sleeves: layer(`${USER}/assemblage/manches-photo/PHOTO_2.webp`) };
    const cutout = `${USER}/assemblage/PHOTO_1.webp`;
    const { client, calls } = fakeSupabase({
      items: {
        data: [
          { ...itemRow(ITEM_A, 'haut', cutout), assembly: { v: 1, photo: { ...photo, arms }, sleevesPath: null } },
          { ...itemRow(ITEM_B, 'bas', cutout), assembly: { v: 1, photo: { ...photo, key: 'PHOTO_2', arms: foreign }, sleevesPath: null } },
          { ...itemRow('0a1b2c3d-0000-4000-8000-00000000000d', 'bas', `${USER}/d.webp`), assembly: { v: 1, photo, sleevesPath: null } },
        ],
        error: null,
      },
    });
    const payload = await loadMirrorPayload(client, USER, new Date('2026-10-24T10:00:00Z'));

    // Un seul appel ; chaque chemin une fois ; celui d'un autre compte jamais.
    expect(callsTo(calls, 'storage:items', 'createSignedUrls')).toEqual([
      [
        [
          cutout,
          `${USER}/d.webp`,
          `${USER}/assemblage/bras/PHOTO_1.webp`,
          `${USER}/assemblage/corps/PHOTO_1.webp`,
          `${USER}/assemblage/manches-photo/PHOTO_2.webp`,
        ],
        3600,
      ],
    ]);
    const [top, bottom, plain] = payload.items;
    expect(top.assembly?.photo.arms).toEqual(arms);
    expect(top.arms_urls).toEqual({
      arms: `https://storage.test/${USER}/assemblage/bras/PHOTO_1.webp?token=secret`,
      body: `https://storage.test/${USER}/assemblage/corps/PHOTO_1.webp?token=secret`,
      sleeves: null,
    });
    expect(bottom.arms_urls).toEqual({
      arms: `https://storage.test/${USER}/assemblage/bras/PHOTO_1.webp?token=secret`,
      body: null,
      sleeves: `https://storage.test/${USER}/assemblage/manches-photo/PHOTO_2.webp?token=secret`,
    });
    // Pièce sans bras pliés : aucune clé de plus qu'avant.
    expect(plain).not.toHaveProperty('arms_urls');
    expect(plain.assembly?.photo).not.toHaveProperty('arms');
  });

  it('une erreur de base remonte (réponse 500 sans détail)', async () => {
    const { client } = fakeSupabase({ items: { data: null, error: new Error('relation absente') } });
    await expect(loadMirrorPayload(client, USER, new Date())).rejects.toThrow('relation absente');
  });

  it('chaque refus porte le jour visé quand il a été fait (fuseau de Paris, heure du soir)', async () => {
    const { client } = fakeSupabase({
      refusals: {
        data: [
          { item_ids: [ITEM_B, ITEM_A], created_at: '2026-10-24T06:00:00Z' }, // 8 h à Paris : choix du 24
          { item_ids: [ITEM_A], created_at: '2026-10-23T21:30:00Z' }, // 23 h 30 le 23 : choix du 24
          { item_ids: [ITEM_B], created_at: '2026-10-23T14:00:00Z' }, // 16 h le 23 : choix du 23
          { item_ids: [ITEM_A, ITEM_B, ITEM_A] },
        ],
        error: null,
      },
    });
    const payload = await loadMirrorPayload(client, USER, new Date('2026-10-24T10:00:00Z'));
    expect(payload.refusals).toEqual([
      { item_ids: [ITEM_A, ITEM_B], day: '2026-10-24' },
      { item_ids: [ITEM_A], day: '2026-10-24' },
      { item_ids: [ITEM_B], day: '2026-10-23' },
      { item_ids: [ITEM_A, ITEM_A, ITEM_B] },
    ]);
  });
});

describe('choiceDayOf', () => {
  it('jour visé par le miroir à cet instant : demain après l’heure du soir, heure d’été comprise', () => {
    expect(choiceDayOf('2026-10-24T06:00:00Z', 'Europe/Paris', 18)).toBe('2026-10-24');
    expect(choiceDayOf('2026-10-24T16:30:00Z', 'Europe/Paris', 18)).toBe('2026-10-25'); // 18 h 30 (UTC+2)
    expect(choiceDayOf('2026-10-23T22:30:00Z', 'Europe/Paris', 18)).toBe('2026-10-24'); // 0 h 30 le 24
    expect(choiceDayOf('2026-10-26T16:30:00Z', 'Europe/Paris', 18)).toBe('2026-10-26'); // 17 h 30 (UTC+1)
    expect(choiceDayOf(undefined, 'Europe/Paris', 18)).toBeNull();
    expect(choiceDayOf('pas une date', 'Europe/Paris', 18)).toBeNull();
  });
});

describe('restartChoice', () => {
  const choice = { date: '2026-10-25', today: '2026-10-24', timeZone: 'Europe/Paris', eveningHour: 18 };
  const NOW = new Date('2026-10-24T18:00:00Z'); // 20 h à Paris

  it('ne relit que les refus récents, puis efface ceux de ce choix et ceux que la tablette nomme', async () => {
    const { client, calls } = fakeSupabase({
      refusals: [
        {
          data: [
            { id: 'r-soir', item_ids: [ITEM_A], created_at: '2026-10-24T17:00:00Z' }, // 19 h : choix du 25
            { id: 'r-matin', item_ids: [ITEM_B], created_at: '2026-10-24T06:00:00Z' }, // choix du 24 : reste
            // Fait hors ligne pendant ce choix, reçu plus tard : nommé par la tablette.
            { id: 'r-file', item_ids: [ITEM_B, ITEM_A], created_at: '2026-10-25T07:00:00Z' },
          ],
          error: null,
        },
        { data: null, error: null },
      ],
    });
    await restartChoice(client, USER, { ...choice, refused: [[ITEM_A, ITEM_B]] }, NOW);
    expect(callsTo(calls, 'refusals', 'gte')).toEqual([['created_at', '2026-10-21T18:00:00.000Z']]);
    expect(callsTo(calls, 'refusals', 'in')).toEqual([['id', ['r-soir', 'r-file']]]);
    // Le jour visé est demain : la tenue portée aujourd'hui reste.
    expect(callsTo(calls, 'outfit_history', 'delete')).toEqual([]);
  });

  it('erreur de lecture des refus : remonte, après avoir effacé le plan', async () => {
    const { client, calls } = fakeSupabase({ refusals: { data: null, error: new Error('lecture impossible') } });
    await expect(restartChoice(client, USER, choice, NOW)).rejects.toThrow('lecture impossible');
    expect(callsTo(calls, 'outfit_plans', 'delete')).toHaveLength(1);
    expect(callsTo(calls, 'refusals', 'delete')).toEqual([]);
  });
});

describe('ownsAllItems', () => {
  it('vrai seulement si chaque pièce est trouvée dans le compte', async () => {
    const { client, calls } = fakeSupabase({ items: { data: [{ id: ITEM_A }], error: null } });
    expect(await ownsAllItems(client, USER, [ITEM_A])).toBe(true);
    expect(await ownsAllItems(client, USER, [ITEM_A, ITEM_B])).toBe(false);
    expect(callsTo(calls, 'items', 'in')[0]).toEqual(['id', [ITEM_A]]);
  });
});
