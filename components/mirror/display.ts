import { silhouetteEntry, type SilhouetteEntry } from '@/components/assembly/silhouette-store';
import { silhouetteKey, type SilhouetteSource } from '@/lib/assembly/render';
import { outfitSilhouette } from '@/lib/mirror/deck';
import type { MirrorItem, Outfit } from '@/lib/types';

// Ce que montre le miroir pour une tenue (docs/conception.md §4, §7) : sa silhouette assemblée, ses pièces
// empilées (pas de photo portée, ou une image introuvable), ou rien de neuf tant que la silhouette
// n'est pas dessinée (« pending » : l'ancienne reste affichée, components/mirror/outfit-view.tsx).

export type OutfitDisplay = 'pieces' | 'silhouette' | 'pending';

export function displayOf(source: SilhouetteSource | null, entry: SilhouetteEntry | undefined): OutfitDisplay {
  if (!source || entry?.status === 'failed') return 'pieces';
  return entry?.status === 'ready' ? 'silhouette' : 'pending';
}

/**
 * La tenue de la légende est-elle à l'écran ? Faux tant que sa silhouette n'est pas dessinée :
 * « oui » et « non » attendent alors, pour ne jamais enregistrer une tenue qu'on n'a pas vue.
 */
export function isOutfitShown(outfit: Outfit, itemsById: ReadonlyMap<string, MirrorItem>): boolean {
  const source = outfitSilhouette(outfit, itemsById);
  return displayOf(source, source ? silhouetteEntry(silhouetteKey(source)) : undefined) !== 'pending';
}
