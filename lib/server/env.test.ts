import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvError, allowedUserId, anthropicApiKey, falKey, type ServerEnvName } from './env';

// Valeur témoin : si elle apparaît dans un message d'erreur, une valeur a fuité.
const SENTINEL = 'ne-pas-afficher';

function errorOf(read: () => unknown): EnvError {
  try {
    read();
  } catch (error) {
    if (error instanceof EnvError) return error;
    throw error;
  }
  throw new Error("La lecture aurait dû échouer.");
}

function expectNoLeak(error: EnvError) {
  expect(error.message).not.toContain(SENTINEL);
  expect(String(error.stack)).not.toContain(SENTINEL);
  expect(JSON.stringify(error)).not.toContain(SENTINEL);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const readers: [ServerEnvName, () => unknown][] = [
  ['ANTHROPIC_API_KEY', anthropicApiKey],
  ['FAL_KEY', falKey],
  ['ALLOWED_USER_ID', allowedUserId],
];

describe('lib/server/env', () => {
  it.each(readers)('%s absente : l’erreur nomme la variable', (name, read) => {
    vi.stubEnv(name, '');
    const error = errorOf(read);
    expect(error.variable).toBe(name);
    expect(error.reason).toBe('absente');
    expect(error.message).toContain(name);
  });

  it('une variable non définie du tout est aussi signalée', () => {
    vi.stubEnv('FAL_KEY', undefined);
    expect(errorOf(falKey).message).toContain('FAL_KEY');
  });

  it("l'erreur ne recopie jamais la valeur des autres variables", () => {
    for (const [name] of readers) vi.stubEnv(name, SENTINEL);
    vi.stubEnv('FAL_KEY', '');
    const error = errorOf(falKey);
    expect(error.message).toContain('FAL_KEY');
    expectNoLeak(error);
  });

  it('ALLOWED_USER_ID invalide : nomme la variable sans recopier sa valeur', () => {
    vi.stubEnv('ALLOWED_USER_ID', SENTINEL);
    const error = errorOf(allowedUserId);
    expect(error.reason).toBe('invalide');
    expect(error.message).toContain('ALLOWED_USER_ID');
    expectNoLeak(error);
  });

  it('lit la valeur au moment de l’appel, pas au chargement du module', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'premiere');
    expect(anthropicApiKey()).toBe('premiere');
    vi.stubEnv('ANTHROPIC_API_KEY', 'seconde');
    expect(anthropicApiKey()).toBe('seconde');
  });

  it('ALLOWED_USER_ID est rendu en minuscules', () => {
    vi.stubEnv('ALLOWED_USER_ID', ' 0A1B2C3D-0000-4000-8000-00000000ABCD ');
    expect(allowedUserId()).toBe('0a1b2c3d-0000-4000-8000-00000000abcd');
  });
});
