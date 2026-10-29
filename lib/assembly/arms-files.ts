import type { ArmsLayer, ArmsUrls, AssemblyPhoto } from '@/lib/types';

// Fichiers des couches des bras pliés d'une photo portée (docs/conception.md §3.2, §7) : chemins à signer et URL
// signées, pour le miroir (lib/mirror/server.ts) et l'écran Demain (app/gestion/demain/view.ts).
// Module pur. Une photo sans `arms` n'a aucun fichier de plus : rien ne change pour elle.

/** Couches d'une photo, dans l'ordre : bras, corps, manches (cette dernière peut manquer). */
export const ARMS_LAYER_NAMES = ['arms', 'body', 'sleeves'] as const;
export type ArmsLayerName = (typeof ARMS_LAYER_NAMES)[number];

/** Couches présentes de cette photo (2 ou 3), avec leur nom ; [] sans bras pliés. */
export function armsLayers(photo: AssemblyPhoto | null | undefined): Array<{ name: ArmsLayerName; layer: ArmsLayer }> {
  const arms = photo?.arms;
  if (!arms) return [];
  const found: Array<{ name: ArmsLayerName; layer: ArmsLayer }> = [];
  for (const name of ARMS_LAYER_NAMES) {
    const layer = arms[name];
    if (layer) found.push({ name, layer });
  }
  return found;
}

/** Chemins des couches de cette photo, à signer avec sa photo détourée ; [] sans bras pliés. */
export function armsLayerPaths(photo: AssemblyPhoto | null | undefined): string[] {
  return armsLayers(photo).map(({ layer }) => layer.path);
}

/**
 * URL signées des couches (`urlOf` : chemin → URL, ou null s'il n'est pas signé), ou undefined
 * sans bras pliés. `sleeves` vaut null quand la photo n'a pas de couche de manches.
 */
export function armsLayerUrls(
  photo: AssemblyPhoto | null | undefined,
  urlOf: (path: string) => string | null,
): ArmsUrls | undefined {
  const arms = photo?.arms;
  if (!arms) return undefined;
  return {
    arms: urlOf(arms.arms.path),
    body: urlOf(arms.body.path),
    sleeves: arms.sleeves ? urlOf(arms.sleeves.path) : null,
  };
}
