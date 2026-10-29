'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { RedirectType, redirect } from 'next/navigation';
import { SERVER_ERROR } from '@/components/gestion/action-errors';
import { AuthError, requireUser, type AllowedUser } from '@/lib/server/auth';
import { DISPLAY_URL_SECONDS, EXTERNAL_URL_SECONDS, assertOwnPath, signedUrl } from '@/lib/server/storage';
import { SupabaseNotConfiguredError } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { isCutoutPath, isUploadedPhotoPath } from '@/lib/items/paths';
import { removeUnusedItemFiles } from '@/lib/items/cleanup';
import { errorName } from '@/lib/items/errors';
import { itemFiles } from '@/lib/items/files';
import {
  cutOutPhoto,
  cutoutNotice,
  draftFromPhoto,
  draftNotice,
  isStoredTransparentCutout,
  removeItemFiles,
} from '@/lib/items/pipeline';
import type { ActionFailure, ActionResult, AnalyzeResult, NewItemInput } from '@/lib/items/results';
import { checkDraft, isUuid } from '@/lib/items/validate';
import type { ItemDraft } from '@/lib/types';

// Server actions de la garde-robe (téléphone). Chacune vérifie le compte avec requireUser(),
// valide tout ce qui vient du navigateur, et renvoie { ok: false, error } avec un message court
// plutôt que de laisser passer un détail interne. Les requêtes passent par le client serveur de
// la session : RLS limite tout aux lignes du compte et à son dossier du bucket `items`.

const GRID_PATH = '/gestion/garde-robe';
const NOT_FOUND = 'Vêtement introuvable.';
/** Pièce assemblée (repères d'une photo portée) : sa photo ne se change pas depuis la fiche. */
const ASSEMBLED_PHOTO = 'Cette pièce se change en réimportant le paquet.';

type Session = { ok: true; user: AllowedUser; supabase: SupabaseClient };

function fail(error: string): ActionFailure {
  return { ok: false, error };
}

async function openSession(): Promise<Session | ActionFailure> {
  try {
    const user = await requireUser();
    const supabase = await createClient();
    return { ok: true, user, supabase };
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message);
    if (error instanceof SupabaseNotConfiguredError) return fail("Supabase n'est pas encore configuré.");
    console.error(`Session : ${errorName(error)}`);
    return fail(SERVER_ERROR);
  }
}

/** Exécute l'action ; une erreur imprévue devient un message court, journalisée par son nom. */
async function guarded<T extends object>(
  label: string,
  run: (session: Session) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const session = await openSession();
  if (!session.ok) return session;
  try {
    return await run(session);
  } catch (error) {
    console.error(`${label} : ${errorName(error)}`);
    return fail(SERVER_ERROR);
  }
}

/** Chemin d'un fichier du bucket `items` appartenant au compte, ou null. */
function ownPath(userId: string, path: unknown): string | null {
  if (typeof path !== 'string' || path.length > 512) return null;
  try {
    return assertOwnPath(userId, path);
  } catch {
    return null;
  }
}

/** Photo envoyée par l'écran d'ajout : `<userId>/<uuid>.jpg`. */
function uploadedPhotoPath(userId: string, path: unknown): string | null {
  return isUploadedPhotoPath(userId, path) ? ownPath(userId, path) : null;
}

/** Détourage fait par le serveur, ou PNG transparent envoyé par le téléphone : `<userId>/<uuid>-cutout.png`. */
function cutoutPath(userId: string, path: unknown): string | null {
  return isCutoutPath(userId, path) ? ownPath(userId, path) : null;
}

/**
 * Détourage d'une nouvelle photo : le PNG transparent envoyé par le téléphone (`sent`, chemin déjà
 * vérifié) s'il l'est vraiment, revérifié ici, sans appel à fal.ai ; sinon Bria comme pour toute
 * photo. Un PNG refusé est effacé, sauf si une pièce s'en sert déjà.
 */
