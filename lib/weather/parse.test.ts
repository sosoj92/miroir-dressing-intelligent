import { describe, expect, it } from 'vitest';
import { UNKNOWN_WEATHER_CODE, isRainCode, weatherLabel } from './codes';
import { RAIN_PROBABILITY_THRESHOLD, parseOpenMeteoDaily } from './parse';

// Réponse réelle d'Open-Meteo pour Paris, abrégée (un seul jour demandé).
const PARIS_RESPONSE = {
  latitude: 48.86,
  longitude: 2.3399997,
  generationtime_ms: 0.0629425048828125,
  utc_offset_seconds: 7200,
  timezone: 'Europe/Paris',
  timezone_abbreviation: 'GMT+2',
  elevation: 43,
  daily_units: {
    time: 'iso8601',
    temperature_2m_max: '°C',
    temperature_2m_min: '°C',
    weather_code: 'wmo code',
    precipitation_probability_max: '%',
    precipitation_sum: 'mm',
  },
  daily: {
    time: ['2026-10-24'],
    temperature_2m_max: [14.6],
    temperature_2m_min: [8.2],
    weather_code: [61],
    precipitation_probability_max: [78],
    precipitation_sum: [3.4],
  },
};

function dailyResponse(day: Partial<Record<string, unknown>>, time = ['2026-10-24']) {
  return {
    daily: {
      time,
      temperature_2m_max: [20],
      temperature_2m_min: [11],
      weather_code: [1],
      precipitation_probability_max: [10],
      precipitation_sum: [0],
      ...day,
    },
  };
}

describe('weatherLabel', () => {
  it('donne un libellé français pour chaque famille de codes WMO', () => {
    const cases: Record<number, string> = {
      0: 'Ciel dégagé',
      1: 'Éclaircies',
      2: 'Éclaircies',
      3: 'Couvert',
      45: 'Brouillard',
      48: 'Brouillard',
      51: 'Bruine',
      57: 'Bruine',
      61: 'Pluie',
      67: 'Pluie',
      71: 'Neige',
      77: 'Neige',
      80: 'Averses',
      82: 'Averses',
      85: 'Averses de neige',
      86: 'Averses de neige',
      95: 'Orage',
      99: 'Orage',
    };
    for (const [code, label] of Object.entries(cases)) expect(weatherLabel(Number(code)), code).toBe(label);
  });

  it('ne donne aucun libellé pour un code inconnu', () => {
    for (const code of [4, 10, 50, 83, 100, -1, 2.5, null, undefined]) expect(weatherLabel(code)).toBe('');
  });
});

describe('isRainCode', () => {
  it('compte la bruine, la pluie, les averses, la neige et l’orage', () => {
    for (const code of [51, 55, 57, 61, 65, 67, 71, 75, 77, 80, 82, 85, 86, 95, 96, 99]) {
      expect(isRainCode(code), String(code)).toBe(true);
    }
  });

  it('ne compte ni le ciel clair, ni les nuages, ni le brouillard', () => {
    for (const code of [0, 1, 2, 3, 45, 48, 83, 84, 100, UNKNOWN_WEATHER_CODE, null, undefined]) {
      expect(isRainCode(code), String(code)).toBe(false);
    }
  });
});

describe('parseOpenMeteoDaily', () => {
  it('lit une réponse réelle d’Open-Meteo', () => {
    expect(parseOpenMeteoDaily(PARIS_RESPONSE, '2026-10-24')).toEqual({
      date: '2026-10-24',
      tempMin: 8,
      tempMax: 15,
      temp: 15, // maximum du jour arrondi, comme dayTemperature dans le prototype
      code: 61,
      rain: true,
      label: 'Pluie',
    });
  });

  it('cherche le jour demandé dans la série, pas forcément le premier', () => {
    const json = dailyResponse(
      { temperature_2m_max: [20, 9.4], temperature_2m_min: [11, 2.6], weather_code: [1, 3] },
      ['2026-10-24', '2026-10-25'],
    );
    expect(parseOpenMeteoDaily(json, '2026-10-25')).toMatchObject({ tempMin: 3, tempMax: 9, temp: 9, code: 3 });
  });

  it('renvoie null si le jour manque ou si ses températures manquent', () => {
    expect(parseOpenMeteoDaily(dailyResponse({}), '2026-10-25')).toBeNull();
    expect(parseOpenMeteoDaily(dailyResponse({ temperature_2m_max: [null] }), '2026-10-24')).toBeNull();
    expect(parseOpenMeteoDaily(dailyResponse({ temperature_2m_min: [] }), '2026-10-24')).toBeNull();
    expect(parseOpenMeteoDaily(dailyResponse({ temperature_2m_max: ['20'] }), '2026-10-24')).toBeNull();
  });

  it('renvoie null pour une réponse inattendue, sans exception', () => {
    for (const json of [null, undefined, 42, 'texte', [], {}, { daily: null }, { daily: { time: 'x' } }]) {
      expect(parseOpenMeteoDaily(json, '2026-10-24')).toBeNull();
    }
    expect(parseOpenMeteoDaily({ error: true, reason: 'Parameter start_date is out of range' }, '2026-10-24')).toBeNull();
  });

  it('compte comme pluvieux un jour au code sec si la probabilité atteint le seuil', () => {
    const at = (probability: number) =>
      parseOpenMeteoDaily(dailyResponse({ weather_code: [3], precipitation_probability_max: [probability] }), '2026-10-24');
    expect(RAIN_PROBABILITY_THRESHOLD).toBe(50);
    expect(at(49)?.rain).toBe(false);
    expect(at(50)?.rain).toBe(true);
    expect(at(50)?.label).toBe('Couvert');
  });

  it('compte la neige et l’orage comme de la pluie, même à faible probabilité', () => {
    const at = (code: number) =>
      parseOpenMeteoDaily(dailyResponse({ weather_code: [code], precipitation_probability_max: [5] }), '2026-10-24');
    expect(at(73)).toMatchObject({ rain: true, label: 'Neige' });
    expect(at(95)).toMatchObject({ rain: true, label: 'Orage' });
    expect(at(0)).toMatchObject({ rain: false, label: 'Ciel dégagé' });
  });

  it('se passe du code ou de la probabilité quand ils manquent', () => {
    const json = dailyResponse({ weather_code: [null], precipitation_probability_max: [null] });
    expect(parseOpenMeteoDaily(json, '2026-10-24')).toEqual({
      date: '2026-10-24',
      tempMin: 11,
      tempMax: 20,
      temp: 20,
      code: UNKNOWN_WEATHER_CODE,
      rain: false,
      label: '',
    });
  });

  it('arrondit sans « -0 » sous zéro', () => {
    const weather = parseOpenMeteoDaily(dailyResponse({ temperature_2m_max: [-0.4], temperature_2m_min: [-6.6] }), '2026-10-24');
    expect(Object.is(weather?.tempMax, 0)).toBe(true);
    expect(weather?.tempMin).toBe(-7);
  });
});
