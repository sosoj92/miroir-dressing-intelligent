import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseKeyMap } from '@/lib/keys/parse';
import { DEFAULT_TIME_ZONE } from '@/lib/dates';
import type { Profile } from '@/lib/types';

// La ligne `profile` du compte connecté (RLS : owner = auth.uid()). Elle est créée avec
// les valeurs par défaut de la base au premier accès.

const PROFILE_COLUMNS =
  'photo_path, city, lat, lon, timezone, key_map, key_test_requested, gestures_enabled, gesture_sensitivity, tryon_cap_eur, evening_hour';

type ProfileRow = Omit<Profile, 'key_map'> & { key_map: unknown };

function normalize(row: ProfileRow): Profile {
  return {
    photo_path: row.photo_path ?? null,
    city: row.city,
    lat: Number(row.lat),
    lon: Number(row.lon),
    timezone: row.timezone || DEFAULT_TIME_ZONE,
    key_map: parseKeyMap(row.key_map),
    key_test_requested: Boolean(row.key_test_requested),
    gestures_enabled: Boolean(row.gestures_enabled),
    gesture_sensitivity: Number(row.gesture_sensitivity),
    tryon_cap_eur: Number(row.tryon_cap_eur),
    evening_hour: Number(row.evening_hour),
  };
}

const UNIQUE_VIOLATION = '23505';

/** Lit le profil, et le crée avec les valeurs par défaut s'il n'existe pas encore. */
export async function getProfile(supabase: SupabaseClient): Promise<Profile> {
  const { data, error } = await supabase.from('profile').select(PROFILE_COLUMNS).maybeSingle<ProfileRow>();
  if (error) throw error;
  if (data) return normalize(data);

  // owner prend auth.uid() par défaut ; city est passée pour ne pas envoyer un objet vide.
  const inserted = await supabase
    .from('profile')
    .insert({ city: 'Paris' })
    .select(PROFILE_COLUMNS)
    .single<ProfileRow>();
  if (!inserted.error) return normalize(inserted.data);
  if (inserted.error.code !== UNIQUE_VIOLATION) throw inserted.error;

  // Créé entre-temps par une autre requête : on relit.
  const again = await supabase.from('profile').select(PROFILE_COLUMNS).single<ProfileRow>();
  if (again.error) throw again.error;
  return normalize(again.data);
}

export type ProfilePatch = Partial<Profile>;

/** Met à jour quelques champs du profil. RLS limite la mise à jour à la ligne du compte. */
export async function updateProfile(supabase: SupabaseClient, userId: string, patch: ProfilePatch): Promise<void> {
  const { error } = await supabase
    .from('profile')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('owner', userId);
  if (error) throw error;
}
