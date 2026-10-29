import { armsLayers, type ArmsLayerName } from '@/lib/assembly/arms-files';
import { declaresArms, parseAssemblyPhoto } from '@/lib/assembly/parse';
import {
  CATEGORIES,
  STYLES,
  type ArmsLayer,
  type Assembly,
  type AssemblyPhoto,
  type Category,
  type Style,
  type Warmth,
} from '@/lib/types';
import { MAX_IMPORT_BYTES, jsonBytes } from './batches';
import { MAX_IMAGE_BYTES, sniffImage } from './images';

// Paquet d'assemblage des photos portées (docs/conception.md §3.2, §7), préparé sur le PC par scripts/assemblage/.
// Module pur, utilisé par le navigateur (lecture du zip) et par le serveur (mêmes règles de fiche).
// Le zip contient manifest.json, photos/<clé>.jpg (photo d'origine), photos/<clé>.webp (photo
// détourée) et manches/<id>.webp ; avec la version 1 du champ arms, pour une photo qui a des bras pliés
// (`photos[clé].arms`, facultatif), bras/<clé>.webp, corps/<clé>.webp et manches-photo/<clé>.webp.
// Les deux formats sont acceptés. Rien n'est envoyé tant que tout n'a pas été vérifié ici.

export const ASSEMBLY_FORMAT = 'mon-dressing/assemblage';
export const ASSEMBLY_VERSION = 1;

/** Bornes d'un paquet acceptable. `fileBytes` : limite du bucket `items` (file_size_limit). */
export const ASSEMBLY_LIMITS = {
  items: 300,
  photos: 300,
  fileBytes: MAX_IMAGE_BYTES,
  manifestBytes: 5 * 1024 * 1024,
} as const;

/** Clé d'une photo et identifiant d'une pièce : ils entrent dans les chemins Storage. */
export const ASSEMBLY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const NAME_MAX = 80;
/** Longueur d'une valeur fautive recopiée dans un message d'erreur. */
const QUOTE_MAX = 40;

/** Une pièce du manifeste, relue. `sleeves` : vrai si `manches/<legacy_id>.webp` l'accompagne. */
export type ManifestItem = {
  legacy_id: string;
  name: string;
  category: Category;
  color: string | null;
  warmth: Warmth;
  styles: Style[];
  rain_ok: boolean;
  photo: string;
  sleeves: boolean;
};

export type AssemblyManifest = {
  photos: Map<string, AssemblyPhoto>;
  items: ManifestItem[];
};

export type ManifestResult = { ok: true; manifest: AssemblyManifest } | { ok: false; error: string };

/** Ligne `items` envoyée à la server action importAssembly (sans `dirty` ni `created_at`). */
export type AssemblyItemPayload = {
  legacy_id: string;
  name: string;
  category: Category;
  color: string | null;
  warmth: Warmth;
  styles: Style[];
  rain_ok: boolean;
  photo_path: string;
  cutout_path: string;
  assembly: Assembly;
};

export type AssemblyBatch = { items: AssemblyItemPayload[] };
export type AssemblyCounts = { created: number; updated: number };
/**
 * `replaced` : fichiers que les pièces de cet envoi citaient et ne citent plus. Ils ne sont
 * supprimés qu'une fois TOUS les envois écrits (finishAssemblyImport) : un envoi suivant peut citer
 * une photo qu'un envoi précédent a cessé de citer.
 */
export type AssemblyActionResult =
  | { ok: true; counts: AssemblyCounts; replaced: string[] }
  | { ok: false; error: string };
/** Fin de l'import : les fichiers remplacés par tous les envois, à supprimer s'ils ne servent plus. */
export type AssemblyCleanup = { paths: string[] };
export type AssemblyCleanupResult = { ok: true } | { ok: false; error: string };

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

function fail(message: string): never {
  throw new ManifestError(message);
}