async function cutoutForUpload(
  supabase: SupabaseClient,
  userId: string,
  photoUrl: string,
  sent: string | null,
): Promise<string> {
  if (sent) {
    if (await isStoredTransparentCutout(supabase, sent)) return sent;
    await removeUnusedItemFiles(supabase, userId, [sent]);
  }
  return cutOutPhoto(supabase, userId, photoUrl);
}

async function displayUrl(supabase: SupabaseClient, path: string): Promise<string | null> {
  try {
    return await signedUrl(supabase, 'items', path, DISPLAY_URL_SECONDS);
  } catch {
    return null;
  }
}

function revalidateItem(id?: string) {
  revalidatePath(GRID_PATH);
  if (id) revalidatePath(`${GRID_PATH}/${id}`);
}

type PhotoPaths = { photo_path: unknown; cutout_path: unknown; assembly?: unknown };

/** Fichiers d'une pièce rangés dans le dossier du compte (photo, détourage, manches). */
function ownFiles(userId: string, row: PhotoPaths): string[] {
  return itemFiles(row)
    .map((path) => ownPath(userId, path))
    .filter((path): path is string => path !== null);
}

/**
 * Étapes 2 et 3 de l'ajout : la photo est déjà dans le bucket. Détourage (Bria) et fiche (Claude)
 * en parallèle ; ce qui échoue devient une remarque, et la fiche reste remplissable à la main.
 * `sentCutout` : PNG déjà détouré envoyé avec la photo (lib/images/upload.ts), gardé tel quel
 * s'il est vraiment transparent.
 */
export async function analyzePhoto(photoPath: string, sentCutout: string | null = null): Promise<AnalyzeResult> {
  return guarded('analyzePhoto', async ({ user, supabase }) => {
    const path = uploadedPhotoPath(user.id, photoPath);
    if (!path) return fail('Photo refusée.');
    let sent: string | null = null;
    if (sentCutout !== null && sentCutout !== undefined) {
      sent = cutoutPath(user.id, sentCutout);
      if (!sent) return fail('Détourage refusé.');
    }

    let photoUrl: string;
    try {
      photoUrl = await signedUrl(supabase, 'items', path, EXTERNAL_URL_SECONDS);
    } catch (error) {
      console.error(`analyzePhoto : ${errorName(error)}`);
      return fail('Photo introuvable. Reprends-la.');
    }

    const [cutout, draft] = await Promise.allSettled([
      cutoutForUpload(supabase, user.id, photoUrl, sent),
      draftFromPhoto(supabase, photoUrl),
    ]);

    const notices: string[] = [];
    let newCutoutPath: string | null = null;
    let cutoutUrl: string | null = null;
    if (cutout.status === 'fulfilled') {
      newCutoutPath = cutout.value;
      cutoutUrl = await displayUrl(supabase, newCutoutPath);
    } else {
      notices.push(cutoutNotice(cutout.reason));
    }

    let proposed: ItemDraft | null = null;
    if (draft.status === 'fulfilled') proposed = draft.value;
    else notices.push(draftNotice(draft.reason));

    return { ok: true, photoPath: path, cutoutPath: newCutoutPath, cutoutUrl, draft: proposed, notices };
  });
}

