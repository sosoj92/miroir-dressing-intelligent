import { PACING_SLACK_MS, POSE_FAST_LINGER_MS, POSE_FPS_IDLE, POSE_FPS_PRESENT, RECOGNIZER_FPS_MAX } from './constants';
import type { GestureState } from './tracker';

// Rythme de la caméra (économie : le GPU de la tablette n'est pas encore mesuré). Fonction pure.
// - PoseLandmarker lite : 5 images/s quand personne, 30 images/s quand quelqu'un est là (et encore
//   1 s après la dernière image où on l'a vu) ;
// - Gesture Recognizer : seulement quand le corps est bien vu et qu'une main est levée au-dessus de
//   la taille, à 10 images/s au plus, sur une image où PoseLandmarker tourne aussi.

export type CameraPacing = {
  /** Faire tourner PoseLandmarker sur cette image (puis stepGestures). */
  runPose: boolean;
  /** Faire tourner aussi le Gesture Recognizer sur cette image. */
  runRecognizer: boolean;
  /** Intervalle visé entre deux images de PoseLandmarker : 200 ms ou 33 ms. */
  poseIntervalMs: number;
};

export function cameraPacing(state: GestureState, now: number): CameraPacing {
  const fast = now - state.lastSeenAt <= POSE_FAST_LINGER_MS;
  const poseIntervalMs = 1000 / (fast ? POSE_FPS_PRESENT : POSE_FPS_IDLE);
  const runPose = now - state.lastPoseAt >= poseIntervalMs - PACING_SLACK_MS;
  const runRecognizer =
    runPose &&
    state.body &&
    state.raised &&
    now - state.lastRecognizerAt >= 1000 / RECOGNIZER_FPS_MAX - PACING_SLACK_MS;
  return { runPose, runRecognizer, poseIntervalMs };
}
