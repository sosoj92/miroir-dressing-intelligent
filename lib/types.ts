// Contrat partagé des phases 1 et 2. Les noms de champs sont ceux des colonnes (docs/conception.md §3).
// Ce fichier ne contient que des types et des listes de valeurs : aucun code serveur ni réseau.

export const CATEGORIES = ['haut', 'bas', 'robe', 'veste', 'chaussures', 'accessoire'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  haut: 'Haut',
  bas: 'Bas',
  robe: 'Robe',
  veste: 'Veste',
  chaussures: 'Chaussures',
  accessoire: 'Accessoire',
};

/** Styles d'une pièce, stockés en liste (docs/conception.md §3, §11, 3). */
export const STYLES = ['decontracte', 'habille', 'sport'] as const;
export type Style = (typeof STYLES)[number];

export const STYLE_LABELS: Record<Style, string> = {
  decontracte: 'Décontracté',
  habille: 'Habillé',
  sport: 'Sport',
};

/** Chaleur : 1 léger, 2 moyen, 3 chaud. */
export type Warmth = 1 | 2 | 3;

export const WARMTH_LABELS: Record<Warmth, string> = { 1: 'Léger', 2: 'Moyen', 3: 'Chaud' };

/**
 * Photo portée sur fond vert, détourée, et ses repères (assemblage, docs/conception.md §7). Les positions
 * verticales sont en px sous le milieu des yeux, dans la photo détourée (`size`).
 */
export type AssemblyPhoto = {
  /** Nom de la photo source (ex. « PHOTO_A ») : plusieurs pièces peuvent la partager. */
  key: string;
  size: [number, number]; // largeur, hauteur en px
  eye: [number, number]; // milieu des yeux, en px
  /** [px sous les yeux, x du milieu de la silhouette], tous les 10 px, dans l'ordre. */
  centers: Array<[number, number]>;
  /** Point le plus bas de tous les vêtements du haut ; null s'il dépasse la zone mesurée. */
  topLow: number | null;
  /** Point le plus haut du bord supérieur du bas ; null s'il est caché. */
  bottomHigh: number | null;
  onePiece: boolean; // robe
  tucked: boolean; // haut rentré dans le bas
  /**
   * Bras pliés (docs/conception.md §7, version 1 du champ arms) : couches et bords des bras de cette photo. Absent pour
   * une photo importée avant, une robe ou un accessoire : la silhouette se dessine alors comme avant.
   */
  arms?: AssemblyArms;
};

/**
 * Couche des bras pliés : image WebP rognée (1 px transparent sur chaque bord) et sa place dans la
 * photo. `path` : `bras/<clé>.webp` dans le zip, `<userId>/assemblage/bras/<clé>.webp` en base.
 */
export type ArmsLayer = {
  path: string;
  /** [x, y, largeur, hauteur], entiers, en px de la photo ; la marge peut déborder du cadre de 1 px. */
  box: [number, number, number, number];
};

/** Bords [xmin, xmax] des bras (ou des manches) d'un côté sur une ligne, en colonnes de la photo ; null : rien. */
export type ArmSpan = [number, number] | null;

/** Une valeur par côté de l'image (L : colonnes < eye[0], R : colonnes ≥ eye[0]), en px sous les yeux. */
export type ArmSides = { L: number | null; R: number | null };

/** Champ `arms` d'une photo (format : scripts/assemblage/README.md). */
export type AssemblyArms = {
  v: 1;
  /** Bras, mains, bracelets et manches sous l'ourlet seuls. */
  arms: ArmsLayer;
  /** Photo détourée sans les bras, corps caché sous les bras complété. */
  body: ArmsLayer;
  /** Manches du haut sous l'ourlet ; null si la photo n'en a pas. */
  sleeves: ArmsLayer | null;
  /** L'élément i des tableaux décrit la ligne `from + i × step` px sous les yeux (5 et 250). */
  step: number;
  from: number;
  L: ArmSpan[];
  R: ArmSpan[];
  sleeveL: ArmSpan[];
  sleeveR: ArmSpan[];
  /** Poignet : première ligne, dès `from`, où la main a au moins 15 px. */
  wrist: ArmSides;
  /** Bas de manche : dernière ligne où la manche a au moins 10 px. */
  cuff: ArmSides;
};

/** URL signées (1 h) des couches des bras pliés d'une photo ; null si la signature a échoué ou sans couche. */
export type ArmsUrls = { arms: string | null; body: string | null; sleeves: string | null };

/** Colonne `items.assembly` (jsonb). La photo détourée est `cutout_path`, l'originale `photo_path`. */
export type Assembly = {
  v: 1;
  photo: AssemblyPhoto;
  /** Manches et mains sous l'ourlet (haut ou veste à manches), bucket `items` ; sinon null. */
  sleevesPath: string | null;
};

/** Une ligne de `items`. */
export type Item = {
  id: string;
  name: string;
  category: Category;
  color: string | null; // #RRGGBB
  warmth: Warmth;
  styles: Style[];
  rain_ok: boolean;
  dirty: boolean;
  photo_path: string | null; // bucket `items`, <user_id>/…
  cutout_path: string | null; // PNG transparent, bucket `items`, <user_id>/…
  legacy_id: string | null; // id d'origine (prototype ou paquet d'assemblage) : import idempotent (docs/conception.md §3.1, §3.2)
  created_at: string;
  /** Repères d'assemblage d'une pièce photographiée portée (docs/conception.md §7) ; absent ou null sinon. */
  assembly?: Assembly | null;
};