/** Étape 5 de l'ajout : enregistre la pièce corrigée, puis ouvre sa fiche. */
export async function createItem(input: NewItemInput): Promise<ActionResult<{ id: string }>> {
  const result = await guarded<{ id: string }>('createItem', async ({ user, supabase }) => {
    if (!input || typeof input !== 'object') return fail('Fiche illisible.');
    const source = input as Record<string, unknown>;

    const photo = uploadedPhotoPath(user.id, source.photoPath);
    if (!photo) return fail('Photo refusée.');
    let cutout: string | null = null;
    if (source.cutoutPath !== null && source.cutoutPath !== undefined) {
      cutout = cutoutPath(user.id, source.cutoutPath);
      if (!cutout) return fail('Détourage refusé.');
    }
    const check = checkDraft(source.draft);
    if (!check.ok) return check;

    const { data, error } = await supabase
      .from('items')
      .insert({ ...check.draft, photo_path: photo, cutout_path: cutout })
      .select('id')
      .single<{ id: string }>();
    if (error || !data) {
      console.error(`createItem : ${errorName(error)}`);
      return fail("Le vêtement n'a pas pu être enregistré. Réessaie.");
    }

    return { ok: true, id: data.id };
  });
  // Hors du try de `guarded` : redirect() lève une exception que Next.js transforme en navigation.
  // replace : le retour arrière depuis la fiche mène à la grille, pas à l'écran d'ajout terminé.
  if (result.ok) {
    revalidatePath(GRID_PATH);
    redirect(`${GRID_PATH}/${result.id}`, RedirectType.replace);
  }
  return result;
}

/** Retour à la grille, à jour, sans rendre de nouveau la page courante (fiche supprimée). */
function backToGrid(): never {
  revalidatePath(GRID_PATH);
  redirect(GRID_PATH, RedirectType.replace);
}

/** Corrige la fiche d'une pièce. On reste sur la fiche ; la grille et la fiche sont rafraîchies. */
export async function updateItem(id: string, draft: ItemDraft): Promise<ActionResult> {
  return guarded('updateItem', async ({ supabase }) => {
    if (!isUuid(id)) return fail(NOT_FOUND);
    const check = checkDraft(draft);
    if (!check.ok) return check;

    const { data, error } = await supabase.from('items').update(check.draft).eq('id', id).select('id');
    if (error) {
      console.error(`updateItem : ${errorName(error)}`);
      return fail("La fiche n'a pas pu être enregistrée. Réessaie.");
    }
    if (!data || data.length === 0) return fail(NOT_FOUND);

    revalidateItem(id);
    return { ok: true };
  });
}

/** Au sale oui ou non. */
export async function setDirty(id: string, dirty: boolean): Promise<ActionResult<{ dirty: boolean }>> {
  return guarded('setDirty', async ({ supabase }) => {
    if (!isUuid(id)) return fail(NOT_FOUND);
    if (typeof dirty !== 'boolean') return fail('Valeur refusée.');

    const { data, error } = await supabase.from('items').update({ dirty }).eq('id', id).select('id');
    if (error) {
      console.error(`setDirty : ${errorName(error)}`);
      return fail("Le changement n'a pas pu être enregistré. Réessaie.");
    }
    if (!data || data.length === 0) return fail(NOT_FOUND);

    revalidateItem(id);
    return { ok: true, dirty };
  });
}

/** Pièces modifiées en une fois au plus : bien plus que la garde-robe, une seule requête. */
const MAX_DIRTY_BATCH = 500;

/**
 * « Tout est lavé » : au sale oui ou non pour plusieurs pièces, en une requête et une seule
 * revalidation. Comme setDirty, RLS limite la mise à jour aux pièces du compte ; le filtre
 * `owner` le redit. `count` : pièces réellement modifiées.
 */
export async function setDirtyMany(
  ids: string[],
  dirty: boolean,
): Promise<ActionResult<{ dirty: boolean; count: number }>> {
  return guarded('setDirtyMany', async ({ user, supabase }) => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_DIRTY_BATCH || !ids.every(isUuid)) {
      return fail(NOT_FOUND);
    }
    if (typeof dirty !== 'boolean') return fail('Valeur refusée.');

    const { data, error } = await supabase
      .from('items')
      .update({ dirty })
      .in('id', [...new Set(ids)])
      .eq('owner', user.id)
      .select('id');
    if (error) {
      console.error(`setDirtyMany : ${errorName(error)}`);
      return fail("Le changement n'a pas pu être enregistré. Réessaie.");
    }
    if (!data || data.length === 0) return fail(NOT_FOUND);

    // 'layout' : la grille, la vue « au sale » et les fiches de toutes ces pièces, en un appel.
    revalidatePath(GRID_PATH, 'layout');
    return { ok: true, dirty, count: data.length };
  });
}

