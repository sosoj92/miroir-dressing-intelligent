import { MIN_HALF_WIDTH, POSE_LANDMARKS } from './constants';
import type { GestureSettings } from './settings';
import type { DebugZones, HandSide, PoseLandmark } from './types';

// Géométrie des zones (essai de calibration, zonesOf). Fonctions pures.
//
// Espace des zones : x × aspect, y tel quel. Les deux axes ont la même unité (la hauteur de l'image),
// comme les pixels de l'essai : « plus horizontal que vertical » et les distances ne dépendent pas
// du format de l'image (portrait ou paysage).

/** Un repère dans l'espace des zones, avec sa visibilité brute (non lissée). */
export type Joint = { x: number; y: number; v: number };

const SKELETON_JOINTS = [
  'leftShoulder',
  'rightShoulder',
  'leftWrist',
  'rightWrist',
  'leftIndex',
  'rightIndex',
  'leftHip',
  'rightHip',
] as const;

type JointName = (typeof SKELETON_JOINTS)[number];

/** Les seuls repères dont les zones ont besoin. */
export type Skeleton = Record<JointName, Joint>;

const LAST_INDEX = Math.max(...SKELETON_JOINTS.map((name) => POSE_LANDMARKS[name]));

/** Repères de PoseLandmarker → squelette dans l'espace des zones ; null si la liste est trop courte. */
export function readSkeleton(pose: readonly PoseLandmark[], aspect: number): Skeleton | null {
  if (pose.length <= LAST_INDEX || !(aspect > 0)) return null;
  const joint = (name: JointName): Joint => {
    const landmark = pose[POSE_LANDMARKS[name]];
    return { x: landmark.x * aspect, y: landmark.y, v: landmark.visibility ?? 1 };
  };
  return Object.fromEntries(SKELETON_JOINTS.map((name) => [name, joint(name)])) as Skeleton;
}

/**
 * Lissage des zones (ZONE_SMOOTHING) : `k` de la nouvelle position, 1 − k de l'ancienne ; la
 * visibilité reste celle de la nouvelle image. Sans image précédente, la nouvelle telle quelle.
 */
export function smoothSkeleton(prev: Skeleton | null, next: Skeleton, k: number): Skeleton {
  if (!prev) return next;
  const out = {} as Skeleton;
  for (const name of SKELETON_JOINTS) {
    const a = prev[name];
    const b = next[name];
    out[name] = { x: b.x * k + a.x * (1 - k), y: b.y * k + a.y * (1 - k), v: b.v };
  }
  return out;
}

/** Présence : les deux épaules vues. */
export function isPresent(skeleton: Skeleton, settings: GestureSettings): boolean {
  return (
    skeleton.leftShoulder.v >= settings.presenceVisibility && skeleton.rightShoulder.v >= settings.presenceVisibility
  );
}

/** Épaules et hanches bien vues : sans ça, aucun geste. */
export function isBodyVisible(skeleton: Skeleton, settings: GestureSettings): boolean {
  const min = settings.bodyVisibility;
  return (
    skeleton.leftShoulder.v >= min &&
    skeleton.rightShoulder.v >= min &&
    skeleton.leftHip.v >= min &&
    skeleton.rightHip.v >= min
  );
}

/** Zones d'une image, dans l'espace des zones. */
export type Zones = {
  /** Milieu des épaules (centre du buste). */
  centerX: number;
  shoulderY: number;
  /** Demi-largeur d'épaules (sur x seulement, comme l'essai). */
  half: number;
  /** Longueur de buste : milieu des épaules → milieu des hanches. */
  torso: number;
  hipsX: number;
  /** Demi-largeur de hanches. */
  hipsHalf: number;
  /** Haut de la zone de la poitrine (BAND_TOP au-dessus des épaules). */
  chestTop: number;
  /** La taille (WAIST sous les épaules) : bas de la zone de la poitrine. */
  waist: number;
  /** Ligne « au-dessus de la tête ». */
  up: number;
  /** Ligne « vers les cuisses ». */
  down: number;
};

export function zonesOf(s: Skeleton, settings: GestureSettings): Zones {
  const centerX = (s.leftShoulder.x + s.rightShoulder.x) / 2;
  const shoulderY = (s.leftShoulder.y + s.rightShoulder.y) / 2;
  const hipsX = (s.leftHip.x + s.rightHip.x) / 2;
  const hipsY = (s.leftHip.y + s.rightHip.y) / 2;
  const torso = Math.hypot(hipsX - centerX, hipsY - shoulderY);
  return {
    centerX,
    shoulderY,
    half: Math.max(Math.abs(s.leftShoulder.x - s.rightShoulder.x) / 2, MIN_HALF_WIDTH),
    torso,
    hipsX,
    hipsHalf: Math.max(Math.abs(s.leftHip.x - s.rightHip.x) / 2, MIN_HALF_WIDTH),
    chestTop: shoulderY - settings.bandTop * torso,
    waist: shoulderY + settings.waist * torso,
    up: shoulderY - settings.upLine * torso,
    down: hipsY + settings.downLine * torso,
  };
}

/**
 * De face, ou au moins pas de profil : la demi-largeur d'épaules n'est pas effondrée. De profil, les
 * épaules se superposent dans l'image, u n'a plus de sens (MIN_SHOULDER_RATIO).
 */
export function isFacing(zones: Zones, settings: GestureSettings): boolean {
  return zones.half >= settings.minShoulderRatio * zones.torso;
}

/** Point d'une main : milieu poignet – index, s'ils sont vus tous les deux ; null sinon. */
export function handPoint(s: Skeleton, side: HandSide, settings: GestureSettings): { x: number; y: number } | null {
  const wrist = side === 'left' ? s.leftWrist : s.rightWrist;
  const index = side === 'left' ? s.leftIndex : s.rightIndex;
  if (wrist.v < settings.minVisibility || index.v < settings.minVisibility) return null;
  return { x: (wrist.x + index.x) / 2, y: (wrist.y + index.y) / 2 };
}

/**
 * Position horizontale vue de la personne face au miroir, en demi-largeurs d'épaules : l'image
 * brute de la caméra frontale n'est pas inversée, sa droite est donc du côté des x plus petits.
 * u > 0 : à sa droite.
 */
export function horizontalOf(x: number, zones: Zones): number {
  return -(x - zones.centerX) / zones.half;
}

/** Devant la poitrine : là où la main s'arme. */
export function isInChest(point: { x: number; y: number }, zones: Zones, settings: GestureSettings): boolean {
  return (
    Math.abs(horizontalOf(point.x, zones)) < settings.centerIn && point.y >= zones.chestTop && point.y < zones.waist
  );
}

/** Zones pour le debug, en coordonnées normalisées de l'image. */
export function debugZones(zones: Zones, aspect: number, settings: GestureSettings): DebugZones {
  const x = (value: number) => value / aspect;
  const span = (center: number, half: number) => ({ x0: x(center - half), x1: x(center + half) });
  return {
    chest: { ...span(zones.centerX, zones.half * settings.centerIn), y0: zones.chestTop, y1: zones.waist },
    sides: span(zones.centerX, zones.half * settings.sideOut),
    upY: zones.up,
    downY: zones.down,
    waistY: zones.waist,
    thighs: span(zones.hipsX, zones.hipsHalf * settings.thighFront),
  };
}
