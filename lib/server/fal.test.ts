import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  BRIA_COST_USD,
  FAL_BRIA_ENDPOINT,
  FalError,
  falHeaders,
  readFalImageUrl,
  removeBackground,
} from './fal';
import { EnvError } from './env';

// fetch simulé : aucun appel réseau. Valeurs factices, qui ne ressemblent à aucune vraie clé.
const KEY = 'cle-fal-factice';
const SIGNED_URL = 'https://projet.supabase.co/storage/v1/object/sign/items/u/p.jpg?token=jeton-factice';
const RESULT_URL = 'https://v3.fal.media/files/tiger/resultat.png';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let fetchMock: ReturnType<typeof vi.fn>;
let consoleSpies: MockInstance[];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function imageResponse(type = 'image/png') {
  return new Response(PNG, { status: 200, headers: { 'content-type': type } });
}

/** Rien de ce qui passe par la console ne contient la clé ni le jeton de l'URL signée. */
function expectNoSecretLogged() {
  for (const spy of consoleSpies) {
    for (const call of spy.mock.calls) {
      const text = call.map((part) => (part instanceof Error ? `${part.name} ${part.message}` : String(part))).join(' ');
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('jeton-factice');
    }
  }
}

beforeEach(() => {
  vi.stubEnv('FAL_KEY', KEY);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
});

afterEach(() => {
  expectNoSecretLogged();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('falHeaders', () => {
  it('porte la clé, Store-IO à 0 et une expiration d’1 h (docs/conception.md §9)', () => {
    const headers = falHeaders();
    expect(headers.Authorization).toBe(`Key ${KEY}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Fal-Store-IO']).toBe('0');
    expect(JSON.parse(headers['X-Fal-Object-Lifecycle-Preference'])).toEqual({ expiration_duration_seconds: 3600 });
  });

  it('sans FAL_KEY : EnvError qui nomme la variable, jamais de valeur', () => {
    vi.stubEnv('FAL_KEY', '');
    expect(() => falHeaders()).toThrow(EnvError);
    try {
      falHeaders();
    } catch (error) {
      expect(error).toMatchObject({ variable: 'FAL_KEY', reason: 'absente' });
    }
  });
});

describe('readFalImageUrl', () => {
  it('lit image.url, puis images[0].url', () => {
    expect(readFalImageUrl({ image: { url: RESULT_URL, content_type: 'image/png' } })).toBe(RESULT_URL);
    expect(readFalImageUrl({ images: [{ url: RESULT_URL }] })).toBe(RESULT_URL);
  });

  it('refuse les réponses inattendues et les URL non HTTPS', () => {
    for (const body of [null, 'ok', {}, { image: {} }, { image: { url: 42 } }, { images: [] }, { image: { url: 'http://x.fal.media/a.png' } }, { image: { url: 'pas une url' } }]) {
      expect(readFalImageUrl(body), JSON.stringify(body)).toBeNull();
    }
  });
});

describe('removeBackground', () => {
  it('envoie l’URL signée avec les en-têtes de fal.ai, puis télécharge le PNG sans la clé', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ image: { url: RESULT_URL, content_type: 'image/png' } }));
    fetchMock.mockResolvedValueOnce(imageResponse());
    const onCost = vi.fn();

    const image = await removeBackground(SIGNED_URL, { onCost });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe(FAL_BRIA_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ image_url: SIGNED_URL });
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Key ${KEY}`);
    expect(headers['X-Fal-Store-IO']).toBe('0');
    expect(JSON.parse(headers['X-Fal-Object-Lifecycle-Preference'])).toEqual({ expiration_duration_seconds: 3600 });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const [downloadUrl, downloadInit] = fetchMock.mock.calls[1] as [string, RequestInit | undefined];
    expect(downloadUrl).toBe(RESULT_URL);
    expect(JSON.stringify(downloadInit?.headers ?? {})).not.toContain(KEY);

    expect(image.contentType).toBe('image/png');
    expect(new Uint8Array(image.data)).toEqual(PNG);
    expect(onCost).toHaveBeenCalledWith(BRIA_COST_USD);
  });

  it('accepte aussi images[0].url', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ images: [{ url: RESULT_URL }] }));
    fetchMock.mockResolvedValueOnce(imageResponse());
    await expect(removeBackground(SIGNED_URL)).resolves.toMatchObject({ contentType: 'image/png' });
  });

  it('réponse inattendue : erreur propre, rien de facturé ni téléchargé', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'quelque chose' }));
    const onCost = vi.fn();
    const error = await removeBackground(SIGNED_URL, { onCost }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FalError);
    expect(error).toMatchObject({ name: 'FalError', reason: 'reponse' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onCost).not.toHaveBeenCalled();
  });

  it('corps qui n’est pas du JSON : erreur propre', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    await expect(removeBackground(SIGNED_URL)).rejects.toMatchObject({ reason: 'reponse' });
  });

  it('erreur HTTP : le statut seulement, ni URL ni clé dans le message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: `image ${SIGNED_URL} illisible` }, 422));
    const error = (await removeBackground(SIGNED_URL).catch((caught: unknown) => caught)) as FalError;
    expect(error).toMatchObject({ reason: 'requete', status: 422 });
    expect(error.message).not.toContain('jeton-factice');
    expect(error.message).not.toContain(KEY);
  });

  it('sans FAL_KEY : EnvError, aucun appel réseau', async () => {
    vi.stubEnv('FAL_KEY', '');
    await expect(removeBackground(SIGNED_URL)).rejects.toBeInstanceOf(EnvError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('délai dépassé : FalError « delai »', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
    await expect(removeBackground(SIGNED_URL)).rejects.toMatchObject({ reason: 'delai' });
  });

  it('erreur réseau : FalError « requete »', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(removeBackground(SIGNED_URL)).rejects.toMatchObject({ reason: 'requete' });
  });

  it('téléchargement qui n’est pas une image : erreur, mais l’appel facturé est compté', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ image: { url: RESULT_URL } }));
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const onCost = vi.fn();
    await expect(removeBackground(SIGNED_URL, { onCost })).rejects.toMatchObject({ reason: 'telechargement' });
    expect(onCost).toHaveBeenCalledWith(BRIA_COST_USD);
  });

  it('un détourage qui n’est pas un PNG est refusé', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ image: { url: RESULT_URL } }));
    fetchMock.mockResolvedValueOnce(imageResponse('image/jpeg'));
    await expect(removeBackground(SIGNED_URL)).rejects.toMatchObject({ reason: 'reponse' });
  });

  it('un échec du suivi de dépense ne fait pas échouer le détourage', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ image: { url: RESULT_URL } }));
    fetchMock.mockResolvedValueOnce(imageResponse());
    const onCost = vi.fn().mockRejectedValue(new Error('base indisponible'));
    await expect(removeBackground(SIGNED_URL, { onCost })).resolves.toMatchObject({ contentType: 'image/png' });
  });
});
