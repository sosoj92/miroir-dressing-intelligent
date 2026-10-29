import {
  ARM_FRAMES,
  ARM_TIMEOUT_MS,
  BAND_TOP,
  BODY_VISIBILITY,
  CENTER_IN,
  DOWN_LINE,
  EXIT_FRAMES,
  GESTURE_COOLDOWN_MS,
  HOLD_GRACE_MS,
  HOLD_MATCH,
  HOLD_MIN_SCORE,
  HOLD_MS,
  HOLD_PAUSE_MS,
  HOLD_STILL,
  HORIZONTAL,
  MIN_SHOULDER_RATIO,
  MIN_VISIBILITY,
  POSE_GAP_MS,
  PRESENCE_VISIBILITY,
  SIDE_OUT,
  THIGH_FRONT,
  UP_LINE,
  WAIST,
  ZONE_SMOOTHING,
} from './constants';

/**
 * Les seuils d'une machine à gestes. Par défaut, les constantes (constants.ts) ; un réglage de
 * sensibilité (docs/conception.md §4, Réglages) ou un test peut en changer certains à la création.
 */
export type GestureSettings = {
  minVisibility: number;
  bodyVisibility: number;
  minShoulderRatio: number;
  presenceVisibility: number;
  poseGapMs: number;
  zoneSmoothing: number;
  centerIn: number;
  sideOut: number;
  armFrames: number;
  exitFrames: number;
  cooldownMs: number;
  armTimeoutMs: number;
  waist: number;
  bandTop: number;
  horizontal: number;
  upLine: number;
  downLine: number;
  thighFront: number;
  holdMs: number;
  holdPauseMs: number;
  holdMinScore: number;
  holdGraceMs: number;
  holdStill: number;
  holdMatch: number;
};

export const DEFAULT_GESTURE_SETTINGS: Readonly<GestureSettings> = Object.freeze({
  minVisibility: MIN_VISIBILITY,
  bodyVisibility: BODY_VISIBILITY,
  minShoulderRatio: MIN_SHOULDER_RATIO,
  presenceVisibility: PRESENCE_VISIBILITY,
  poseGapMs: POSE_GAP_MS,
  zoneSmoothing: ZONE_SMOOTHING,
  centerIn: CENTER_IN,
  sideOut: SIDE_OUT,
  armFrames: ARM_FRAMES,
  exitFrames: EXIT_FRAMES,
  cooldownMs: GESTURE_COOLDOWN_MS,
  armTimeoutMs: ARM_TIMEOUT_MS,
  waist: WAIST,
  bandTop: BAND_TOP,
  horizontal: HORIZONTAL,
  upLine: UP_LINE,
  downLine: DOWN_LINE,
  thighFront: THIGH_FRONT,
  holdMs: HOLD_MS,
  holdPauseMs: HOLD_PAUSE_MS,
  holdMinScore: HOLD_MIN_SCORE,
  holdGraceMs: HOLD_GRACE_MS,
  holdStill: HOLD_STILL,
  holdMatch: HOLD_MATCH,
});
