import { describe, expect, it } from 'vitest';
import { callsTo, fakeSupabase } from '@/lib/mirror/fake-supabase';
import { dirtyValue, loadHomeSummary, tomorrowValue } from './home';

// Accueil du téléphone, avec un faux client Supabase : aucune requête réseau.

const USER = '0a1b2c3d-0000-4000-8000-00000000a11d';
// Lundi 26 octobre 2026, 21 h à Paris (heure d'hiver, UTC+1).
const EVENING = new Date('2026-10-26T20:00:00Z');

describe('loadHomeSummary', () => {
  it('compte les pièces au sale et voit la tenue gardée pour demain', async () => {
    const { client, calls } = fakeSupabase({
      items: { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null },
      outfit_plans: { data: { date: '2026-10-27' }, error: null },
    });

    await expect(loadHomeSummary(client, USER, 'Europe/Paris', EVENING)).resolves.toEqual({
      dirtyCount: 3,
      tomorrowPlanned: true,
    });
    // Le filtre sur owner double RLS ; seul un plan confirmé pour demain compte.
    expect(callsTo(calls, 'items', 'eq')).toEqual([
      ['owner', USER],
      ['dirty', true],
    ]);
    expect(callsTo(calls, 'outfit_plans', 'eq')).toEqual([
      ['owner', USER],
      ['date', '2026-10-27'],
      ['confirmed', true],
    ]);
  });

  it('sans pièce au sale ni plan : 0 et rien de prévu', async () => {
    const { client } = fakeSupabase({
      items: { data: [], error: null },
      outfit_plans: { data: null, error: null },
    });

    await expect(loadHomeSummary(client, USER, 'Europe/Paris', EVENING)).resolves.toEqual({
      dirtyCount: 0,
      tomorrowPlanned: false,
    });
  });

  it('prend demain dans le fuseau du profil, pas en UTC', async () => {
    const { client, calls } = fakeSupabase({});
    // 23 h 30 en UTC, déjà 0 h 30 le 27 à Paris : demain est le 28.
    await loadHomeSummary(client, USER, 'Europe/Paris', new Date('2026-10-26T23:30:00Z'));
    expect(callsTo(calls, 'outfit_plans', 'eq')).toContainEqual(['date', '2026-10-28']);
  });

  it('remonte une erreur de lecture (la page affiche alors les lignes sans valeur)', async () => {
    const failure = { name: 'PostgrestError', code: '500' };
    const items = fakeSupabase({ items: { data: null, error: failure } });
    await expect(loadHomeSummary(items.client, USER, 'Europe/Paris', EVENING)).rejects.toBe(failure);

    const plans = fakeSupabase({ items: { data: [], error: null }, outfit_plans: { data: null, error: failure } });
    await expect(loadHomeSummary(plans.client, USER, 'Europe/Paris', EVENING)).rejects.toBe(failure);
  });
});

describe('valeurs des lignes', () => {
  it('« N au sale » seulement s’il y en a', () => {
    expect(dirtyValue(0)).toBeUndefined();
    expect(dirtyValue(1)).toBe('1 au sale');
    expect(dirtyValue(3)).toBe('3 au sale');
  });

  it('« Prévue » ou « À choisir »', () => {
    expect(tomorrowValue(true)).toBe('Prévue');
    expect(tomorrowValue(false)).toBe('À choisir');
  });
});
