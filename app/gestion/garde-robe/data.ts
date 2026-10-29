import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { errorName } from '@/lib/items/errors';
import { gridImagePath, toGridItem, type GridItem } from '@/lib/items/grid';
import { ITEM_COLUMNS, parseItemRow, sortItems } from '@/lib/items/rows';
import { displayUrls } from '@/lib/server/display-urls';
import type { Item } from '@/lib/types';

// Lecture de la grille (garde-robe et vue « au sale ») : pièces du compte, triées, avec
// l'URL signée de leur image. Une erreur de lecture remonte ; sans URL signée, les vignettes
// s'affichent sans image (« Pas de photo »).

export async function loadGridItems(
  supabase: SupabaseClient,
  userId: string,
  options: { dirtyOnly?: boolean } = {},
): Promise<GridItem[]> {
  let query = supabase.from('items').select(ITEM_COLUMNS).eq('owner', userId);
  if (options.dirtyOnly) query = query.eq('dirty', true);
  const { data, error } = await query;
  if (error) throw error;

  const items = sortItems(((data ?? []) as unknown[]).map(parseItemRow).filter((item): item is Item => item !== null));
  // Détourage s'il existe, sinon la photo d'origine. Un chemin hors du dossier du compte
  // n'est pas signé : la pièce s'affiche alors sans image.
  const urls = await displayUrls(supabase, userId, 'items', items.map(gridImagePath)).catch((caught: unknown) => {
    console.error(`Garde-robe, URL signées : ${errorName(caught)}`);
    return new Map<string, string>();
  });
  return items.map((item) => toGridItem(item, urls));
}
