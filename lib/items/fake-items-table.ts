import type { SupabaseClient } from '@supabase/supabase-js';

// Faux client Supabase pour les tests unitaires : une table `items` en mémoire qui applique
// vraiment les filtres `.eq()` / `.in()` (chemins JSON `assembly->>sleevesPath` et
// `assembly->photo->arms->arms->>path` compris), la
// projection du `.select()` (alias `nom:colonne`), l'upsert sur (owner, legacy_id) et le plafond
// de lignes de PostgREST (max_rows). Aucune requête réseau.

export type FakeItemRow = Record<string, unknown> & { owner: string };
export type FakeCall = { method: string; args: unknown[] };

type Options = {
  rows?: FakeItemRow[];
  /** Plafond de lignes par réponse, comme `max_rows` de PostgREST. */
  maxRows?: number;
  /** Nombre de lectures qui réussissent avant que les suivantes renvoient une erreur. */
  failReadsAfter?: number;
};

const READ_ERROR = { name: 'PostgrestError', code: '500' };

function child(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

/** Colonne, ou chemin JSON de PostgREST (`a->>b`, `a->b->c->>d`) : texte, ou null s'il manque. */
function valueOf(row: FakeItemRow, column: string): unknown {
  const json = column.match(/^(\w+)((?:->\w+)*)->>(\w+)$/);
  if (!json) return row[column] ?? null;
  const steps = json[2].split('->').filter(Boolean);
  let value: unknown = row[json[1]];
  for (const key of steps) value = child(value, key);
  const leaf = child(value, json[3]);
  return leaf === undefined || leaf === null ? null : String(leaf);
}

function project(row: FakeItemRow, columns: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const part of columns.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const colon = part.indexOf(':');
    const alias = colon === -1 ? part : part.slice(0, colon);
    const source = colon === -1 ? part : part.slice(colon + 1);
    out[alias] = valueOf(row, source);
  }
  return out;
}

export function fakeItemsTable(options: Options = {}) {
  const rows: FakeItemRow[] = (options.rows ?? []).map((row) => ({ ...row }));
  const calls: FakeCall[] = [];
  const removed: string[][] = [];
  let reads = 0;

  function from(table: string) {
    if (table !== 'items') throw new Error(`Table inattendue : ${table}`);
    const filters: Array<(row: FakeItemRow) => boolean> = [];
    let columns = '*';
    let upserted: FakeItemRow[] | null = null;
    const builder: Record<string, unknown> = {
      select(value: string) {
        calls.push({ method: 'select', args: [value] });
        columns = value;
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.push({ method: 'eq', args: [column, value] });
        filters.push((row) => valueOf(row, column) === value);
        return builder;
      },
      in(column: string, values: unknown[]) {
        calls.push({ method: 'in', args: [column, values] });
        filters.push((row) => values.includes(valueOf(row, column)));
        return builder;
      },
      upsert(values: FakeItemRow[], settings: unknown) {
        calls.push({ method: 'upsert', args: [values, settings] });
        upserted = values.map((value) => {
          const index = rows.findIndex((row) => row.owner === value.owner && row.legacy_id === value.legacy_id);
          if (index === -1) {
            const created = { ...value };
            rows.push(created);
            return created;
          }
          rows[index] = { ...rows[index], ...value };
          return rows[index];
        });
        return builder;
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        let result: { data: unknown; error: unknown };
        if (upserted) {
          result = { data: upserted.map((row) => project(row, columns)), error: null };
        } else if (options.failReadsAfter !== undefined && reads++ >= options.failReadsAfter) {
          result = { data: null, error: READ_ERROR };
        } else {
          const found = rows.filter((row) => filters.every((filter) => filter(row)));
          const page = options.maxRows === undefined ? found : found.slice(0, options.maxRows);
          result = { data: page.map((row) => (columns === '*' ? { ...row } : project(row, columns))), error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  }

  const storage = {
    from: () => ({
      remove: async (paths: string[]) => {
        removed.push([...paths]);
        return { data: [], error: null };
      },
    }),
  };

  return { client: { from, storage } as unknown as SupabaseClient, rows, calls, removed };
}
