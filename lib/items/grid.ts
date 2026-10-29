import { isDrawn } from '@/lib/assembly/render';
import { CATEGORIES, type Category, type Item } from '@/lib/types';
import { itemZone, type PhotoZone } from './zone';

// Grille de la garde-robe (docs/conception.md §4, écran 2) : ce que le serveur envoie au composant client
// (components/wardrobe/wardrobe-grid.tsx) pour chaque pièce, et le choix de la catégorie montrée.
// Fonctions pures, sans réseau.

/** Paramètre d'adresse de la catégorie montrée : /gestion/garde-robe?categorie=bas. */
export const CATEGORY_PARAM = 'categorie';

export const CATEGORY_TITLES: Record<Category, string> = {
  haut: 'Hauts',
  bas: 'Bas',
  robe: 'Robes',
  veste: 'Vestes',
  chaussures: 'Chaussures',
  accessoire: 'Accessoires',
};

/** Une vignette de la grille, prête à afficher (URL signée comprise). */
export type GridItem = {
  id: string;
  name: string;
  category: Category;
  dirty: boolean;
  /** Détourage s'il existe, sinon la photo d'origine ; null sans image signée. */
  src: string | null;
  /** `contain` pour un détourage, `cover` pour une photo avec son fond. */
  fit: 'contain' | 'cover';
  /** Pièce assemblée : la zone de sa photo portée détourée qui la montre. */
  zone: PhotoZone | null;
  /** Ni détourage ni photo portée : « Photo à refaire ». */
  redoPhoto: boolean;
};

/** Chemin de l'image d'une vignette : le détourage, sinon la photo d'origine. */
export function gridImagePath(item: Pick<Item, 'cutout_path' | 'photo_path'>): string | null {
  return item.cutout_path ?? item.photo_path;
}

export function toGridItem(item: Item, urls: ReadonlyMap<string, string>): GridItem {
  const path = gridImagePath(item);
  // Pièce assemblée : la zone de sa photo portée détourée (docs/conception.md §4, écran 2).
  const photo = item.assembly && item.cutout_path ? item.assembly.photo : null;
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    dirty: item.dirty,
    src: path ? (urls.get(path) ?? null) : null,
    fit: item.cutout_path ? 'contain' : 'cover',
    zone: photo ? { zone: itemZone(item.category, photo), size: photo.size } : null,
    redoPhoto: !item.cutout_path && !item.assembly,
  };
}

/** Catégories qui ont au moins une pièce, dans l'ordre de CATEGORIES. */
export function presentCategories(items: ReadonlyArray<Pick<GridItem, 'category'>>): Category[] {
  return CATEGORIES.filter((category) => items.some((item) => item.category === category));
}

/** Catégorie lue dans l'adresse si elle a des pièces, sinon la première présente (null : aucune). */
export function chosenCategory(param: string | null | undefined, present: readonly Category[]): Category | null {
  const match = present.find((category) => category === param);
  return match ?? present[0] ?? null;
}

/**
 * Remarque sous une catégorie que le miroir ne propose pas (chaussures et accessoires : la
 * silhouette ne les dessine pas, lib/assembly/render.ts), ou null.
 */
export function mirrorNote(category: Category): string | null {
  if (isDrawn({ category })) return null;
  return category === 'chaussures' ? 'Pas proposées sur le miroir.' : 'Pas proposés sur le miroir.';
}

/** Les pièces `ids` passent au sale (ou propres) ; les autres ne changent pas. */
export function withDirty(items: readonly GridItem[], ids: readonly string[], dirty: boolean): GridItem[] {
  const changed = new Set(ids);
  return items.map((item) => (changed.has(item.id) ? { ...item, dirty } : item));
}

/**
 * Vue « au sale » : la liste de la visite (`shown`, dans son ordre, avec l'état au sale changé sur
 * place), puis, à la fin, les pièces de la dernière lecture (`latest`) qui n'y sont pas (passées au
 * sale ailleurs). Une pièce remise propre n'est plus dans `latest` : elle reste, avec son image.
 * Pour les autres, l'image de la dernière lecture : après une image expirée, la page relue apporte
 * des URL re-signées.
 */
export function withLatest(shown: readonly GridItem[], latest: readonly GridItem[]): GridItem[] {
  const fresh = new Map(latest.map((item) => [item.id, item.src]));
  const kept = shown.map((item) => {
    const src = fresh.get(item.id);
    return src && src !== item.src ? { ...item, src } : item;
  });
  const known = new Set(shown.map((item) => item.id));
  return [...kept, ...latest.filter((item) => !known.has(item.id))];
}

/** Échec d'un toucher en mode marquage, dans la bande à côté de « OK » : court, sur une ligne. */
export const MARK_ERROR = 'Pas enregistré. Réessaie.';
/** Message de requireUser() sans session (AuthError 401, lib/server/auth.ts). */
export const SIGNED_OUT = 'Connexion requise.';

/**
 * Message de la bande après un toucher raté : le texte court, sauf une session perdue, où
 * réessayer ne sert à rien (il faut se reconnecter).
 */
export function markFailure(failure: string): string {
  return failure === SIGNED_OUT ? SIGNED_OUT : MARK_ERROR;
}

/** « 24 pièces », « 1 pièce ». */
export function piecesLabel(count: number): string {
  return `${count} ${count > 1 ? 'pièces' : 'pièce'}`;
}

/**
 * Place dans la grille gardée en partant vers une fiche (sessionStorage) : au retour, la grille
 * revient à la même catégorie et au même défilement, une fois ses vignettes montées. La
 * restauration du navigateur échoue derrière <Suspense> (la grille arrive après la coquille).
 */
export const RETURN_KEY = 'garde-robe:retour';
/** Au-delà, la place gardée est oubliée : ce n'est plus un retour depuis la fiche. */
export const RETURN_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * `to` : la page ouverte depuis la grille (fiche, vue « au sale »). Sur cette page, le retour
 * reprend l'historique (router.back()) : la page précédente est la grille.
 */
export type GridReturn = { y: number; category: Category | null; at: number; to: string | null };

export function encodeReturn(place: GridReturn): string {
  return JSON.stringify(place);
}

/** Vrai si `pathname` est la page ouverte depuis la grille quand la place a été gardée. */
export function openedFromGrid(place: GridReturn | null, pathname: string): boolean {
  return place !== null && place.to !== null && place.to === pathname;
}

/** Place relue, ou null si elle est absente, mal formée ou trop ancienne. */
export function decodeReturn(raw: string | null, now: number): GridReturn | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const { y, category, at, to } = value as Record<string, unknown>;
  if (typeof y !== 'number' || !Number.isFinite(y) || y < 0) return null;
  if (typeof at !== 'number' || now - at > RETURN_MAX_AGE_MS || at > now) return null;
  const known = CATEGORIES.find((entry) => entry === category) ?? null;
  // Un chemin de l'app seulement (« /gestion/… »), jamais une adresse d'ailleurs.
  const opened = typeof to === 'string' && to.startsWith('/') && !to.startsWith('//') && to.length <= 200 ? to : null;
  return { y, category: known, at, to: opened };
}
