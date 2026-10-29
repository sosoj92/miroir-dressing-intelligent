import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_LENGTH,
  MAX_OUTFIT_ITEMS,
  acceptTarget,
  isIsoDate,
  isRestartAllowed,
  parseAcceptRequest,
  parseItemIds,
  parseKeysRequest,
  parseRefuseRequest,
  parseRestartRequest,
  readJsonBody,
} from './request';

describe('recommencer', () => {
  it('lit le jour visé, l’« aujourd’hui » de la tablette et ses refus nommés (triés)', () => {
    expect(parseRestartRequest({ date: '2026-10-25', today: '2026-10-24' })).toEqual({
      ok: true,
      value: { date: '2026-10-25', today: '2026-10-24', refused: [] },
    });
    expect(parseRestartRequest({ date: '2026-10-25', today: '2026-10-24', refused: [[B, A]] })).toEqual({
      ok: true,
      value: { date: '2026-10-25', today: '2026-10-24', refused: [[A, B]] },
    });
    expect(parseRestartRequest({ date: '2026-10-25', today: '2026-10-24', refused: [['1 or 1=1']] }).ok).toBe(false);
    expect(parseRestartRequest({ date: '2026-10-25', today: '2026-10-24', refused: 'non' }).ok).toBe(false);
    const many = Array.from({ length: 31 }, () => [A]);
    expect(parseRestartRequest({ date: '2026-10-25', today: '2026-10-24', refused: many }).ok).toBe(false);
    expect(parseRestartRequest({ date: '2026-10-25' }).ok).toBe(false);
    expect(parseRestartRequest({ date: '31/12/2026', today: '2026-10-24' }).ok).toBe(false);
    expect(parseRestartRequest({ date: '2026-02-30', today: '2026-10-24' }).ok).toBe(false);
    expect(parseRestartRequest(null).ok).toBe(false);
  });

  it('aujourd’hui ou demain vus de la tablette ; tolère un envoi parti avant minuit', () => {
    expect(isRestartAllowed({ date: '2026-10-24', today: '2026-10-24' }, '2026-10-24')).toBe(true);
    expect(isRestartAllowed({ date: '2026-10-25', today: '2026-10-24' }, '2026-10-24')).toBe(true);
    // Reçu après minuit : la tablette affichait encore le 24.
    expect(isRestartAllowed({ date: '2026-10-25', today: '2026-10-24' }, '2026-10-25')).toBe(true);
    expect(isRestartAllowed({ date: '2026-10-26', today: '2026-10-24' }, '2026-10-24')).toBe(false);
    expect(isRestartAllowed({ date: '2026-10-23', today: '2026-10-24' }, '2026-10-24')).toBe(false);
    expect(isRestartAllowed({ date: '2026-10-23', today: '2026-10-23' }, '2026-10-25')).toBe(false);
    // Une tablette en avance sur le serveur n'est pas crue.
    expect(isRestartAllowed({ date: '2026-10-25', today: '2026-10-25' }, '2026-10-24')).toBe(false);
  });
});

const A = '0a1b2c3d-0000-4000-8000-00000000000a';
const B = '0a1b2c3d-0000-4000-8000-00000000000b';
const C = '0a1b2c3d-0000-4000-8000-00000000000c';

function post(body: string): Request {
  return new Request('http://localhost/api/miroir/accepter', { method: 'POST', body });
}

describe('readJsonBody', () => {
  it('lit le JSON, ou undefined si absent, illisible ou trop long', async () => {
    expect(await readJsonBody(post('{"a":1}'))).toEqual({ a: 1 });
    expect(await readJsonBody(post('pas du json'))).toBeUndefined();
    expect(await readJsonBody(post(''))).toBeUndefined();
    expect(await readJsonBody(post(`"${'x'.repeat(MAX_BODY_LENGTH)}"`))).toBeUndefined();
  });
});

describe('parseItemIds', () => {
  it('accepte des uuid, en minuscules et sans doublon', () => {
    expect(parseItemIds([A.toUpperCase(), A, B])).toEqual({ ok: true, value: [A, B] });
  });

  it('refuse une liste vide, trop longue, ou un id qui n’est pas un uuid', () => {
    expect(parseItemIds([]).ok).toBe(false);
    expect(parseItemIds('a').ok).toBe(false);
    expect(parseItemIds([A, 'drop table']).ok).toBe(false);
    expect(parseItemIds([A, 42]).ok).toBe(false);
    expect(parseItemIds(Array.from({ length: MAX_OUTFIT_ITEMS + 1 }, () => A)).ok).toBe(false);
  });
});

