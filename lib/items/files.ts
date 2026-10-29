// Fichiers Storage d'une pièce, et garde de suppression (docs/conception.md §3.2) : une photo portée peut servir
// à plusieurs pièces (une veste et un bas photographiés ensemble). Supprimer une pièce ne
// supprime donc que les fichiers qu'aucune autre pièce du compte n'utilise. Module pur.

/**
 * Ce qu'on lit d'une ligne `items` pour connaître ses fichiers : `assembly` (jsonb entier) ou les
 * colonnes calculées de FILE_REF_COLUMNS (lib/items/cleanup.ts) : `sleeves_path`
 * (`assembly->>sleevesPath`) et les couches des bras pliés de la photo, `arms_path`, `body_path`
 * et `photo_sleeves_path` (`assembly->photo->arms->{arms,body,sleeves}->>path`).
 */
export type ItemFileRefs = {
  photo_path?: unknown;
  cutout_path?: unknown;
  assembly?: unknown;
  sleeves_path?: unknown;
  arms_path?: unknown;
  body_path?: unknown;
  photo_sleeves_path?: unknown;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function sleevesOf(row: ItemFileRefs): string | null {
  return text(row.sleeves_path) ?? text(record(row.assembly)?.sleevesPath);
}

/**
 * Couches des bras pliés (bras, corps, manches de la photo) : colonnes calculées, sinon
 * `assembly.photo.arms`, lu tel quel (même illisible, un chemin cité compte comme utilisé).
 */
function armsLayersOf(row: ItemFileRefs): Array<string | null> {
  const arms = record(record(record(row.assembly)?.photo)?.arms);
  const nested = (layer: string) => text(record(arms?.[layer])?.path);
  return [
    text(row.arms_path) ?? nested('arms'),
    text(row.body_path) ?? nested('body'),
    text(row.photo_sleeves_path) ?? nested('sleeves'),
  ];
}

/** Fichiers d'une pièce : photo d'origine, photo détourée, manches, couches des bras pliés (sans doublon). */
export function itemFiles(row: ItemFileRefs): string[] {
  const paths = [text(row.photo_path), text(row.cutout_path), sleevesOf(row), ...armsLayersOf(row)];
  return [...new Set(paths.filter((path): path is string => path !== null))];
}

/** Parmi `candidates`, les fichiers qu'aucune des pièces `remaining` n'utilise. */
export function unusedFiles(candidates: ReadonlyArray<string | null | undefined>, remaining: readonly ItemFileRefs[]): string[] {
  const used = new Set(remaining.flatMap(itemFiles));
  const unique = [...new Set(candidates.filter((path): path is string => Boolean(path)))];
  return unique.filter((path) => !used.has(path));
}
