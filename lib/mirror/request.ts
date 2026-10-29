import { addDays } from '@/lib/dates';
import { parseKeyMap } from '@/lib/keys/parse';
import { matchesBinding } from '@/lib/keys/resolve';
import { KEY_ACTIONS, type KeyAction, type KeyBinding, type KeyMap } from '@/lib/types';

// Validation des corps reçus par les routes /api/miroir/* : tout ce qui vient du navigateur est
// vérifié (types, longueurs, uuid). Les messages d'erreur sont courts, en français, sans détail
// interne. Fonctions pures.

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Une tenue : veste, haut ou robe, bas, chaussures, accessoire… avec de la marge. */
export const MAX_OUTFIT_ITEMS = 10;
/** Un refus : pièces principales et veste (3 au plus en pratique). */
export const MAX_REFUSAL_ITEMS = 6;
export const MAX_TITLE_LENGTH = 120;
/** Taille maximale d'un corps de requête du miroir, en caractères. */
export const MAX_BODY_LENGTH = 4_096;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const INVALID = 'Requête invalide.';

/** Lit le corps JSON d'une requête, ou undefined s'il est absent, trop long ou illisible. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    if (text.length === 0 || text.length > MAX_BODY_LENGTH) return undefined;
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function asObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** Liste d'uuid : 1 à `max` éléments, en minuscules, sans doublon. */
export function parseItemIds(value: unknown, max: number = MAX_OUTFIT_ITEMS): Parsed<string[]> {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    return { ok: false, error: 'Liste de pièces invalide.' };
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !UUID_PATTERN.test(entry)) {
      return { ok: false, error: 'Liste de pièces invalide.' };
    }
    const id = entry.toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return { ok: true, value: ids };
}

/** Date réelle au format AAAA-MM-JJ. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Où va une tenue acceptée : historique (« Bonne journée ») ou plan (« Prête pour demain »). */
export type AcceptTarget = 'history' | 'plan';
export const ACCEPT_TARGETS: readonly AcceptTarget[] = ['history', 'plan'];

export type AcceptRequest = {
  date: string;
  item_ids: string[];
  title: string | null;
  /** Ce que la tablette a affiché au moment de l'appui ; null pour une requête sans ce champ. */
  target: AcceptTarget | null;
};

export function parseAcceptRequest(body: unknown): Parsed<AcceptRequest> {
  const source = asObject(body);
  if (!source) return { ok: false, error: INVALID };
  if (!isIsoDate(source.date)) return { ok: false, error: 'Date invalide.' };
  const ids = parseItemIds(source.item_ids);
  if (!ids.ok) return ids;
  let title: string | null = null;
  if (source.title !== undefined && source.title !== null) {
    if (typeof source.title !== 'string') return { ok: false, error: INVALID };
    const trimmed = source.title.trim();
    if (trimmed.length > MAX_TITLE_LENGTH) return { ok: false, error: 'Titre trop long.' };
    title = trimmed || null;
  }
  let target: AcceptTarget | null = null;
  if (source.target !== undefined && source.target !== null) {
    if (!(ACCEPT_TARGETS as readonly unknown[]).includes(source.target)) return { ok: false, error: INVALID };
    target = source.target as AcceptTarget;
  }
  return { ok: true, value: { date: source.date, item_ids: ids.value, title, target } };
}

/**
 * Où enregistrer une tenue acceptée (docs/conception.md §4, §6). La table suit ce que la tablette a affiché
 * (`target`), pas la date du serveur au moment de l'envoi : l'acceptation passe par la file
 * d'attente hors ligne (docs/conception.md §7 bis) et peut arriver après minuit.
 * - `plan` (« Prête pour demain ») → outfit_plans, si la date est demain, ou aujourd'hui quand
 *   l'envoi est parti après minuit ;
 * - `history` (« Bonne journée ») → outfit_history, si la date est aujourd'hui, ou hier quand
 *   l'envoi est parti après minuit.
 * Sans `target` (requête gardée en file par une version précédente) : aujourd'hui → historique,
 * demain → plan. Toute autre date est refusée.
 */
