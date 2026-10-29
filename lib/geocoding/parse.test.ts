import { describe, expect, it } from 'vitest';
import {
  geocodingUrl,
  isValidTimeZone,
  normalizeCityQuery,
  parseCity,
  parseGeocodingResponse,
} from './parse';

// Extrait d'une vraie réponse d'Open-Meteo (champs réduits).
const LYON = {
  id: 2996944,
  name: 'Lyon',
  latitude: 45.74846,
  longitude: 4.84671,
  elevation: 170,
  feature_code: 'PPLA',
  country_code: 'FR',
  timezone: 'Europe/Paris',
  population: 522969,
  country: 'France',
  admin1: 'Auvergne-Rhône-Alpes',
  admin2: 'Rhône',
};

describe('geocodingUrl', () => {
  it("construit l'URL d'Open-Meteo avec 5 résultats en français", () => {
    expect(geocodingUrl('Saint-Étienne')).toBe(
      'https://geocoding-api.open-meteo.com/v1/search?name=Saint-%C3%89tienne&count=5&language=fr&format=json',
    );
  });

  it('encode les caractères spéciaux du texte cherché', () => {
    const url = new URL(geocodingUrl('a&count=500'));
    expect(url.searchParams.get('name')).toBe('a&count=500');
    expect(url.searchParams.get('count')).toBe('5');
  });
});

describe('normalizeCityQuery', () => {
  it('nettoie les espaces et borne la longueur', () => {
    expect(normalizeCityQuery('  Aix  en  Provence ')).toBe('Aix en Provence');
    expect(normalizeCityQuery('a')).toBeNull();
    expect(normalizeCityQuery('x'.repeat(81))).toBeNull();
    expect(normalizeCityQuery(42)).toBeNull();
  });
});

describe('parseGeocodingResponse', () => {
  it('renvoie nom, coordonnées, fuseau et un libellé avec région et pays', () => {
    expect(parseGeocodingResponse({ results: [LYON], generationtime_ms: 0.5 })).toEqual([
      {
        name: 'Lyon',
        label: 'Lyon, Auvergne-Rhône-Alpes, France',
        lat: 45.74846,
        lon: 4.84671,
        timezone: 'Europe/Paris',
      },
    ]);
  });

  it('sans résultat, Open-Meteo omet `results` : liste vide', () => {
    expect(parseGeocodingResponse({ generationtime_ms: 0.3 })).toEqual([]);
    expect(parseGeocodingResponse(null)).toEqual([]);
    expect(parseGeocodingResponse({ results: 'non' })).toEqual([]);
  });

  it('ignore les entrées incomplètes ou invalides, et les doublons de libellé', () => {
    const results = parseGeocodingResponse({
      results: [
        { ...LYON, timezone: undefined },
        { ...LYON, latitude: 200 },
        { ...LYON, name: '' },
        LYON,
        { ...LYON, id: 1 },
        { name: 'Lyons', latitude: 43.1, longitude: -77, timezone: 'America/New_York', country: 'États-Unis' },
      ],
    });
    expect(results.map((r) => r.label)).toEqual(['Lyon, Auvergne-Rhône-Alpes, France', 'Lyons, États-Unis']);
  });

  it('garde au plus 5 villes', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...LYON, name: `Lyon ${i}` }));
    expect(parseGeocodingResponse({ results: many })).toHaveLength(5);
  });
});

describe('parseCity et isValidTimeZone', () => {
  it('accepte une ville complète', () => {
    expect(parseCity({ name: ' Paris ', lat: 48.85, lon: 2.35, timezone: 'Europe/Paris' })).toEqual({
      name: 'Paris',
      lat: 48.85,
      lon: 2.35,
      timezone: 'Europe/Paris',
    });
  });

  it('refuse les coordonnées hors bornes, les fuseaux inconnus et les noms vides', () => {
    expect(parseCity({ name: 'Paris', lat: 91, lon: 2, timezone: 'Europe/Paris' })).toBeNull();
    expect(parseCity({ name: 'Paris', lat: 48, lon: Number.NaN, timezone: 'Europe/Paris' })).toBeNull();
    expect(parseCity({ name: 'Paris', lat: '48', lon: 2, timezone: 'Europe/Paris' })).toBeNull();
    expect(parseCity({ name: '', lat: 48, lon: 2, timezone: 'Europe/Paris' })).toBeNull();
    expect(parseCity({ name: 'Paris', lat: 48, lon: 2, timezone: 'Europe/Atlantis' })).toBeNull();
    expect(parseCity(null)).toBeNull();
  });

  it('valide les fuseaux avec Intl', () => {
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    expect(isValidTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Europe/Nowhere')).toBe(false);
    expect(isValidTimeZone('../etc/passwd')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(1)).toBe(false);
  });
});
