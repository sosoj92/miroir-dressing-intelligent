'use server';

import { revalidatePath } from 'next/cache';
import { SERVER_ERROR, actionFailure } from '@/components/gestion/action-errors';
import type { AssemblyActionResult, AssemblyCleanupResult } from '@/lib/import/assemblage';
import {
  removeReplacedFiles,
  runAssemblyImport,
  validateAssemblyBatch,
  validateAssemblyCleanup,
} from '@/lib/import/assemblage-server';
import type { ImportActionResult } from '@/lib/import/batches';
import { runImport } from '@/lib/import/server';
import { validateImportBatch } from '@/lib/import/validate';
import { requireUser } from '@/lib/server/auth';
import { forgetDisplayUrls } from '@/lib/server/display-urls';
import { createClient } from '@/lib/supabase/server';

/**
 * Import du prototype (docs/conception.md §3.1), un envoi à la fois. Les images sont déjà dans Storage : on ne
 * reçoit que les fiches converties et leurs chemins. Aucun appel à Bria ni à Claude ici.
 */
export async function importPrototype(input: unknown): Promise<ImportActionResult> {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch (error) {
    return actionFailure('importPrototype', error, SERVER_ERROR);
  }

  const validation = validateImportBatch(input, userId);
  if (!validation.ok) return validation;

  try {
    const supabase = await createClient();
    const counts = await runImport(supabase, userId, validation.batch, new Date());
    return { ok: true, counts };
  } catch (error) {
    return actionFailure('importPrototype', error, "L'import a échoué. Réessaie.");
  } finally {
    // Les images du lot sont déjà réécrites aux mêmes chemins (envoyées avant cet appel), même si
    // l'enregistrement échoue : de nouvelles URL les font recharger.
    forgetDisplayUrls(userId);
  }
}

/**
 * Import du paquet d'assemblage (docs/conception.md §3.2), un envoi à la fois (moins de 900 Ko). Les photos
 * portées sont déjà dans Storage, sous `<userId>/assemblage/…` : on ne reçoit que les fiches,
 * leurs chemins et leurs repères, revérifiés ici. Rejouable : rangé par (owner, legacy_id).
 */
export async function importAssembly(input: unknown): Promise<AssemblyActionResult> {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch (error) {
    return actionFailure('importAssembly', error, SERVER_ERROR);
  }

  const validation = validateAssemblyBatch(input, userId);
  if (!validation.ok) return validation;

  try {
    const supabase = await createClient();
    const { counts, replaced } = await runAssemblyImport(supabase, userId, validation.items);
    revalidatePath('/gestion/garde-robe');
    return { ok: true, counts, replaced };
  } catch (error) {
    return actionFailure('importAssembly', error, "L'import a échoué. Réessaie : il reprend sans doublon.");
  } finally {
    // Comme pour le prototype : photos déjà réécrites aux mêmes chemins, réussite ou non.
    forgetDisplayUrls(userId);
  }
}

/**
 * Fin de l'import du paquet d'assemblage, appelée une fois tous les envois écrits : les fichiers
 * que les envois ont remplacés (`replaced` de chaque envoi) sont supprimés de Storage s'ils ne
 * servent plus à aucune pièce (docs/conception.md §3.2). Seuls les chemins du compte sont candidats.
 */
export async function finishAssemblyImport(input: unknown): Promise<AssemblyCleanupResult> {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch (error) {
    return actionFailure('finishAssemblyImport', error, SERVER_ERROR);
  }

  const validation = validateAssemblyCleanup(input);
  if (!validation.ok) return validation;

  try {
    const supabase = await createClient();
    await removeReplacedFiles(supabase, userId, validation.paths);
    return { ok: true };
  } catch (error) {
    return actionFailure('finishAssemblyImport', error, SERVER_ERROR);
  }
}