async function readPhotoPaths(supabase: SupabaseClient, id: string): Promise<PhotoPaths | null> {
  const { data, error } = await supabase
    .from('items')
    .select('photo_path, cutout_path, assembly')
    .eq('id', id)
    .maybeSingle<PhotoPaths>();
  if (error) throw error;
  return data;
}

/**
 * « Relancer le détourage » : même chemin que l'ajout, sur la photo déjà enregistrée. Seule une
 * photo à plat envoyée par le téléphone (`<userId>/<uuid>.jpg`) part chez fal.ai : une photo
 * importée de l'ancien format db.json montre la personne qui porte la pièce (docs/conception.md §3.1, §9).
 */
export async function redoCutout(id: string): Promise<ActionResult> {
  return guarded('redoCutout', async ({ user, supabase }) => {
    if (!isUuid(id)) return fail(NOT_FOUND);
    const item = await readPhotoPaths(supabase, id);
    if (!item) return fail(NOT_FOUND);
    const photo = uploadedPhotoPath(user.id, item.photo_path);
    if (!photo) return fail("Ce vêtement n'a pas de photo à détourer.");

    let photoUrl: string;
    try {
      photoUrl = await signedUrl(supabase, 'items', photo, EXTERNAL_URL_SECONDS);
    } catch (error) {
      console.error(`redoCutout : ${errorName(error)}`);
      return fail('Photo introuvable. Reprends-la.');
    }

    let newCutout: string;
    try {
      newCutout = await cutOutPhoto(supabase, user.id, photoUrl);
    } catch (error) {
      return fail(cutoutNotice(error));
    }

    const { data, error } = await supabase.from('items').update({ cutout_path: newCutout }).eq('id', id).select('id');
    if (error || !data || data.length === 0) {
      if (error) console.error(`redoCutout : ${errorName(error)}`);
      await removeItemFiles(supabase, [newCutout]);
      return fail(error ? SERVER_ERROR : NOT_FOUND);
    }

    const previous = ownPath(user.id, item.cutout_path);
    if (previous && previous !== newCutout) await removeUnusedItemFiles(supabase, user.id, [previous]);
    revalidateItem(id);
    return { ok: true };
  });
}

/**
 * « Changer la photo » : nouvelle photo à plat (déjà envoyée dans le bucket), détourée puis
 * enregistrée à la place de l'ancienne. Si le détourage échoue, la pièce ne change pas. Un PNG
 * déjà détouré envoyé avec la photo (`sentCutout`) sert de détourage, comme à l'ajout.
 * Une pièce assemblée est refusée avant tout envoi à fal.ai : sa photo portée ne sort pas
 * (docs/conception.md §9), et ses repères la placent dans la silhouette du miroir ; elle se change en
 * réimportant le paquet (docs/conception.md §3.2). Les anciens fichiers ne sont supprimés que si aucune autre
 * pièce ne s'en sert. En cas d'échec, la photo reçue n'est effacée, elle aussi, que si aucune
 * pièce ne l'utilise : le navigateur pourrait envoyer le chemin d'une photo déjà enregistrée.
 */
