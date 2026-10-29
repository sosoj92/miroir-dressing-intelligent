import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordSpend } from './spend';

function fakeSupabase(result: unknown) {
  const insert = vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)));
  const from = vi.fn(() => ({ insert }));
  return { client: { from } as unknown as SupabaseClient, from, insert };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recordSpend', () => {
  it('ajoute une ligne à spend_ledger (owner par défaut), coût arrondi à 4 décimales', async () => {
    const { client, from, insert } = fakeSupabase({ error: null });
    await expect(recordSpend(client, 'bria', 0.018, 'détourage')).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('spend_ledger');
    expect(insert).toHaveBeenCalledWith({ service: 'bria', cost_usd: 0.018, detail: 'détourage' });

    await recordSpend(client, 'claude', 0.0123456);
    expect(insert).toHaveBeenLastCalledWith({ service: 'claude', cost_usd: 0.0123, detail: null });
  });

  it("un échec d'écriture ne lève pas d'erreur et ne journalise que le nom", async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeSupabase({
      error: { name: 'PostgrestError', code: '42501', message: 'détail interne https://exemple?token=secret' },
    });
    await expect(recordSpend(client, 'bria', 0.018)).resolves.toBe(false);
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0][0])).toContain('PostgrestError (42501)');
    expect(String(log.mock.calls[0][0])).not.toContain('token');
  });

  it('une exception du client est aussi absorbée', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeSupabase(new TypeError('fetch failed'));
    await expect(recordSpend(client, 'claude', 0.01)).resolves.toBe(false);
  });

  it('refuse un coût invalide sans écrire', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, insert } = fakeSupabase({ error: null });
    await expect(recordSpend(client, 'fashn', Number.NaN)).resolves.toBe(false);
    await expect(recordSpend(client, 'fashn', -1)).resolves.toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });
});
