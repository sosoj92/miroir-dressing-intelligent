import type { MirrorPayload, Refusal } from '@/lib/types';
import { sameIds } from './deck';
import type { PendingChoice } from './queue';

// Empreinte des données du miroir que le téléphone peut changer (docs/conception.md §4, §7 bis) : pièces propres
// (avec des repères légers de leur assemblage), tenue prévue du jour visé, ville et heure du soir.
// GET /api/miroir/touches la renvoie toutes les 30 s ; si elle diffère de celle des données
// affichées, la tablette relit ses données (GET /api/miroir). La partie « tenue prévue » est à part
// (`v2-<données>.<tenue prévue>`) : la tablette la recalcule elle-même après ses propres choix
// (« oui » pour demain, « Recommencer »), sinon chacun d'eux lui ferait tout relire. Ni URL signée ni
// météo : elles changent à chaque lecture. Les refus sont comptés à part (le miroir en ajoute, seul
// le téléphone en efface). Calculée côté serveur, sans colonne ni migration. Fonctions pures.

/** Réponse de GET /api/miroir : les données et leur empreinte. */
export type MirrorResponse = MirrorPayload & { version: string };

/** Colonnes de la fiche d'une pièce qui entrent dans l'empreinte. */
const ITEM_FIELDS = [
  'id',
  'name',
  'category',
  'color',
  'warmth',
  'styles',
  'rain_ok',
  'dirty',
  'photo_path',
  'cutout_path',
] as const;

/**
 * Repères légers de l'assemblage (`items.assembly`), lus par chemin JSON : version, manches, taille
 * de la photo, yeux, ourlets, robe, haut rentré, couches et poignets des bras pliés. Un import rejoué
 * qui mesure de nouveau la photo les change. Pas les tableaux de bords (centres, bras : plusieurs
 * Ko par pièce, toutes les 30 s).
 */
const ASSEMBLY_MARKERS = [
  ['assembly_v', ['v']],
  ['assembly_sleeves', ['sleevesPath']],
  ['assembly_size', ['photo', 'size']],
  ['assembly_eye', ['photo', 'eye']],
  ['assembly_top_low', ['photo', 'topLow']],
  ['assembly_bottom_high', ['photo', 'bottomHigh']],
  ['assembly_one_piece', ['photo', 'onePiece']],
  ['assembly_tucked', ['photo', 'tucked']],
  ['assembly_arms', ['photo', 'arms', 'arms']],
  ['assembly_body', ['photo', 'arms', 'body']],
  ['assembly_arm_sleeves', ['photo', 'arms', 'sleeves']],
  ['assembly_wrist', ['photo', 'arms', 'wrist']],
  ['assembly_cuff', ['photo', 'arms', 'cuff']],
] as const satisfies ReadonlyArray<readonly [string, readonly string[]]>;

type ItemField = (typeof ITEM_FIELDS)[number];
type AssemblyMarker = (typeof ASSEMBLY_MARKERS)[number][0];

/** Une pièce telle que la lit GET /api/miroir/touches (VERSION_ITEM_COLUMNS). */
export type VersionItem = Record<ItemField | AssemblyMarker, unknown>;

/** Colonnes de `items` lues pour l'empreinte : quelques centaines d'octets par pièce. */
export const VERSION_ITEM_COLUMNS = [
  ...ITEM_FIELDS,
  ...ASSEMBLY_MARKERS.map(([alias, path]) => `${alias}:assembly->${path.join('->')}`),
].join(', ');

const VERSION_FIELDS: ReadonlyArray<keyof VersionItem> = [...ITEM_FIELDS, ...ASSEMBLY_MARKERS.map(([alias]) => alias)];

export type VersionPlan = { date: unknown; item_ids: unknown } | null;

