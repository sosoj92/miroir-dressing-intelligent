import 'server-only';
import { geocodingUrl, parseGeocodingResponse, type CityResult } from './parse';

// Appel réseau du géocodage, côté serveur uniquement (AGENTS.md : API externes côté serveur).

export { normalizeCityQuery, parseCity, isValidTimeZone } from './parse';
export type { City, CityResult } from './parse';

const TIMEOUT_MS = 5000;

export class GeocodingError extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? 'Géocodage indisponible.' : `Géocodage indisponible (HTTP ${status}).`);
    this.name = 'GeocodingError';
  }
}

/** Jusqu'à 5 villes pour un texte déjà validé par `normalizeCityQuery`. */
export async function searchCities(query: string, fetchImpl: typeof fetch = fetch): Promise<CityResult[]> {
  let response: Response;
  try {
    response = await fetchImpl(geocodingUrl(query), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new GeocodingError(null);
  }
  if (!response.ok) throw new GeocodingError(response.status);
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new GeocodingError(response.status);
  }
  return parseGeocodingResponse(json);
}
