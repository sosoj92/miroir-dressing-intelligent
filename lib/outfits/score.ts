import type { Category, DayWeather, Warmth } from '@/lib/types';

// Règles de score des tenues (docs/conception.md §6). Plus le score est haut, meilleure est la pièce ou la tenue.
// Toutes les valeurs sont des constantes nommées pour pouvoir les régler sans relire l'algorithme.

// ---------- Météo ----------

/** Une veste s'ajoute à la tenue en dessous de cette température (°C), ou s'il pleut (docs/conception.md §6). */
export const JACKET_BELOW_C = 15;
/**
 * Elle s'ajoute aussi quand le minimum du jour passe sous ce seuil : on s'habille le matin, au plus
 * frais. Pas JACKET_BELOW_C : à 14–27 °C, il y aurait une veste dans toutes les tenues.
 */
export const JACKET_MORNING_BELOW_C = 12;
/** En dessous : chaleur visée 3 (chaud). */
export const COLD_BELOW_C = 10;
/** En dessous (et à partir de COLD_BELOW_C) : chaleur visée 2 (moyen) ; au-dessus : 1 (léger). */
export const MILD_BELOW_C = 18;
/** Température supposée sans météo (comme le prototype). */
export const NO_WEATHER_TEMP_C = 16;

/** Température de référence : `weather.temp` (fixée par lib/weather), à défaut le maximum, sinon 16 °C. */
export function referenceTemperature(weather: DayWeather | null | undefined): number {
  if (weather && Number.isFinite(weather.temp)) return weather.temp;
  if (weather && Number.isFinite(weather.tempMax)) return weather.tempMax;
  return NO_WEATHER_TEMP_C;
}

export function isRainy(weather: DayWeather | null | undefined): boolean {
  return weather?.rain === true;
}

/** Minimum du jour, ou null sans météo. */
export function morningTemperature(weather: DayWeather | null | undefined): number | null {
  return weather && Number.isFinite(weather.tempMin) ? weather.tempMin : null;
}

/**
 * Veste si < JACKET_BELOW_C, s'il pleut, ou si le matin est sous JACKET_MORNING_BELOW_C. Sans veste
 * disponible, la tenue s'en passe.
 */
export function needsJacket(weather: DayWeather | null | undefined): boolean {
  const morning = morningTemperature(weather);
  return (
    referenceTemperature(weather) < JACKET_BELOW_C ||
    isRainy(weather) ||
    (morning !== null && morning < JACKET_MORNING_BELOW_C)
  );
}

/** Chaleur visée de la veste : celle du matin (elle sert surtout au plus frais) ; sans météo, celle du jour. */
export function jacketTargetWarmth(weather: DayWeather | null | undefined): Warmth {
  const morning = morningTemperature(weather);
  return targetWarmth(Math.min(referenceTemperature(weather), morning ?? Infinity));
}

/** Chaleur visée (1 léger, 2 moyen, 3 chaud) pour une température. */
export function targetWarmth(temperature: number): Warmth {
  if (temperature < COLD_BELOW_C) return 3;
  if (temperature < MILD_BELOW_C) return 2;
  return 1;
}

// ---------- Pièces ----------

/** Score de chaleur selon l'écart avec la chaleur visée : 0 → 3, 1 → 1, 2 → −2 (prototype). */
export const WARMTH_SCORE_BY_GAP = [3, 1, -2] as const;

/** Poids de la chaleur par catégorie. Une robe vaut un haut + un bas, le bas compte moitié (prototype). */
export const WARMTH_WEIGHT: Record<Category, number> = {
  haut: 1,
  bas: 0.5,
  robe: 1.5,
  veste: 1,
  chaussures: 0.5,
  accessoire: 0.5,
};

/** Bonus d'une pièce « ok pluie » les jours de pluie, surtout pour la veste puis les chaussures. */
export const RAIN_OK_BONUS: Record<Category, number> = {
  haut: 0.5,
  bas: 0.5,
  robe: 0.5,
  veste: 4,
  chaussures: 1.5,
  accessoire: 0.5,
};

