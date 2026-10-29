import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Arrivée du lien par e-mail, avec Supabase et ALLOWED_USER_ID simulés : aucun réseau. Seul endroit
// sensible aux redirections ouvertes : la destination vient toujours de la table fixe.
const mocks = vi.hoisted(() => ({
  user: '0a1b2c3d-0000-4000-8000-00000000a11d',
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => {},
}));
vi.mock('@/lib/server/env', () => ({ allowedUserId: () => mocks.user }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession, signOut: mocks.signOut },
  }),
}));

import { GET } from './route';

const USER = mocks.user;
const OTHER = '0a1b2c3d-0000-4000-8000-0000000000ff';

function arrive(search: string, from?: string): Promise<Response> {
  const headers = from === undefined ? undefined : { cookie: `connexion-depuis=${encodeURIComponent(from)}` };
  return GET(new NextRequest(`http://localhost/auth/callback${search}`, { headers }));
}

/** Chemin et query de la redirection (même origine : jamais un autre site). */
function location(response: Response): string {
  const target = new URL(response.headers.get('location') ?? '', 'http://invalide');
  expect(target.origin).toBe('http://localhost');
  return target.pathname + target.search;
}

/** Le cookie du miroir est effacé à chaque passage, sur le chemin où le formulaire l'a posé. */
function expectCookieCleared(response: Response) {
  const cookie = response.headers.get('set-cookie') ?? '';
  expect(cookie).toMatch(/connexion-depuis=;/);
  expect(cookie).toMatch(/Path=\/auth/);
  expect(cookie).toMatch(/Max-Age=0/);
}

beforeEach(() => {
  mocks.exchangeCodeForSession.mockReset().mockResolvedValue({ data: { user: { id: USER } }, error: null });
  mocks.signOut.mockReset().mockResolvedValue({ error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lien valable', () => {
  it('demandé depuis le miroir : retour au miroir', async () => {
    const response = await arrive('?code=x', 'miroir');
    expect(response.status).toBe(307);
    expect(location(response)).toBe('/');
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('x');
    expectCookieCleared(response);
  });

  it("sans cookie : l'accueil du téléphone", async () => {
    const response = await arrive('?code=x');
    expect(location(response)).toBe('/gestion');
    expectCookieCleared(response);
  });

  it("toute autre valeur, ou une adresse dans l'URL, mène à l'accueil du téléphone", async () => {
    for (const from of ['//exemple.com', 'https://exemple.com', 'Miroir', '/']) {
      expect(location(await arrive('?code=x', from))).toBe('/gestion');
    }
    // Ni la query (ancienne forme du lien) ni un paramètre « next » ne sont lus.
    expect(location(await arrive('?code=x&depuis=miroir'))).toBe('/gestion');
    expect(location(await arrive('?code=x&next=//exemple.com'))).toBe('/gestion');
  });
});

describe('lien refusé', () => {
  it('autre compte : déconnecté, retour à la connexion en gardant le miroir', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { user: { id: OTHER } }, error: null });
    const response = await arrive('?code=x', 'miroir');
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(location(response)).toBe('/connexion?erreur=acces&depuis=miroir');
    expectCookieCleared(response);
  });

  it("ouvert dans un autre navigateur : sans retour au miroir (la connexion se fait ailleurs)", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { code: 'pkce_code_verifier_not_found', message: 'code verifier not found' },
    });
    const response = await arrive('?code=x', 'miroir');
    expect(location(response)).toBe('/connexion?erreur=navigateur');
    expectCookieCleared(response);
  });

  it('lien expiré ou erreur imprévue : « lien », miroir gardé', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { code: 'otp_expired' } });
    expect(location(await arrive('?code=x', 'miroir'))).toBe('/connexion?erreur=lien&depuis=miroir');

    mocks.exchangeCodeForSession.mockRejectedValue(new Error('réseau'));
    expect(location(await arrive('?code=x', 'miroir'))).toBe('/connexion?erreur=lien&depuis=miroir');
    expect(location(await arrive('?code=x'))).toBe('/connexion?erreur=lien');
  });

  it("sans code : « lien », sans appeler Supabase", async () => {
    const response = await arrive('', 'miroir');
    expect(location(response)).toBe('/connexion?erreur=lien&depuis=miroir');
    expect(location(await arrive('', '//exemple.com'))).toBe('/connexion?erreur=lien');
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expectCookieCleared(response);
  });
});