describe('accepter', () => {
  it('valide date, pièces, titre et cible facultatifs', () => {
    expect(parseAcceptRequest({ date: '2026-10-24', item_ids: [A, B], title: ' Pull et jean ' })).toEqual({
      ok: true,
      value: { date: '2026-10-24', item_ids: [A, B], title: 'Pull et jean', target: null },
    });
    expect(parseAcceptRequest({ date: '2026-10-24', item_ids: [A] })).toMatchObject({ value: { title: null } });
    expect(parseAcceptRequest({ date: '2026-10-24', item_ids: [A], target: 'plan' })).toMatchObject({
      value: { target: 'plan' },
    });
    expect(parseAcceptRequest({ date: '2026-10-24', item_ids: [A], target: 'history' })).toMatchObject({
      value: { target: 'history' },
    });
  });

  it('refuse un corps mal formé avec un message court', () => {
    expect(parseAcceptRequest(undefined)).toEqual({ ok: false, error: 'Requête invalide.' });
    expect(parseAcceptRequest({ date: '24/10/2026', item_ids: [A] })).toEqual({ ok: false, error: 'Date invalide.' });
    expect(parseAcceptRequest({ date: '2026-02-30', item_ids: [A] }).ok).toBe(false);
    expect(parseAcceptRequest({ date: '2026-10-24', item_ids: [A], title: 3 }).ok).toBe(false);
    expect(parseAcceptRequest({ date: '2026-10-24', item_ids: [A], title: 'x'.repeat(200) }).ok).toBe(false);
    expect(parseAcceptRequest({ date: '2026-10-24', item_ids: [A], target: 'refusals' })).toEqual({
      ok: false,
      error: 'Requête invalide.',
    });
    expect(parseAcceptRequest({ date: '2026-10-24', item_ids: [A], target: 1 }).ok).toBe(false);
  });

  it('sans cible (ancienne requête en file) : aujourd’hui → historique, demain → outfit_plans, sinon refus', () => {
    expect(acceptTarget('2026-10-24', '2026-10-24')).toBe('history');
    expect(acceptTarget('2026-10-25', '2026-10-24')).toBe('plan');
    expect(acceptTarget('2026-10-23', '2026-10-24')).toBeNull();
    expect(acceptTarget('2026-10-26', '2026-10-24')).toBeNull();
    expect(acceptTarget('2026-11-01', '2026-10-31')).toBe('plan');
  });

  it('« Prête pour demain » à 23 h 50, envoyée à 0 h 10 : toujours un plan, pas l’historique', () => {
    // Acceptée le 24 au soir pour le 25 ; le serveur la reçoit le 25.
    expect(acceptTarget('2026-10-25', '2026-10-25', 'plan')).toBe('plan');
    expect(acceptTarget('2026-10-25', '2026-10-24', 'plan')).toBe('plan');
    expect(acceptTarget('2026-10-24', '2026-10-25', 'plan')).toBeNull();
    expect(acceptTarget('2026-10-27', '2026-10-25', 'plan')).toBeNull();
  });

  it('« Bonne journée » à 23 h 59, envoyée après minuit : historique de la veille, pas un 400', () => {
    expect(acceptTarget('2026-10-24', '2026-10-24', 'history')).toBe('history');
    expect(acceptTarget('2026-10-24', '2026-10-25', 'history')).toBe('history');
    expect(acceptTarget('2026-10-25', '2026-10-24', 'history')).toBeNull();
    expect(acceptTarget('2026-10-22', '2026-10-24', 'history')).toBeNull();
  });

  it('isIsoDate rejette les dates impossibles', () => {
    expect(isIsoDate('2026-10-24')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate(20261024)).toBe(false);
  });
});

describe('refuser', () => {
  it('trie les ids', () => {
    expect(parseRefuseRequest({ item_ids: [C, A, B] })).toEqual({ ok: true, value: { item_ids: [A, B, C] } });
  });

  it('refuse un corps mal formé', () => {
    expect(parseRefuseRequest(null).ok).toBe(false);
    expect(parseRefuseRequest({ item_ids: [] }).ok).toBe(false);
  });
});

describe('touches', () => {
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

  it('exige les quatre actions de base ; « Recommencer » est facultatif (tablette pas à jour)', () => {
    expect(parseKeysRequest({ keyMap })).toEqual({ ok: true, value: { keyMap } });
    const { refuse, ...partial } = keyMap;
    void refuse;
    expect(parseKeysRequest({ keyMap: partial })).toEqual({ ok: false, error: 'Il manque une touche.' });
    const { restart, ...withoutRestart } = keyMap;
    void restart;
    expect(parseKeysRequest({ keyMap: withoutRestart })).toEqual({ ok: true, value: { keyMap: withoutRestart } });
    expect(parseKeysRequest({}).ok).toBe(false);
  });

  it('« Recommencer » sur une touche déjà prise est refusé', () => {
    const duplicated = { ...keyMap, restart: { code: 'KeyD', key: 'd' } };
    expect(parseKeysRequest({ keyMap: duplicated })).toEqual({ ok: false, error: 'Deux actions ont la même touche.' });
  });

  it('refuse deux actions sur la même touche', () => {
    const duplicated = { ...keyMap, refuse: { code: 'KeyD', key: 'd' } };
    expect(parseKeysRequest({ keyMap: duplicated })).toEqual({ ok: false, error: 'Deux actions ont la même touche.' });
  });

  it('ignore les champs inconnus', () => {
    const result = parseKeysRequest({ keyMap: { ...keyMap, jump: { code: 'KeyX', key: 'x' } } });
    expect(result).toEqual({ ok: true, value: { keyMap } });
  });
});
