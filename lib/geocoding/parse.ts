// Recherche de ville (Réglages) avec le géocodage d'Open-Meteo, sans clé (docs/conception.md §9 : seule la ville
// sort). Fonctions pures : construction de l'URL, lecture de la réponse, validation d'une ville.

export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const GEOCODING_RESULTS = 5;

/** Open-Meteo ne cherche rien en dessous de 2 caractères. */
export const CITY_QUERY_MIN = 2;
export const CITY_QUERY_MAX = 80;
export const CITY_NAME_MAX = 80;

export type City = { name: string; lat: number; lon: number; timezone: string };

/** Une ville proposée : `label` ajoute la région et le pays pour distinguer les homonymes. */
export type CityResult = City & { label: string };

const TIME_ZONE_PATTERN = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/;

/** Fuseau IANA accepté par Intl (« Europe/Paris », « UTC »…). */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64 || !TIME_ZONE_PATTERN.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function charCount(value: string): number {
  return Array.from(value).length;
}

/** Texte de recherche nettoyé, ou null s'il est trop court ou trop long. */
export function normalizeCityQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const query = collapse(value);
  const length = charCount(query);
  return length >= CITY_QUERY_MIN && length <= CITY_QUERY_MAX ? query : null;
}

/** https://geocoding-api.open-meteo.com/v1/search?name=…&count=5&language=fr&format=json */
export function geocodingUrl(query: string): string {
  const params = new URLSearchParams({
    name: query,
    count: String(GEOCODING_RESULTS),
    language: 'fr',
    format: 'json',
  });
  return `${GEOCODING_URL}?${params.toString()}`;
}

function isLatitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isLongitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

function cityName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = collapse(value);
  const length = charCount(name);
  return length >= 1 && length <= CITY_NAME_MAX ? name : null;
}

/**
 * Valide une ville reçue du navigateur ou d'un fichier : nom de 1 à 80 caractères, coordonnées
 * dans les bornes, fuseau reconnu par Intl. Renvoie null sinon.
 */
export function parseCity(input: unknown): City | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  const name = cityName(source.name);
  if (!name || !isLatitude(source.lat) || !isLongitude(source.lon) || !isValidTimeZone(source.timezone)) {
    return null;
  }
  return { name, lat: source.lat, lon: source.lon, timezone: source.timezone };
}

/**
 * Lit la réponse d'Open-Meteo (`{ results: [{ name, latitude, longitude, timezone, admin1, country }] }`).
 * Sans résultat, Open-Meteo omet `results`. Les entrées incomplètes sont ignorées.
 */
export function parseGeocodingResponse(json: unknown): CityResult[] {
  if (!json || typeof json !== 'object') return [];
  const results = (json as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];

  const cities: CityResult[] = [];
  const labels = new Set<string>();
  for (const entry of results) {
    if (!entry || typeof entry !== 'object') continue;
    const source = entry as Record<string, unknown>;
    const city = parseCity({
      name: source.name,
      lat: source.latitude,
      lon: source.longitude,
      timezone: source.timezone,
    });
    if (!city) continue;

    const parts = [city.name];
    for (const extra of [source.admin1, source.country]) {
      const text = typeof extra === 'string' ? collapse(extra) : '';
      if (text && !parts.includes(text)) parts.push(text);
    }
    const label = parts.join(', ');
    if (labels.has(label)) continue;
    labels.add(label);
    cities.push({ ...city, label });
    if (cities.length === GEOCODING_RESULTS) break;
  }
  return cities;
}