export async function replacePhoto(id: string, photoPath: string, sentCutout: string | null = null): Promise<ActionResult> {
  return guarded('replacePhoto', async ({ user, supabase }) => {
    const photo = uploadedPhotoPath(user.id, photoPath);
    if (!photo) return fail('Photo refusée.');
    let sent: string | null = null;
    if (sentCutout !== null && sentCutout !== undefined) {
      sent = cutoutPath(user.id, sentCutout);
      if (!sent) {
        await removeUnusedItemFiles(supabase, user.id, [photo]);
        return fail('Détourage refusé.');
      }
    }
    const received = sent ? [photo, sent] : [photo];
    if (!isUuid(id)) {
      await removeUnusedItemFiles(supabase, user.id, received);
      return fail(NOT_FOUND);
    }
    const item = await readPhotoPaths(supabase, id);
    if (!item) {
      await removeUnusedItemFiles(supabase, user.id, received);
      return fail(NOT_FOUND);
    }
    if (item.assembly !== null && item.assembly !== undefined) {
      await removeUnusedItemFiles(supabase, user.id, received);
      return fail(ASSEMBLED_PHOTO);
    }

    let newCutout: string;
    try {
      const photoUrl = await signedUrl(supabase, 'items', photo, EXTERNAL_URL_SECONDS);
      newCutout = await cutoutForUpload(supabase, user.id, photoUrl, sent);
    } catch (error) {
      // La photo reçue et le PNG envoyé (déjà effacé s'il a été refusé) ne servent plus.
      await removeUnusedItemFiles(supabase, user.id, received);
      return fail(cutoutNotice(error));
    }

    const { data, error } = await supabase
      .from('items')
      .update({ photo_path: photo, cutout_path: newCutout })
      .eq('id', id)
      .select('id');
    if (error || !data || data.length === 0) {
      if (error) console.error(`replacePhoto : ${errorName(error)}`);
      await removeUnusedItemFiles(supabase, user.id, [photo, newCutout]);
      return fail(error ? SERVER_ERROR : NOT_FOUND);
    }

    const previous = ownFiles(user.id, item).filter((path) => path !== photo && path !== newCutout);
    await removeUnusedItemFiles(supabase, user.id, previous);
    revalidateItem(id);
    return { ok: true };
  });
}

/**
 * Supprime la pièce, puis ceux de ses fichiers (photo, détourage, manches) qu'aucune autre pièce
 * n'utilise encore (docs/conception.md §3.2), et retourne à la grille.
 */
export async function deleteItem(id: string): Promise<ActionResult> {
  const result = await guarded('deleteItem', async ({ user, supabase }) => {
    if (!isUuid(id)) return fail(NOT_FOUND);
    const { data, error } = await supabase
      .from('items')
      .delete()
      .eq('id', id)
      .select('photo_path, cutout_path, assembly');
    if (error) {
      console.error(`deleteItem : ${errorName(error)}`);
      return fail("Le vêtement n'a pas pu être supprimé. Réessaie.");
    }
    if (!data || data.length === 0) return fail(NOT_FOUND);

    const rows = data as PhotoPaths[];
    await removeUnusedItemFiles(
      supabase,
      user.id,
      rows.flatMap((row) => ownFiles(user.id, row)),
    );
    return { ok: true };
  });
  // Pas de revalidatePath sur la fiche : elle n'existe plus, la redirection l'évite.
  if (result.ok) backToGrid();
  return result;
}

/**
 * Ajout abandonné (« Recommencer ») : efface la photo envoyée et son détourage, sauf s'ils
 * appartiennent déjà à une pièce enregistrée.
 */
export async function discardUpload(photoPath: string, cutout: string | null): Promise<ActionResult> {
  return guarded('discardUpload', async ({ user, supabase }) => {
    const photo = uploadedPhotoPath(user.id, photoPath);
    if (!photo) return fail('Photo refusée.');
    let ownCutout: string | null = null;
    if (cutout !== null && cutout !== undefined) {
      ownCutout = cutoutPath(user.id, cutout);
      if (!ownCutout) return fail('Détourage refusé.');
    }

    const paths = ownCutout ? [photo, ownCutout] : [photo];
    const [byPhoto, byCutout] = await Promise.all([
      supabase.from('items').select('id').in('photo_path', paths).limit(1),
      supabase.from('items').select('id').in('cutout_path', paths).limit(1),
    ]);
    if (byPhoto.error || byCutout.error) throw byPhoto.error ?? byCutout.error;
    if ((byPhoto.data?.length ?? 0) > 0 || (byCutout.data?.length ?? 0) > 0) return { ok: true };

    await removeItemFiles(supabase, paths);
    return { ok: true };
  });
}