export type VersionProfile = { city: string; lat: number; lon: number; timezone: string; evening_hour: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Comme `assembly->a->b` de PostgREST : null dès qu'un niveau manque ou n'est pas un objet. */
function jsonAt(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return current ?? null;
}

/** Une ligne complète de `items` (GET /api/miroir) réduite comme la lit GET /api/miroir/touches. */
export function versionItemOf(row: Record<ItemField, unknown> & { assembly?: unknown }): VersionItem {
  const item = Object.fromEntries(ITEM_FIELDS.map((field) => [field, row[field]])) as Record<ItemField, unknown>;
  const markers = Object.fromEntries(ASSEMBLY_MARKERS.map(([alias, path]) => [alias, jsonAt(row.assembly, path)]));
  return { ...item, ...(markers as Record<AssemblyMarker, unknown>) };
}

/** Valeur lue en base → texte stable (undefined et null se confondent). */
function canonical(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** FNV-1a sur 32 bits, depuis `basis`. */
function fnv1a(text: string, basis: number): string {
  let hash = basis >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Deux passes : 16 caractères hexadécimaux. */
function hash(text: string): string {
  return `${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x01000193)}`;
}

/** Partie « tenue prévue » de l'empreinte : la date et les pièces telles qu'enregistrées, triées. */
export function planVersion(plan: VersionPlan): string {
  if (!plan) return hash('-');
  const ids = Array.isArray(plan.item_ids) ? plan.item_ids.map(String).sort() : [];
  return hash(`${canonical(plan.date)}:${ids.join('+')}`);
}

/**
 * L'empreinte : la même pour les mêmes données, quel que soit l'ordre des lignes. Change dès
 * qu'une pièce passe au sale ou revient, est ajoutée, modifiée ou supprimée (fiche, photos, repères
 * d'assemblage), que la tenue prévue change, ou que la ville ou l'heure du soir changent.
 */
export function mirrorVersion(input: { items: readonly VersionItem[]; plan: VersionPlan; profile: VersionProfile }): string {
  const items = input.items.map((item) => VERSION_FIELDS.map((field) => canonical(item[field])).join(',')).sort();
  const { city, lat, lon, timezone, evening_hour } = input.profile;
  const profile = [city, lat, lon, timezone, evening_hour].map(canonical).join(',');
  return `v2-${hash([items.join('\n'), profile].join('\n|\n'))}.${planVersion(input.plan)}`;
}

const VERSION_PATTERN = /^(v2-[0-9a-f]{16})\.[0-9a-f]{16}$/;

/**
 * L'empreinte une fois enregistré un choix fait ici : « oui » pour demain (`plan`) ou
 * « Recommencer » (null). Ce que le serveur renverra quand il l'aura reçu, si rien d'autre ne
 * change. null si l'empreinte est absente ou d'un autre format : la tablette relira une fois.
 */
export function withPlanVersion(version: string | null, plan: VersionPlan): string | null {
  const match = version ? VERSION_PATTERN.exec(version) : null;
  return match ? `${match[1]}.${planVersion(plan)}` : null;
}

/**
 * L'empreinte reçue, corrigée des choix encore dans la file (comme pendingPayload corrige les
 * données) : « Recommencer » efface la tenue prévue de son jour, « oui » pour demain la remplace.
 * Seuls comptent ceux du jour visé `targetDate`. « Oui » pour aujourd'hui (la tenue portée) n'entre
 * pas dans l'empreinte.
 */
export function pendingVersion(
  version: string | null,
  choices: readonly PendingChoice[],
  targetDate: string,
): string | null {
  return choices.reduce<string | null>((current, choice) => {
    if (choice.kind === 'history' || choice.date !== targetDate) return current;
    return withPlanVersion(current, choice.kind === 'restart' ? null : { date: choice.date, item_ids: choice.item_ids });
  }, version);
}

/** L'empreinte reçue (GET /api/miroir ou /touches), ou null si elle manque. */
export function versionOf(body: unknown): string | null {
  if (!isRecord(body)) return null;
  return typeof body.version === 'string' && body.version !== '' ? body.version : null;
}

/**
 * Faut-il relire les données ? Oui si l'empreinte de GET /api/miroir/touches (`polled`) diffère de
 * celle des données affichées (`current`), sauf si une relecture faite pour cette même empreinte
 * (`settled`) n'a pas suffi à les accorder : sans ce garde-fou, deux calculs qui divergeraient
 * relanceraient une lecture toutes les 30 s. Le prochain vrai changement donne une autre empreinte.
 */
export function needsVersionReload(current: string | null, polled: string | null, settled: string | null): boolean {
  return polled !== null && polled !== current && polled !== settled;
}

/** Nombre de refus enregistrés, d'après GET /api/miroir/touches, ou null s'il manque. */
export function refusalCountOf(body: unknown): number | null {
  if (!isRecord(body)) return null;
  const count = body.refusals;
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null;
}

/**
 * Refus que le serveur devrait compter : ceux de la dernière lecture (`server`), plus ceux faits sur
 * la tablette et déjà envoyés (`local`, sauf ceux encore dans la file : `unsent`). Un refus qu'il
 * avait déjà n'en ajoute pas (il l'ignore).
 */
export function knownRefusalCount(
  server: readonly Refusal[],
  local: readonly Refusal[],
  unsent: readonly string[][],
): number {
  const added = local.filter(
    (refusal) =>
      !unsent.some((ids) => sameIds(ids, refusal.item_ids)) &&
      !server.some((known) => sameIds(known.item_ids, refusal.item_ids)),
  );
  return server.length + added.length;
}

/**
 * Faut-il relire parce que des refus ont été effacés ailleurs (« Remettre » ou « Recommencer le
 * choix » sur le téléphone) ? Oui si le serveur en compte moins (`polled`) que la tablette n'en
 * connaît (`known`) : elle n'en fait qu'ajouter, et son propre « Recommencer » efface aussi les siens
 * de ce qu'elle connaît. `settled` : un compte pour lequel une relecture a déjà eu lieu sans les
 * accorder ; il est oublié dès que les deux s'accordent, pour que le prochain effacement relise.
 */
export function refusalReload(
  known: number,
  polled: number | null,
  settled: number | null,
): { reload: boolean; settled: number | null } {
  if (polled === null) return { reload: false, settled };
  if (polled >= known) return { reload: false, settled: null };
  return { reload: polled !== settled, settled };
}
