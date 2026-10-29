import { expect, test } from '@playwright/test';
import { isSupabaseConfigured, requireSupabase } from './support';

test.describe('api', () => {
  test('/api/health répond sans révéler de valeur', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['ALLOWED_USER_ID', 'ok', 'supabase']);
    expect(body.ok).toBe(true);
    expect(['configurée', 'absente']).toContain(body.supabase);
    expect(['définie', 'absente', 'invalide']).toContain(body.ALLOWED_USER_ID);
  });

  test('sans Supabase, /api/me répond 503', async ({ request }) => {
    test.skip(await isSupabaseConfigured(request), 'Supabase configuré : ce test vise le mode sans clés');
    const response = await request.get('/api/me');
    expect(response.status()).toBe(503);
  });

  test('sans session, /api/me répond 401 (Supabase requis)', async ({ request }, testInfo) => {
    await requireSupabase(request, testInfo, test.skip);
    const response = await request.get('/api/me');
    expect(response.status()).toBe(401);
  });
});