/**
 * Pénalité d'une pièce portée récemment, selon l'ancienneté : la veille, il y a 2 jours, il y a 3 jours.
 * Forte : une pièce parfaite portée ces 3 derniers jours passe derrière une pièce d'une chaleur voisine.
 */
export const RECENT_WEAR_PENALTY = [4.5, 3.5, 2.5] as const;
/** Fenêtre de la pénalité ci-dessus, en jours avant la date visée. */
export const RECENT_DAYS = RECENT_WEAR_PENALTY.length;

/** Les chaussures et accessoires vont avec beaucoup de tenues : leur répétition compte moitié. */
export const RECENCY_WEIGHT: Record<Category, number> = {
  haut: 1,
  bas: 1,
  robe: 1,
  veste: 1,
  chaussures: 0.5,
  accessoire: 0.5,
};

/** Même duo haut + bas porté dans les RECENT_PAIR_DAYS jours : RECENT_PAIR_PENALTY (prototype). */
export const RECENT_PAIR_DAYS = 14;
export const RECENT_PAIR_PENALTY = 12;

/** Un accessoire n'est ajouté que s'il rapporte strictement plus que ce score (il est facultatif). */
export const ACCESSORY_MIN_SCORE = 0;

export function warmthScore(warmth: Warmth, target: Warmth): number {
  const gap = Math.min(Math.abs(warmth - target), WARMTH_SCORE_BY_GAP.length - 1);
  return WARMTH_SCORE_BY_GAP[gap];
}

/** Chaleur lue en base, ramenée à 1–3 (2 par défaut si la valeur est inattendue). */
export function normalizeWarmth(value: unknown): Warmth {
  return value === 1 || value === 2 || value === 3 ? value : 2;
}

export type PieceContext = {
  target: Warmth;
  /** Chaleur visée de la veste (jacketTargetWarmth) ; à défaut, `target`. */
  jacketTarget?: Warmth;
  rain: boolean;
  /** Ancienneté (jours) de la dernière fois où chaque pièce a été portée avant la date visée. */
  lastWorn: ReadonlyMap<string, number>;
};

/** Score propre d'une pièce : chaleur, pluie et port récent (sans les couleurs ni le duo). */
export function pieceScore(
  piece: { id: string; category: Category; warmth: Warmth; rain_ok: boolean },
  context: PieceContext,
): number {
  const target = piece.category === 'veste' ? (context.jacketTarget ?? context.target) : context.target;
  let score = WARMTH_WEIGHT[piece.category] * warmthScore(normalizeWarmth(piece.warmth), target);
  if (context.rain && piece.rain_ok === true) score += RAIN_OK_BONUS[piece.category];
  const daysAgo = context.lastWorn.get(piece.id);
  if (daysAgo !== undefined && daysAgo >= 1 && daysAgo <= RECENT_DAYS) {
    score -= RECENT_WEAR_PENALTY[daysAgo - 1] * RECENCY_WEIGHT[piece.category];
  }
  return score;
}

// ---------- Variété entre les propositions ----------

/**
 * Retiré au classement d'une tenue pour chaque proposition déjà retenue qui partage cette pièce,
 * quand la silhouette la montre : la robe, sinon la veste (ou le haut sans veste), et le bas.
 * La variété se juge sur ce qu'on voit (docs/conception.md §6, §7).
 */
export const VARIETY_PENALTY: Record<Category, number> = {
  haut: 2,
  robe: 2,
  bas: 1,
  veste: 1,
  chaussures: 0,
  accessoire: 0,
};
/** Pièce cachée par la silhouette (haut sous une veste, veste sur une robe) : elle compte moins. */
export const HIDDEN_VARIETY_PENALTY = 1;

/**
 * Le même dessus visible (robe, veste, ou haut sans veste) apparaît au plus dans ce nombre de
 * propositions, s'il y a mieux à faire.
 */
export const MAX_SAME_TOP = 3;
/** Pénalité qui fait respecter MAX_SAME_TOP dès qu'un autre dessus est possible. */
export const TOP_REPEAT_PENALTY = 100;

/** Au-delà, seules les meilleures pièces du jour de chaque catégorie sont combinées (temps de calcul). */
export const MAX_PIECES_PER_CATEGORY = 20;
