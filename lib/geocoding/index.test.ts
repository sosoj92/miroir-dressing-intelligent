import { describe, expect, it, vi } from 'vitest';
import { GeocodingError, searchCities } from './index';

describe('searchCities (fetch simulé, sans réseau)', () => {
  it("appelle Open-Meteo et lit la réponse", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        results: [{ name: 'Nantes', latitude: 47.21, longitude: -1.55, timezone: 'Europe/Paris', country: 'France' }],
      }),
    );
    const results = await searchCities('Nantes', fetchMock as unknown as typeof fetch);
    expect(results).toEqual([
      { name: 'Nantes', label: 'Nantes, France', lat: 47.21, lon: -1.55, timezone: 'Europe/Paris' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://geocoding-api.open-meteo.com/v1/search?name=Nantes&count=5&language=fr&format=json');
  });

  it('signale une erreur HTTP sans recopier la réponse', async () => {
    const fetchMock = vi.fn(async () => new Response('détail interne', { status: 502 }));
    await expect(searchCities('Nantes', fetchMock as unknown as typeof fetch)).rejects.toEqual(
      new GeocodingError(502),
    );
  });

  it('signale une coupure réseau', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(searchCities('Nantes', fetchMock as unknown as typeof fetch)).rejects.toBeInstanceOf(GeocodingError);
  });
});
