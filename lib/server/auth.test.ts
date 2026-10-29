import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// getClaims simulé : aucun appel réseau, aucune vraie session.
const { getClaims } = vi.hoisted(() => ({ getClaims: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getClaims } }),
}));

import { AuthError, authErrorResponse, checkUser, requireUser } from './auth';
import { EnvError } from './env';
import { SupabaseNotConfiguredError } from '@/lib/supabase/config';

const ALLOWED_ID = '0a1b2c3d-0000-4000-8000-00000000a11d';
const OTHER_ID = '0a1b2c3d-0000-4000-8000-0000000000ff';

function claimsFor(sub: string) {
  return { data: { claims: { sub, email: 'moi@example.com' }, header: {}, signature: new Uint8Array() }, error: null };
}

beforeEach(() => {
  getClaims.mockReset();
  vi.stubEnv('ALLOWED_USER_ID', ALLOWED_ID);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requireUser', () => {
  it('sans session : 401', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(requireUser()).rejects.toMatchObject({ name: 'AuthError', status: 401 });
  });

  it('jeton refusé par Supabase : 401', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('jeton expiré') });
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  });

  it('un autre compte que ALLOWED_USER_ID : 403', async () => {
    getClaims.mockResolvedValue(claimsFor(OTHER_ID));
    await expect(requireUser()).rejects.toMatchObject({ name: 'AuthError', status: 403 });
  });

  it('le compte autorisé : ok', async () => {
    getClaims.mockResolvedValue(claimsFor(ALLOWED_ID));
    await expect(requireUser()).resolves.toEqual({ id: ALLOWED_ID, email: 'moi@example.com' });
  });

  it('compare les ids sans tenir compte de la casse', async () => {
    getClaims.mockResolvedValue(claimsFor(ALLOWED_ID.toUpperCase()));
    await expect(requireUser()).resolves.toMatchObject({ id: ALLOWED_ID.toUpperCase() });
  });

  it('ALLOWED_USER_ID absent : refuse au lieu d’ouvrir l’accès', async () => {
    vi.stubEnv('ALLOWED_USER_ID', '');
    getClaims.mockResolvedValue(claimsFor(ALLOWED_ID));
    await expect(requireUser()).rejects.toBeInstanceOf(EnvError);
  });
});

describe('checkUser', () => {
  it('renvoie le statut au lieu de lever une erreur', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(checkUser()).resolves.toEqual({ ok: false, status: 401 });
    getClaims.mockResolvedValue(claimsFor(OTHER_ID));
    await expect(checkUser()).resolves.toEqual({ ok: false, status: 403 });
    getClaims.mockResolvedValue(claimsFor(ALLOWED_ID));
    await expect(checkUser()).resolves.toMatchObject({ ok: true });
  });
});

describe('authErrorResponse', () => {
  it('401 et 403 gardent leur statut', async () => {
    expect(authErrorResponse(new AuthError(401)).status).toBe(401);
    expect(authErrorResponse(new AuthError(403)).status).toBe(403);
  });

  it('Supabase non configuré : 503', () => {
    expect(authErrorResponse(new SupabaseNotConfiguredError()).status).toBe(503);
  });

  it('variable serveur absente : 500 sans détail dans la réponse', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = authErrorResponse(new EnvError('ALLOWED_USER_ID', 'absente'));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain('ALLOWED_USER_ID');
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