export function acceptTarget(date: string, today: string, target: AcceptTarget | null = null): AcceptTarget | null {
  const tomorrow = addDays(today, 1);
  if (target === 'plan') return date === today || date === tomorrow ? 'plan' : null;
  if (target === 'history') return date === today || date === addDays(today, -1) ? 'history' : null;
  if (date === today) return 'history';
  if (date === tomorrow) return 'plan';
  return null;
}

export type RefuseRequest = { item_ids: string[] };

/** Pièces principales et veste (docs/conception.md §6), triées : la forme enregistrée dans `refusals`. */
export function parseRefuseRequest(body: unknown): Parsed<RefuseRequest> {
  const source = asObject(body);
  if (!source) return { ok: false, error: INVALID };
  const ids = parseItemIds(source.item_ids, MAX_REFUSAL_ITEMS);
  if (!ids.ok) return ids;
  return { ok: true, value: { item_ids: [...ids.value].sort() } };
}

/** Refus nommés par la tablette dans un « Recommencer » : ceux d'un choix, avec de la marge. */
export const MAX_RESTART_REFUSALS = 30;

export type RestartRequest = {
  /** Jour visé par le miroir (aujourd'hui ou demain). */
  date: string;
  /** « Aujourd'hui » tel que la tablette l'affichait. */
  today: string;
  /** Refus faits sur la tablette pendant ce choix (ids triés). */
  refused: string[][];
};

export function parseRestartRequest(body: unknown): Parsed<RestartRequest> {
  const source = asObject(body);
  if (!source) return { ok: false, error: INVALID };
  if (!isIsoDate(source.date) || !isIsoDate(source.today)) return { ok: false, error: 'Date invalide.' };
  const refused: string[][] = [];
  if (source.refused !== undefined) {
    if (!Array.isArray(source.refused) || source.refused.length > MAX_RESTART_REFUSALS) return { ok: false, error: INVALID };
    for (const entry of source.refused) {
      const ids = parseItemIds(entry, MAX_REFUSAL_ITEMS);
      if (!ids.ok) return ids;
      refused.push([...ids.value].sort());
    }
  }
  return { ok: true, value: { date: source.date, today: source.today, refused } };
}

/**
 * « Recommencer » (docs/conception.md §5) : comme pour accepter, la requête suit ce que la tablette affichait et
 * peut arriver après minuit (file d'attente, docs/conception.md §7 bis). Son « aujourd'hui » est celui du
 * serveur, ou la veille ; le jour visé est ce jour-là ou le lendemain.
 */
export function isRestartAllowed(request: Pick<RestartRequest, 'date' | 'today'>, serverToday: string): boolean {
  if (request.today !== serverToday && request.today !== addDays(serverToday, -1)) return false;
  return request.date === request.today || request.date === addDays(request.today, 1);
}

export type KeysRequest = { keyMap: KeyMap };

/**
 * Actions qu'une tablette doit toujours envoyer. Les suivantes (bas, veste, recommencer), ajoutées
 * ensuite, restent facultatives : une tablette encore sur une ancienne version en envoie moins
 * (sinon refus en boucle).
 */
export const REQUIRED_KEY_ACTIONS: readonly KeyAction[] = ['next', 'previous', 'accept', 'refuse'];

/** Les actions obligatoires et celles présentes en plus, chacune sur une touche différente. */
export function parseKeysRequest(body: unknown): Parsed<KeysRequest> {
  const source = asObject(body);
  if (!source) return { ok: false, error: INVALID };
  const keyMap = parseKeyMap(source.keyMap);
  const bindings: KeyBinding[] = [];
  for (const action of KEY_ACTIONS) {
    const binding = keyMap[action];
    if (!binding) {
      if (REQUIRED_KEY_ACTIONS.includes(action)) return { ok: false, error: 'Il manque une touche.' };
      continue;
    }
    if (bindings.some((other) => matchesBinding(other, binding) || matchesBinding(binding, other))) {
      return { ok: false, error: 'Deux actions ont la même touche.' };
    }
    bindings.push(binding);
  }
  return { ok: true, value: { keyMap } };
}
