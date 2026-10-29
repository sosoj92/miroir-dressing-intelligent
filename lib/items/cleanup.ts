import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ownPathOrNull } from '@/lib/server/own-path';
import { errorName } from './errors';
import { unusedFiles, type ItemFileRefs } from './files';
import { removeItemFiles } from './pipeline';

// Suppression sûre des fichiers d'une pièce (docs/conception.md §3.2) : à appeler APRÈS avoir supprimé ou
// modifié la ligne, pour que les pièces restantes disent quels fichiers servent encore.

/** Chemins JSON des couches des bras pliés d'une photo portée (bras, corps, manches de la photo). */
const ARMS_PATH = 'assembly->photo->arms->arms->>path';
const BODY_PATH = 'assembly->photo->arms->body->>path';
const PHOTO_SLEEVES_PATH = 'assembly->photo->arms->sleeves->>path';

/**
 * Colonnes qui citent un fichier : `assembly->>sleevesPath` et les chemins des couches évitent de
 * relire tous les repères (alias lus par itemFiles, lib/items/files.ts).
 */
export const FILE_REF_COLUMNS = `photo_path, cutout_path, sleeves_path:assembly->>sleevesPath, arms_path:${ARMS_PATH}, body_path:${BODY_PATH}, photo_sleeves_path:${PHOTO_SLEEVES_PATH}`;

/**
 * Filtres qui retrouvent les pièces citant un candidat, une requête par colonne. On ne relit pas
 * toutes les pièces : PostgREST plafonne une réponse (max_rows), et une ligne tronquée ferait
 * croire qu'un fichier encore utilisé ne l'est plus.
 */
export const FILE_REF_FILTERS = [
  'photo_path',
  'cutout_path',
  'assembly->>sleevesPath',
  ARMS_PATH,
  BODY_PATH,
  PHOTO_SLEEVES_PATH,
] as const;

/** Chemins par requête : la liste part dans l'URL de PostgREST. */
const PATH_CHUNK = 40;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

/** Pièces du compte qui citent au moins un de ces chemins, ou null si la lecture échoue. */
async function rowsCiting(supabase: SupabaseClient, userId: string, paths: string[]): Promise<ItemFileRefs[] | null> {
  const rows: ItemFileRefs[] = [];
  try {
    for (const chunk of chunks(paths, PATH_CHUNK)) {
      const results = await Promise.all(
        FILE_REF_FILTERS.map((column) =>
          supabase.from('items').select(FILE_REF_COLUMNS).eq('owner', userId).in(column, chunk),
        ),
      );
      for (const { data, error } of results) {
        if (error || !Array.isArray(data)) {
          console.error(`Fichiers encore utilisés : ${errorName(error)}`);
          return null;
        }
        rows.push(...(data as ItemFileRefs[]));
      }
    }
  } catch (error) {
    console.error(`Fichiers encore utilisés : ${errorName(error)}`);
    return null;
  }
  return rows;
}

/**
 * Supprime de Storage ceux des `candidates` qu'aucune pièce du compte n'utilise encore.
 * Seuls les chemins rangés sous `<userId>/…` (assertOwnPath) sont candidats. Si la lecture des
 * pièces échoue, rien n'est supprimé : un fichier orphelin vaut mieux qu'une photo perdue.
 */
export async function removeUnusedItemFiles(
  supabase: SupabaseClient,
  userId: string,
  candidates: ReadonlyArray<string | null | undefined>,
): Promise<string[]> {
  const paths = [
    ...new Set(candidates.map((path) => ownPathOrNull(userId, path)).filter((path): path is string => path !== null)),
  ];
  if (paths.length === 0) return [];
  const rows = await rowsCiting(supabase, userId, paths);
  if (!rows) return [];
  const unused = unusedFiles(paths, rows);
  await removeItemFiles(supabase, unused);
  return unused;
}