/** Champs d'une fiche que l'on corrige avant d'enregistrer (docs/conception.md §4, écran 3). */
export type ItemDraft = Pick<Item, 'name' | 'category' | 'color' | 'warmth' | 'styles' | 'rain_ok'>;

/** Correspondance touches → actions (docs/conception.md §5). La touche qui réveille l'écran ne fait rien d'autre. */
/** Ordre du test des touches. next / previous changent le haut, bottomNext / bottomPrevious le bas (docs/conception.md §4). */
export const KEY_ACTIONS = ['next', 'previous', 'bottomNext', 'bottomPrevious', 'jacket', 'accept', 'refuse', 'restart'] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number];

export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  next: 'Haut suivant',
  previous: 'Haut précédent',
  bottomNext: 'Bas suivant',
  bottomPrevious: 'Bas précédent',
  jacket: 'Veste suivante',
  accept: 'Accepter',
  refuse: 'Refuser',
  restart: 'Recommencer',
};

/**
 * Touche conseillée, affichée sous l'action au test des touches (docs/conception.md §5) : les touches de PC par
 * défaut (plus de manette). « haut » et « bas » y désignent des vêtements, pas des directions.
 */
export const KEY_ACTION_HINTS: Record<KeyAction, string> = {
  next: 'flèche droite →',
  previous: 'flèche gauche ←',
  bottomNext: 'flèche vers le haut ↑',
  bottomPrevious: 'flèche vers le bas ↓',
  jacket: 'V',
  accept: 'Entrée',
  refuse: 'Retour arrière',
  restart: 'R',
};

/** `event.code` et `event.key` enregistrés par l'écran « Test des touches ». */
export type KeyBinding = { code: string; key: string };
export type KeyMap = Partial<Record<KeyAction, KeyBinding>>;

/** La ligne `profile` (clé primaire : owner). */
export type Profile = {
  photo_path: string | null;
  city: string;
  lat: number;
  lon: number;
  timezone: string; // IANA
  key_map: KeyMap;
  key_test_requested: boolean;
  gestures_enabled: boolean;
  gesture_sensitivity: number;
  tryon_cap_eur: number;
  evening_hour: number; // à partir de cette heure, le miroir propose la tenue de demain
};

export type HistoryEntry = { date: string; item_ids: string[]; title: string | null };
export type Plan = { date: string; item_ids: string[]; confirmed: boolean };
/**
 * `item_ids` trié : pièces principales (haut + bas, ou robe) et veste (docs/conception.md §6). `day` (GET
 * /api/miroir) : jour visé par le miroir quand le refus a été fait ; « Recommencer » efface les
 * refus de ce jour-là (docs/conception.md §4).
 */
export type Refusal = { item_ids: string[]; day?: string };

/** Météo du jour visé (Open-Meteo, docs/conception.md §9 : la ville seule sort, sans clé). */
export type DayWeather = {
  date: string; // AAAA-MM-JJ
  tempMin: number;
  tempMax: number;
  /** Température de référence pour comparer la chaleur des pièces (°C). */
  temp: number;
  code: number; // code météo WMO
  rain: boolean;
  label: string; // « Pluie », « Ensoleillé »…
};

/** Entrées de `generateOutfits` (docs/conception.md §6). */
export type OutfitContext = {
  date: string; // jour visé, AAAA-MM-JJ dans profile.timezone
  weather: DayWeather | null;
  history: HistoryEntry[];
  refusals: Refusal[];
  plan: Plan | null; // tenue prévue pour `date`, si elle existe
};

export type Outfit = {
  /** Identifiant stable : ids de toutes les pièces, triés, joints par « + ». */
  key: string;
  /** Ordre d'affichage : veste, haut ou robe, bas, chaussures, accessoire. */
  item_ids: string[];
  /** Pièces principales + veste, triées : ce qu'enregistraient les refus de l'ancien format (docs/conception.md §6). */
  core_ids: string[];
  /**
   * Ce que montre la silhouette, trié : la robe, sinon la veste (ou le haut sans veste) et le bas.
   * C'est ce qu'enregistre un refus (docs/conception.md §6, §11, 4).
   */
  drawn_ids: string[];
  /** Titre simple de secours, sans réseau (« Pull marine et jean brut »). */
  title: string;
  /** Vrai si la tenue vient de `outfit_plans` (proposée en premier). */
  planned: boolean;
  score: number;
};

/** Pièce envoyée au miroir, avec l'URL signée (1 h) de sa photo détourée. */
export type MirrorItem = Item & {
  cutout_url: string | null;
  /** URL signée (1 h) des manches d'une pièce assemblée (Assembly.sleevesPath). */
  sleeves_url?: string | null;
  /** URL signées des couches des bras pliés (AssemblyPhoto.arms) ; absent si la photo n'en a pas. */
  arms_urls?: ArmsUrls;
};

/** Réponse de GET /api/miroir : tout ce que la tablette garde en mémoire (docs/conception.md §7 bis). */
export type MirrorPayload = {
  today: string; // AAAA-MM-JJ dans profile.timezone
  targetDate: string; // aujourd'hui, ou demain après evening_hour
  isTomorrow: boolean;
  timezone: string;
  eveningHour: number;
  weather: DayWeather | null;
  items: MirrorItem[]; // pièces propres (dirty = false)
  history: HistoryEntry[]; // 14 derniers jours
  refusals: Refusal[];
  plan: Plan | null; // plan de targetDate
  /** Touches d'un clavier de secours (test des touches, ?touches=test) ; vide : touches de PC. */
  keyMap: KeyMap;
};
