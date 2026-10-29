// Gestes caméra (docs/conception.md §5) : reconnaissance en fonctions pures, sans caméra ni MediaPipe.
// Le miroir (étape 2) fait tourner MediaPipe, donne chaque image à stepGestures et applique les
// actions ; cameraPacing lui dit quand faire tourner PoseLandmarker et le Gesture Recognizer.

export * from './constants';
export { DEFAULT_GESTURE_SETTINGS, type GestureSettings } from './settings';
export { createGestureState, disarm, stepGestures, type GestureState } from './tracker';
export { cameraPacing, type CameraPacing } from './pacing';
export { recognizedHands, type RecognizerResultLike } from './recognizer';
export type {
  ArmState,
  DebugZones,
  GestureAction,
  GestureFrame,
  GestureOutput,
  HandSide,
  HandView,
  HoldAction,
  HoldView,
  PoseLandmark,
  RecognizedHand,
} from './types';