/** Valeur fautive citée dans un message, courte et sur une ligne. */
function quote(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  const flat = text.replace(/\s+/g, ' ');
  const chars = Array.from(flat);
  return chars.length > QUOTE_MAX ? `${chars.slice(0, QUOTE_MAX).join('')}…` : flat;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------- Chemins

/** Photo d'origine (fond vert compris) : `<userId>/assemblage/<clé>.jpg`. */
export function assemblyPhotoPath(userId: string, key: string): string {
  return `${userId}/assemblage/${key}.jpg`;
}

/** Photo détourée : `<userId>/assemblage/<clé>.webp`. */
export function assemblyCutoutPath(userId: string, key: string): string {
  return `${userId}/assemblage/${key}.webp`;
}

/** Manches d'un haut ou d'une veste : `<userId>/assemblage/manches/<legacy_id>.webp`. */
export function assemblySleevesPath(userId: string, legacyId: string): string {
  return `${userId}/assemblage/manches/${legacyId}.webp`;
}

/** Noms attendus dans le zip, relatifs au dossier de manifest.json. */
export function photoEntryName(key: string): string {
  return `photos/${key}.jpg`;
}

export function cutoutEntryName(key: string): string {
  return `photos/${key}.webp`;
}

export function sleevesEntryName(legacyId: string): string {
  return `manches/${legacyId}.webp`;
}

/** Dossier de chaque couche des bras pliés, dans le zip comme dans Storage. */
const ARMS_FOLDERS: Record<ArmsLayerName, string> = { arms: 'bras', body: 'corps', sleeves: 'manches-photo' };

/** Couche des bras pliés dans le zip : `bras/<clé>.webp`, `corps/<clé>.webp`, `manches-photo/<clé>.webp`. */
export function armsEntryName(key: string, layer: ArmsLayerName): string {
  return `${ARMS_FOLDERS[layer]}/${key}.webp`;
}

/** Couche des bras pliés dans Storage : `<userId>/assemblage/bras/<clé>.webp` (corps/, manches-photo/). */
export function assemblyArmsPath(userId: string, key: string, layer: ArmsLayerName): string {
  return `${userId}/assemblage/${armsEntryName(key, layer)}`;
}

// ---------------------------------------------------------------- Fiche d'une pièce

/**
 * Champs d'une fiche (nom, catégorie, couleur, chaleur, styles, ok pluie), relus avec les règles
 * de la base. `label` désigne la pièce dans les messages (« Pièce a07 »). Lève ManifestError.
 */
export function readItemFields(
  source: Record<string, unknown>,
  label: string,
): Pick<ManifestItem, 'name' | 'category' | 'color' | 'warmth' | 'styles' | 'rain_ok'> {
  if (typeof source.name !== 'string') fail(`${label} : nom absent.`);
  const name = source.name.replace(/\s+/g, ' ').trim();
  const length = Array.from(name).length;
  if (length < 1 || length > NAME_MAX) fail(`${label} : le nom doit faire de 1 à ${NAME_MAX} caractères.`);

  const category = CATEGORIES.find((value) => value === source.category);
  if (!category) fail(`${label} : catégorie inconnue (« ${quote(source.category)} »).`);

  let color: string | null = null;
  if (source.color !== null && source.color !== undefined) {
    if (typeof source.color !== 'string' || !COLOR_PATTERN.test(source.color)) {
      fail(`${label} : couleur invalide (« ${quote(source.color)} », #RRGGBB attendu).`);
    }
    color = source.color.toUpperCase();
  }

  const warmth = source.warmth;
  if (warmth !== 1 && warmth !== 2 && warmth !== 3) fail(`${label} : chaleur invalide (1, 2 ou 3 attendu).`);

  if (!Array.isArray(source.styles) || source.styles.length === 0 || source.styles.length > STYLES.length) {
    fail(`${label} : styles absents.`);
  }
  const styles: Style[] = [];
  for (const value of source.styles) {
    const style = STYLES.find((known) => known === value);
    if (!style) fail(`${label} : style inconnu (« ${quote(value)} »).`);
    if (!styles.includes(style)) styles.push(style);
  }

  if (typeof source.rain_ok !== 'boolean') fail(`${label} : rain_ok doit valoir true ou false.`);

  return { name, category, color, warmth, styles, rain_ok: source.rain_ok };
}

// ---------------------------------------------------------------- Manifeste

/** Vrai si ce JSON se présente comme un manifeste de paquet d'assemblage. */
export function isAssemblyManifest(json: unknown): boolean {
  return isRecord(json) && json.format === ASSEMBLY_FORMAT;
}

function readPhoto(key: string, value: unknown): AssemblyPhoto {
  const label = `Photo ${quote(key)}`;
  if (!isRecord(value)) fail(`${label} : repères absents.`);
  if (value.original !== undefined && value.original !== photoEntryName(key)) {
    fail(`${label} : photo d'origine inattendue (${photoEntryName(key)} attendu).`);
  }
  if (value.cutout !== undefined && value.cutout !== cutoutEntryName(key)) {
    fail(`${label} : photo détourée inattendue (${cutoutEntryName(key)} attendu).`);
  }
  // La clé du manifeste l'emporte sur un éventuel champ `key` de la photo.
  const photo = parseAssemblyPhoto({ ...value, key });
  if (!photo) fail(`${label} : repères illisibles (taille, yeux, milieux ou lignes).`);
  // Bras pliés facultatifs (paquet sans bras pliés : absents). Annoncés mais illisibles, ils
  // arrêtent l'import : la base ne doit pas citer des couches que la silhouette ne saurait placer.
  if (declaresArms(value)) {
    if (!photo.arms) fail(`${label} : bras pliés illisibles (couches, bords, poignets ou manches).`);
    for (const { name, layer } of armsLayers(photo)) {
      const expected = armsEntryName(key, name);
      if (layer.path !== expected) fail(`${label} : couche des bras inattendue (${expected} attendu).`);
    }
  }
  return photo;
}

function readItem(value: unknown, index: number, photos: Map<string, AssemblyPhoto>): ManifestItem {
  if (!isRecord(value)) fail(`Pièce n° ${index + 1} : fiche illisible.`);
  const legacyId = value.legacy_id;
  if (typeof legacyId !== 'string' || !ASSEMBLY_KEY_PATTERN.test(legacyId)) {
    fail(`Pièce n° ${index + 1} : identifiant refusé (« ${quote(legacyId)} » ; lettres, chiffres, _ et -, 64 au plus).`);
  }
  const label = `Pièce ${legacyId}`;
  const fields = readItemFields(value, label);

  if (typeof value.photo !== 'string' || !photos.has(value.photo)) {
    fail(`${label} : photo « ${quote(value.photo)} » absente du manifeste.`);
  }

  let sleeves = false;
  if (value.sleeves !== null && value.sleeves !== undefined) {
    if (value.sleeves !== sleevesEntryName(legacyId)) {
      fail(`${label} : manches inattendues (${sleevesEntryName(legacyId)} attendu).`);
    }
    sleeves = true;
  }

  return { legacy_id: legacyId, ...fields, photo: value.photo, sleeves };
}

/** Lit et valide manifest.json. Le premier défaut trouvé donne un message précis en français. */
export function parseAssemblyManifest(json: unknown): ManifestResult {
  try {
    if (!isRecord(json) || json.format !== ASSEMBLY_FORMAT) fail("Ce fichier n'est pas un paquet d'assemblage.");
    if (json.version !== ASSEMBLY_VERSION) {
      fail(`Version du paquet non prise en charge (« ${quote(json.version)} », ${ASSEMBLY_VERSION} attendue).`);
    }

    if (!isRecord(json.photos)) fail('Le manifeste ne contient pas de liste de photos.');
    const photoEntries = Object.entries(json.photos);
    if (photoEntries.length > ASSEMBLY_LIMITS.photos) {
      fail(`Trop de photos : ${photoEntries.length} (${ASSEMBLY_LIMITS.photos} au plus).`);
    }
    const photos = new Map<string, AssemblyPhoto>();
    for (const [key, value] of photoEntries) {
      if (!ASSEMBLY_KEY_PATTERN.test(key)) {
        fail(`Nom de photo refusé : « ${quote(key)} » (lettres, chiffres, _ et -, 64 au plus).`);
      }
      photos.set(key, readPhoto(key, value));
    }

    if (!Array.isArray(json.items) || json.items.length === 0) fail('Aucune pièce dans ce paquet.');
    if (json.items.length > ASSEMBLY_LIMITS.items) {
      fail(`Trop de pièces : ${json.items.length} (${ASSEMBLY_LIMITS.items} au plus).`);
    }
    const items: ManifestItem[] = [];
    const seen = new Set<string>();
    json.items.forEach((value, index) => {
      const item = readItem(value, index, photos);
      if (seen.has(item.legacy_id)) fail(`Identifiant de pièce en double : ${item.legacy_id}.`);
      seen.add(item.legacy_id);
      items.push(item);
    });

    return { ok: true, manifest: { photos, items } };
  } catch (error) {
    if (error instanceof ManifestError) return { ok: false, error: error.message };
    throw error;
  }
}

// ---------------------------------------------------------------- Fichiers à envoyer

export type PackageFile = {
  /** Nom de l'entrée dans le zip (avec le dossier de manifest.json). */
  entry: string;
  /** Nom affiché dans les messages (relatif au manifeste). */
  label: string;
  /** Chemin dans le bucket `items`. */
  path: string;
  kind: 'jpg' | 'webp';
  contentType: 'image/jpeg' | 'image/webp';
};

export type UploadPlan = {
  /**
   * Une entrée par photo utilisée, même si plusieurs pièces la partagent : photo d'origine, photo
   * détourée, puis les couches des bras pliés (`arms` : vrai s'il y en a).
   */
  photos: Array<{ key: string; files: PackageFile[]; arms: boolean }>;
  sleeves: PackageFile[];
};

function file(folder: string, label: string, path: string, kind: PackageFile['kind']): PackageFile {
  return {
    entry: `${folder}${label}`,
    label,
    path,
    kind,
    contentType: kind === 'jpg' ? 'image/jpeg' : 'image/webp',
  };
}

/**
 * Fichiers à envoyer dans Storage : chaque photo utilisée par au moins une pièce, une seule fois
 * (sa photo d'origine, sa photo détourée et ses couches des bras pliés), puis les manches.
 * `folder` : dossier de manifest.json dans le zip, avec la barre finale (« » à la racine).
 */
export function uploadPlan(manifest: AssemblyManifest, userId: string, folder = ''): UploadPlan {
  const keys: string[] = [];
  for (const item of manifest.items) if (!keys.includes(item.photo)) keys.push(item.photo);
  return {
    photos: keys.map((key) => {
      const layers = armsLayers(manifest.photos.get(key)).map(({ name }) =>
        file(folder, armsEntryName(key, name), assemblyArmsPath(userId, key, name), 'webp'),
      );
      return {
        key,
        files: [
          file(folder, photoEntryName(key), assemblyPhotoPath(userId, key), 'jpg'),
          file(folder, cutoutEntryName(key), assemblyCutoutPath(userId, key), 'webp'),
          ...layers,
        ],
        arms: layers.length > 0,
      };
    }),
    sleeves: manifest.items
      .filter((item) => item.sleeves)
      .map((item) => file(folder, sleevesEntryName(item.legacy_id), assemblySleevesPath(userId, item.legacy_id), 'webp')),
  };
}

export function planFiles(plan: UploadPlan): PackageFile[] {
  return [...plan.photos.flatMap((photo) => photo.files), ...plan.sleeves];
}

/** Présence et taille annoncée par le zip, avant toute décompression. Message, ou null si c'est bon. */
export function checkEntry(entry: PackageFile, declaredSize: number | undefined): string | null {
  if (declaredSize === undefined) return `Fichier absent du zip : ${entry.label}.`;
  if (declaredSize > ASSEMBLY_LIMITS.fileBytes) return `Fichier trop lourd : ${entry.label} (10 Mo au plus).`;
  return null;
}

/** Octets d'un fichier : taille réelle et type reconnu par ses octets magiques. */
export function checkBytes(entry: PackageFile, bytes: Uint8Array): string | null {
  if (bytes.length > ASSEMBLY_LIMITS.fileBytes) return `Fichier trop lourd : ${entry.label} (10 Mo au plus).`;
  const kind = sniffImage(bytes);
  if (kind?.ext !== entry.kind) {
    return `${entry.label} n'est pas une image ${entry.kind === 'jpg' ? 'JPEG' : 'WebP'}.`;
  }
  return null;
}

// ---------------------------------------------------------------- Fiches envoyées au serveur

/**
 * Repères tels qu'ils sont enregistrés : les chemins des couches des bras pliés deviennent leurs
 * chemins Storage (comme `sleevesPath`). Une photo sans bras pliés est rendue telle quelle.
 */
export function storedAssemblyPhoto(photo: AssemblyPhoto, userId: string): AssemblyPhoto {
  const arms = photo.arms;
  if (!arms) return photo;
  const at = (name: ArmsLayerName, layer: ArmsLayer): ArmsLayer => ({
    path: assemblyArmsPath(userId, photo.key, name),
    box: layer.box,
  });
  return {
    ...photo,
    arms: {
      ...arms,
      arms: at('arms', arms.arms),
      body: at('body', arms.body),
      sleeves: arms.sleeves ? at('sleeves', arms.sleeves) : null,
    },
  };
}

/** Fiches prêtes pour la server action, avec les chemins Storage et les repères (Assembly). */
export function toAssemblyPayloads(manifest: AssemblyManifest, userId: string): AssemblyItemPayload[] {
  return manifest.items.map((item) => {
    const photo = manifest.photos.get(item.photo);
    if (!photo) throw new ManifestError(`Pièce ${item.legacy_id} : photo absente du manifeste.`);
    return {
      legacy_id: item.legacy_id,
      name: item.name,
      category: item.category,
      color: item.color,
      warmth: item.warmth,
      styles: item.styles,
      rain_ok: item.rain_ok,
      photo_path: assemblyPhotoPath(userId, photo.key),
      cutout_path: assemblyCutoutPath(userId, photo.key),
      assembly: {
        v: 1,
        photo: storedAssemblyPhoto(photo, userId),
        sleevesPath: item.sleeves ? assemblySleevesPath(userId, item.legacy_id) : null,
      },
    };
  });
}

/**
 * Découpe les fiches en envois de moins de `maxBytes` octets de JSON et de `ASSEMBLY_LIMITS.items`
 * fiches au plus (limite de corps d'une server action, voir batches.ts).
 */
export function buildAssemblyBatches(
  items: AssemblyItemPayload[],
  maxBytes: number = MAX_IMPORT_BYTES,
): AssemblyBatch[] {
  const batches: AssemblyBatch[] = [];
  const empty = jsonBytes({ items: [] });
  let current: AssemblyItemPayload[] = [];
  let size = empty;
  for (const item of items) {
    const itemSize = jsonBytes(item) + 1;
    if (empty + itemSize > maxBytes) throw new ManifestError(`Pièce ${item.legacy_id} : fiche trop grosse pour être envoyée.`);
    if (current.length >= ASSEMBLY_LIMITS.items || size + itemSize > maxBytes) {
      batches.push({ items: current });
      current = [];
      size = empty;
    }
    current.push(item);
    size += itemSize;
  }
  if (current.length > 0) batches.push({ items: current });
  return batches;
}
