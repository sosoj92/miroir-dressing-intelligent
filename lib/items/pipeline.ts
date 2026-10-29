import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ItemDraft } from '@/lib/types';
import { isTransparentCutout } from '@/lib/images/png-alpha';
import { describeGarment } from '@/lib/server/claude';
import { EnvError, type ServerEnvName } from '@/lib/server/env';
import { removeBackground } from '@/lib/server/fal';
import { recordSpend } from '@/lib/server/spend';
import { errorName } from './errors';
import { cutoutPathFor, newUuid } from './paths';

// Détourage et fiche automatique d'une photo déjà rangée dans le bucket privé `items`
// (docs/conception.md §4, écran 3, étapes 2 et 3). Utilisé par l'ajout et par la fiche (« Relancer le détourage »).
// Les URL reçues ici sont signées (10 min) : elles ne sont jamais journalisées.
// Une photo PNG déjà détourée (fond transparent), envoyée par le téléphone à côté du JPEG, sert de
// détourage telle quelle après vérification : pas d'appel à fal.ai, rien à payer.

export const NOTICE_CUTOUT_KEY_MISSING =
  'Détourage indisponible : FAL_KEY absente. Une photo PNG déjà détourée (fond transparent) passe sans elle.';
export const NOTICE_DRAFT_KEY_MISSING = 'Fiche automatique indisponible : ANTHROPIC_API_KEY absente.';
export const NOTICE_CUTOUT_FAILED = 'Détourage indisponible pour le moment. Tu pourras le relancer depuis la fiche.';
export const NOTICE_DRAFT_FAILED = 'Fiche automatique indisponible pour le moment : remplis-la toi-même.';

/**
 * Détoure la photo (Bria sur fal.ai), copie le PNG dans le bucket privé sous un nouveau nom
 * `<userId>/<uuid>-cutout.png` (fal.ai l'efface au bout d'1 h), et renvoie ce chemin.
 * Le coût est enregistré dès que fal.ai a facturé.
 */
export async function cutOutPhoto(supabase: SupabaseClient, userId: string, photoUrl: string): Promise<string> {
  const image = await removeBackground(photoUrl, {
    onCost: (costUsd) => recordSpend(supabase, 'bria', costUsd, 'détourage'),
  });
  const path = cutoutPathFor(userId, newUuid());
  const { error } = await supabase.storage
    .from('items')
    .upload(path, image.data, { contentType: image.contentType, upsert: false });
  if (error) throw error;
  return path;
}

/** Taille maximale d'un détourage relu (limite d'un fichier du bucket `items`). */
const MAX_CUTOUT_BYTES = 10 * 1024 * 1024;

/**
 * Vrai si le fichier du bucket est un PNG vraiment transparent (lib/images/png-alpha) : le serveur
 * revérifie ce que le navigateur a envoyé avant de l'enregistrer comme détourage.
 */
export async function isStoredTransparentCutout(supabase: SupabaseClient, path: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.storage.from('items').download(path);
    if (error || !data || data.size === 0 || data.size > MAX_CUTOUT_BYTES) return false;
    return isTransparentCutout(new Uint8Array(await data.arrayBuffer()));
  } catch (error) {
    console.error(`Lecture du détourage envoyé : ${errorName(error)}`);
    return false;
  }
}

/** Fiche proposée par la Claude API. Le coût est enregistré dès la réponse. */
export async function draftFromPhoto(supabase: SupabaseClient, photoUrl: string): Promise<ItemDraft> {
  return describeGarment(photoUrl, {
    onCost: (costUsd) => (costUsd > 0 ? recordSpend(supabase, 'claude', costUsd, 'fiche') : undefined),
  });
}

function isMissing(error: unknown, variable: ServerEnvName): boolean {
  return error instanceof EnvError && error.variable === variable && error.reason === 'absente';
}

/** Message à afficher quand le détourage a échoué ; journalise le nom de l'erreur. */
export function cutoutNotice(error: unknown): string {
  if (isMissing(error, 'FAL_KEY')) return NOTICE_CUTOUT_KEY_MISSING;
  console.error(`Détourage : ${errorName(error)}`);
  return NOTICE_CUTOUT_FAILED;
}

/** Message à afficher quand la fiche automatique a échoué ; journalise le nom de l'erreur. */
export function draftNotice(error: unknown): string {
  if (isMissing(error, 'ANTHROPIC_API_KEY')) return NOTICE_DRAFT_KEY_MISSING;
  console.error(`Fiche automatique : ${errorName(error)}`);
  return NOTICE_DRAFT_FAILED;
}

/** Supprime des fichiers du bucket `items` ; un échec est journalisé (nom seulement), jamais levé. */
export async function removeItemFiles(supabase: SupabaseClient, paths: Array<string | null | undefined>): Promise<void> {
  const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  if (unique.length === 0) return;
  try {
    const { error } = await supabase.storage.from('items').remove(unique);
    if (error) console.error(`Suppression de fichiers : ${errorName(error)}`);
  } catch (error) {
    console.error(`Suppression de fichiers : ${errorName(error)}`);
  }
}
