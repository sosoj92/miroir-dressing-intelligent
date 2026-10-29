import { afterEach, describe, expect, it, vi } from 'vitest';
import { WEATHER_TIMEOUT_MS, fetchDayWeather, forecastUrl, isRainCode, weatherLabel, type Place } from './index';

const PARIS: Place = { lat: 48.8566, lon: 2.3522, timezone: 'Europe/Paris' };
const DATE = '2026-10-24';

const OK_JSON = {
  latitude: 48.86,
  longitude: 2.3399997,
  timezone: 'Europe/Paris',
  daily: {
    time: [DATE],
    temperature_2m_max: [17.2],
    temperature_2m_min: [9.1],
    weather_code: [3],
    precipitation_probability_max: [20],
    precipitation_sum: [0],
  },
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn(async () => body),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('forecastUrl', () => {
  it('demande un seul jour en données journalières, dans le fuseau du lieu', () => {
    const url = new URL(forecastUrl(PARIS, DATE)!);
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('48.8566');
    expect(url.searchParams.get('longitude')).toBe('2.3522');
    expect(url.searchParams.get('timezone')).toBe('Europe/Paris');
    expect(url.searchParams.get('start_date')).toBe(DATE);
    expect(url.searchParams.get('end_date')).toBe(DATE);
    expect(url.searchParams.get('daily')?.split(',')).toEqual([
      'temperature_2m_max',
      'temperature_2m_min',
      'weather_code',
      'precipitation_probability_max',
      'precipitation_sum',
    ]);
    expect(url.search).not.toMatch(/key|apikey|token/i);
  });

  it('refuse un lieu ou une date invalides', () => {
    expect(forecastUrl(PARIS, '24/10/2026')).toBeNull();
    expect(forecastUrl(PARIS, '2026-02-30')).toBeNull();
    expect(forecastUrl({ ...PARIS, lat: Number.NaN }, DATE)).toBeNull();
    expect(forecastUrl({ ...PARIS, lat: 91 }, DATE)).toBeNull();
    expect(forecastUrl({ ...PARIS, lon: -181 }, DATE)).toBeNull();
    expect(forecastUrl({ ...PARIS, timezone: '' }, DATE)).toBeNull();
    expect(forecastUrl({ ...PARIS, timezone: 'Pas/Un_Fuseau' }, DATE)).toBeNull();
  });
});

describe('fetchDayWeather', () => {
  it('renvoie la météo du jour lue dans la réponse', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OK_JSON));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchDayWeather(PARIS, DATE)).resolves.toEqual({
      date: DATE,
      tempMin: 9,
      tempMax: 17,
      temp: 17,
      code: 3,
      rain: false,
      label: 'Couvert',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('borne la requête par un délai (AbortSignal)', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void url;
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse(OK_JSON);
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchDayWeather(PARIS, DATE);
    expect(timeout).toHaveBeenCalledWith(WEATHER_TIMEOUT_MS);
    expect(fetchMock.mock.calls[0][0]).toBe(forecastUrl(PARIS, DATE));
  });

  it('renvoie null si Open-Meteo répond une erreur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: true, reason: 'x' }, { ok: false, status: 400 })));
    await expect(fetchDayWeather(PARIS, DATE)).resolves.toBeNull();
  });

  it('renvoie null si le réseau échoue ou si le délai expire, sans exception', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    await expect(fetchDayWeather(PARIS, DATE)).resolves.toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new DOMException('timeout', 'TimeoutError'))));
    await expect(fetchDayWeather(PARIS, DATE)).resolves.toBeNull();
  });

  it('renvoie null si la réponse n’est pas du JSON attendu', async () => {
    const broken = { ok: true, status: 200, json: vi.fn(async () => Promise.reject(new SyntaxError('Unexpected token'))) };
    vi.stubGlobal('fetch', vi.fn(async () => broken));
    await expect(fetchDayWeather(PARIS, DATE)).resolves.toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ daily: { time: ['2026-10-25'] } })));
    await expect(fetchDayWeather(PARIS, DATE)).resolves.toBeNull();
  });

  it('n’appelle pas le réseau pour une date ou un lieu invalides', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OK_JSON));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchDayWeather(PARIS, 'demain')).resolves.toBeNull();
    await expect(fetchDayWeather({ lat: 0, lon: 0, timezone: 'nulle/part' }, DATE)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('expose aussi les libellés et le test de pluie', () => {
    expect(weatherLabel(61)).toBe('Pluie');
    expect(isRainCode(61)).toBe(true);
  });
});
