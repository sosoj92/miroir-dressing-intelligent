import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// supabase/schema.sql (à coller tel quel sur un projet neuf) doit rester la concaténation exacte
// des migrations, dans l'ordre : un en-tête, puis chaque fichier précédé de son nom.

const dir = new URL('./', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dir), 'utf8').replace(/\r\n/g, '\n');

describe('supabase/schema.sql', () => {
  it('contient les migrations de supabase/migrations/, dans l’ordre, sans rien de plus', () => {
    const migrations = readdirSync(new URL('./migrations/', dir))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(migrations.length).toBeGreaterThanOrEqual(3);
    const schema = read('schema.sql');
    const body = migrations
      .map((name) => `-- ======================================== migrations/${name}\n\n${read(`migrations/${name}`).trimEnd()}\n`)
      .join('\n');
    const start = schema.indexOf('-- ======================================== migrations/');
    expect(start, 'en-tête manquant').toBeGreaterThan(0);
    // En cas d'écart : refais schema.sql à partir des migrations (même en-tête, même séparateur).
    expect(schema.slice(start)).toBe(body);
  });

  it('se colle sur un projet neuf et se relance sans dommage', () => {
    const header = read('schema.sql').split('-- ========')[0];
    expect(header).toContain('SQL Editor');
    expect(header).toContain('relancé');
    // Rien qui efface des données.
    expect(read('schema.sql')).not.toMatch(/\b(drop\s+table|truncate|delete\s+from)\b/i);
  });
});
