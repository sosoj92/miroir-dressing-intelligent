import type { SupabaseClient } from '@supabase/supabase-js';

// Faux client Supabase pour les tests unitaires du miroir : aucune requête réseau. Chaque table
// renvoie le résultat prévu ; chaque appel est noté pour être vérifié.

/** `count` : ce que renvoie un `select(…, { count: 'exact' })`. */
export type FakeResult = { data: unknown; error: unknown; count?: number | null };
export type FakeCall = { table: string; method: string; args: unknown[] };

const CHAIN_METHODS = [
  'select',
  'eq',
  'gte',
  'lte',
  'lt',
  'order',
  'in',
  'upsert',
  'update',
  'insert',
  'delete',
  'maybeSingle',
  'single',
];

export function fakeSupabase(results: Record<string, FakeResult | FakeResult[]>) {
  const calls: FakeCall[] = [];
  const served = new Map<string, number>();

  function resultFor(table: string): FakeResult {
    const entry = results[table];
    if (!entry) return { data: null, error: null };
    if (!Array.isArray(entry)) return entry;
    const index = served.get(table) ?? 0;
    served.set(table, index + 1);
    return entry[Math.min(index, entry.length - 1)];
  }

  function from(table: string) {
    let result: FakeResult | null = null;
    const builder: Record<string, unknown> = {};
    for (const method of CHAIN_METHODS) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    builder.then = (resolve: (value: FakeResult) => unknown, reject: (reason: unknown) => unknown) => {
      result ??= resultFor(table);
      return Promise.resolve(result).then(resolve, reject);
    };
    return builder;
  }

  const storage = {
    from: (bucket: string) => ({
      createSignedUrls: async (paths: string[], expiresIn: number) => {
        calls.push({ table: `storage:${bucket}`, method: 'createSignedUrls', args: [paths, expiresIn] });
        return {
          data: paths.map((path) => ({ path, signedUrl: `https://storage.test/${path}?token=secret`, error: null })),
          error: null,
        };
      },
    }),
  };

  return { client: { from, storage } as unknown as SupabaseClient, calls };
}

export function callsTo(calls: FakeCall[], table: string, method: string): unknown[][] {
  return calls.filter((call) => call.table === table && call.method === method).map((call) => call.args);
}
