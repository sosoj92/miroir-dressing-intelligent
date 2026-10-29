import type { City } from '@/lib/geocoding/parse';
import type { Category, Style, Warmth } from '@/lib/types';
import type { ImportHistory, ImportItem, ImportPlan, ImportRefusal } from './prototype';

// Ce que le navigateur envoie à la server action importPrototype, découpé en envois successifs.
//
// Taille : docs/conception.md §3.1 interdit toute requête de plus de 4 Mo (Vercel refuse au-delà de 4,5 Mo).
// Mais Next.js 16 refuse déjà le corps d'une server action au-delà de 1 Mo par défaut
// (`serverActions.bodySizeLimit`, non réglé dans next.config.ts). Chaque envoi reste donc sous
// 900 000 octets de JSON, ce qui respecte les deux limites. Le serveur résout les ids du prototype
// en base : l'historique d'un envoi peut viser des pièces enregistrées par un envoi précédent.

export const MAX_IMPORT_BYTES = 900_000;

/** Nombre maximal d'entrées par envoi (vérifié aussi par le serveur). */
export const BATCH_LIMITS = {
  items: 500,
  history: 2000,
  refusals: 2000,
  plans: 400,
} as const;

/** Une fiche convertie, avec les chemins Storage des images envoyées (absents sinon). */
export type ImportItemPayload = {
  legacy_id: string;
  name: string;
  category: Category;
  color: string | null;
  warmth: Warmth;
  styles: Style[];
  rain_ok: boolean;
  dirty: boolean;
  created_at?: string;
  photo_path?: string;
  cutout_path?: string;
};

export type ImportBatch = {
  items: ImportItemPayload[];
  history: ImportHistory[];
  refusals: ImportRefusal[];
  plans: ImportPlan[];
  city: City | null;
};

/** Compteurs renvoyés par chaque envoi, additionnés par le navigateur. */
export type ImportCounts = {
  items: number;
  /** Pièces sans détourage après l'import : « photo à refaire » (docs/conception.md §3.1). */
  withoutCutout: number;
  history: number;
  refusals: number;
  plans: number;
  city: string | null;
};

export type ImportActionResult = { ok: true; counts: ImportCounts } | { ok: false; error: string };

export function toItemPayload(
  item: ImportItem,
  paths: { photo_path?: string | null; cutout_path?: string | null },
): ImportItemPayload {
  const payload: ImportItemPayload = {
    legacy_id: item.legacy_id,
    name: item.name,
    category: item.category,
    color: item.color,
    warmth: item.warmth,
    styles: item.styles,
    rain_ok: item.rain_ok,
    dirty: item.dirty,
  };
  // Absents plutôt que null : un import de db.json seul n'efface pas les photos déjà importées.
  if (item.created_at) payload.created_at = item.created_at;
  if (paths.photo_path) payload.photo_path = paths.photo_path;
  if (paths.cutout_path) payload.cutout_path = paths.cutout_path;
  return payload;
}

const encoder = new TextEncoder();

export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

type ListKey = 'items' | 'history' | 'refusals' | 'plans';

function emptyBatch(city: City | null): ImportBatch {
  return { items: [], history: [], refusals: [], plans: [], city };
}

function hasContent(batch: ImportBatch): boolean {
  return (
    batch.city !== null ||
    batch.items.length > 0 ||
    batch.history.length > 0 ||
    batch.refusals.length > 0 ||
    batch.plans.length > 0
  );
}

export class ImportTooLargeError extends Error {
  constructor() {
    super('Une fiche dépasse la taille maximale d’un envoi.');
    this.name = 'ImportTooLargeError';
  }
}

/**
 * Découpe l'import en envois de moins de `maxBytes` octets de JSON, dans l'ordre : ville (premier
 * envoi), pièces, historique, refus, plans. Les envois sont faits l'un après l'autre.
 */
export function buildBatches(data: ImportBatch, maxBytes: number = MAX_IMPORT_BYTES): ImportBatch[] {
  const batches: ImportBatch[] = [];
  let current = emptyBatch(data.city);
  let size = jsonBytes(current);

  function add<K extends ListKey>(key: K, entry: ImportBatch[K][number]) {
    const entrySize = jsonBytes(entry) + 1; // + la virgule
    if (current[key].length >= BATCH_LIMITS[key] || size + entrySize > maxBytes) {
      if (hasContent(current)) batches.push(current);
      current = emptyBatch(null);
      size = jsonBytes(current);
    }
    if (size + entrySize > maxBytes) throw new ImportTooLargeError();
    (current[key] as Array<ImportBatch[K][number]>).push(entry);
    size += entrySize;
  }

  for (const item of data.items) add('items', item);
  for (const entry of data.history) add('history', entry);
  for (const entry of data.refusals) add('refusals', entry);
  for (const entry of data.plans) add('plans', entry);

  if (hasContent(current) || batches.length === 0) batches.push(current);
  return batches;
}

export function addCounts(total: ImportCounts, next: ImportCounts): ImportCounts {
  return {
    items: total.items + next.items,
    withoutCutout: total.withoutCutout + next.withoutCutout,
    history: total.history + next.history,
    refusals: total.refusals + next.refusals,
    plans: total.plans + next.plans,
    city: next.city ?? total.city,
  };
}

export const EMPTY_COUNTS: ImportCounts = {
  items: 0,
  withoutCutout: 0,
  history: 0,
  refusals: 0,
  plans: 0,
  city: null,
};
