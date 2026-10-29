import { afterEach, describe, expect, it, vi } from 'vitest';

// /api/health : un mot par réglage (diagnostic d'installation), jamais une valeur.
vi.mock('next/server', () => ({ connection: async () => {} }));

import { GET } from './route';

// Valeur témoin : si elle apparaît dans la réponse, une valeur a fuité.
const SENTINEL = '0a1b2c3d-0000-4000-8000-0000000000aa';

async function health(): Promise<{ text: string; body: Record<string, unknown>; cache: string | null }> {
  const response = await GET();
  const text = await response.text();
  return { text, body: JSON.parse(text) as Record<string, unknown>, cache: response.headers.get('Cache-Control') };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/health', () => {
  it('rien de configuré : « absente » partout, sans cache', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('ALLOWED_USER_ID', '');
    const { body, cache } = await health();
    expect(body).toEqual({ ok: true, supabase: 'absente', ALLOWED_USER_ID: 'absente' });
    expect(cache).toContain('no-store');
  });

  it('ALLOWED_USER_ID renseignée : « définie », sans recopier sa valeur', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://projet.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_exemple');
    vi.stubEnv('ALLOWED_USER_ID', ` ${SENTINEL.toUpperCase()} `);
    const { body, text } = await health();
    expect(body).toEqual({ ok: true, supabase: 'configurée', ALLOWED_USER_ID: 'définie' });
    expect(text.toLowerCase()).not.toContain(SENTINEL);
    expect(text).not.toContain('projet.supabase.co');
    expect(text).not.toContain('sb_publishable_exemple');
  });

  it('ALLOWED_USER_ID qui n’est pas un uuid (UID mal copié) : « invalide », sans la recopier', async () => {
    vi.stubEnv('ALLOWED_USER_ID', 'ne-pas-afficher');
    const { body, text } = await health();
    expect(body.ALLOWED_USER_ID).toBe('invalide');
    expect(text).not.toContain('ne-pas-afficher');
  });
});
