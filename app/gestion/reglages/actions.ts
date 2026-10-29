'use server';

import { SERVER_ERROR, actionFailure, type ActionFailure, type ActionResult } from '@/components/gestion/action-errors';
import { normalizeCityQuery, parseCity, searchCities, type CityResult } from '@/lib/geocoding';
import { requireUser } from '@/lib/server/auth';
import { getProfile, updateProfile, type ProfilePatch } from '@/lib/server/profile';
import { createClient } from '@/lib/supabase/server';
import { isEveningHour } from './evening-hour';

// Réglages du téléphone (docs/conception.md §4, écran 4) : ville et heure de « Préparer demain ».
// Chaque action vérifie la session elle-même, puis valide ce qu'elle reçoit du navigateur.

async function authenticate(context: string): Promise<{ ok: true; userId: string } | ActionFailure> {
  try {
    return { ok: true, userId: (await requireUser()).id };
  } catch (error) {
    return actionFailure(context, error, SERVER_ERROR);
  }
}

async function saveProfile(context: string, userId: string, patch: ProfilePatch): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    await getProfile(supabase); // crée la ligne si elle n'existe pas encore
    await updateProfile(supabase, userId, patch);
    return { ok: true };
  } catch (error) {
    return actionFailure(context, error, "Le réglage n'a pas pu être enregistré. Réessaie.");
  }
}

export type CitySearchResult = { ok: true; results: CityResult[] } | ActionFailure;

/** Jusqu'à 5 villes, cherchées par le serveur chez Open-Meteo (seule la ville sort, docs/conception.md §9). */
export async function searchCity(query: unknown): Promise<CitySearchResult> {
  const auth = await authenticate('searchCity');
  if (!auth.ok) return auth;
  const normalized = normalizeCityQuery(query);
  if (!normalized) return { ok: false, error: 'Tape au moins 2 lettres.' };
  try {
    return { ok: true, results: await searchCities(normalized) };
  } catch (error) {
    return actionFailure('searchCity', error, 'La recherche ne répond pas. Réessaie.');
  }
}

/** Enregistre la ville choisie : nom, coordonnées et fuseau validé avec Intl. */
export async function saveCity(input: unknown): Promise<ActionResult> {
  const auth = await authenticate('saveCity');
  if (!auth.ok) return auth;
  const city = parseCity(input);
  if (!city) return { ok: false, error: 'Ville invalide.' };
  return saveProfile('saveCity', auth.userId, {
    city: city.name,
    lat: city.lat,
    lon: city.lon,
    timezone: city.timezone,
  });
}

/** Heure à partir de laquelle le miroir propose la tenue de demain (12 à 23). */
export async function saveEveningHour(hour: unknown): Promise<ActionResult> {
  const auth = await authenticate('saveEveningHour');
  if (!auth.ok) return auth;
  if (!isEveningHour(hour)) return { ok: false, error: 'Heure invalide.' };
  return saveProfile('saveEveningHour', auth.userId, { evening_hour: hour });
}
