import { POSE_LANDMARKS } from './constants';
import { cameraPacing } from './pacing';
import { createGestureState, stepGestures, type GestureState } from './tracker';
import type {
  GestureAction,
  GestureFrame,
  GestureOutput,
  HandSide,
  HoldAction,
  PoseLandmark,
  RecognizedHand,
} from './types';

// Poses synthétiques pour les tests des gestes : rien que des nombres, aucune image. Une personne
// debout de face à environ 1,5 m de la caméra de la tablette en portrait (proportions réalistes),
// dont on place les mains en unités du corps.

/** Le corps vu par la caméra. Longueurs en hauteurs d'image, x normalisés comme MediaPipe. */
export type Body = {
  /** Largeur / hauteur de l'image analysée. */
  aspect: number;
  /** Milieu des épaules, en x normalisé (0..1 de la largeur). */
  centerX: number;
  shoulderY: number;
  /** Longueur de buste (milieu des épaules → milieu des hanches). */
  torso: number;
  /** Demi-largeur d'épaules. */
  half: number;
  /** Demi-largeur de hanches (les repères « hanches » sont les articulations, plus serrées). */
  hipsHalf: number;
};

/** Tablette en portrait (9:16), personne à 1,5 m environ. */
export const PORTRAIT: Body = { aspect: 9 / 16, centerX: 0.5, shoulderY: 0.3, torso: 0.2, half: 0.08, hipsHalf: 0.056 };
/** La même personne dans une image en paysage (16:9) : mêmes proportions, autre format. */
export const LANDSCAPE: Body = { aspect: 16 / 9, centerX: 0.5, shoulderY: 0.25, torso: 0.3, half: 0.12, hipsHalf: 0.084 };

/**
 * Une main : u en demi-largeurs d'épaules depuis le milieu du buste (> 0 : à SA droite), v en
 * longueurs de buste sous les épaules (< 0 : au-dessus).
 */
export type Place = { u: number; v: number };

/**
 * Hauteurs tirées des proportions moyennes (à régler sur soi) : la ligne du bas est à 1,2
 * longueur de buste sous les épaules (hanches + 0,2) ; une main le long du corps (milieu poignet –
 * index) tombe vers 1,25, juste dessous ; tendue devant les cuisses, elle n'atteint qu'environ 1,22.
 */
export const PLACES = {
  /** Bras le long du corps, main à côté du haut des cuisses (sous la ligne du bas). */
  restLeft: { u: -1.4, v: 1.25 },
  restRight: { u: 1.4, v: 1.25 },
  /** Bras le long du corps, mains un peu plus haut (hanches larges, coudes pliés). */
  restHighLeft: { u: -1.4, v: 1.15 },
  restHighRight: { u: 1.4, v: 1.15 },
  /** Devant la poitrine. */
  chestLeft: { u: -0.25, v: 0.35 },
  chestRight: { u: 0.25, v: 0.35 },
  /** Bras tendu sur le côté, à hauteur de poitrine. */
  sideRight: { u: 2.1, v: 0.4 },
  sideLeft: { u: -2.1, v: 0.4 },
  /** Au-dessus de la tête, un peu sur le côté. */
  overheadRight: { u: 1.0, v: -0.95 },
  overheadLeft: { u: -1.0, v: -0.95 },
  /** Au-dessus de la tête, bien au milieu (dans la zone de l'essai, qui monte jusqu'à 1,2). */
  straightUp: { u: 0.3, v: -0.95 },
  /** Main posée sur le haut de la tête (sous la ligne du haut, à 0,65). */
  headTop: { u: 0.2, v: -0.55 },
  /** Vers le bas, bras tendu devant les cuisses : à peine sous la ligne du bas. */
  thighs: { u: 0.1, v: 1.22 },
  /** Main levée sur le côté de l'épaule, hors de la poitrine (pouce levé « à côté »). */
  shoulderRight: { u: 1.5, v: 0.05 },
} as const satisfies Record<string, Place>;

/** Ce que voit le Gesture Recognizer pour une main : sa catégorie (score 0,9) ou catégorie et score. */
export type SeenGesture = string | { category: string; score: number };

/** Ce que voient les deux modèles à un instant. */
export type Shot = {
  /** null : main pas vue (visibilité 0,1). */
  left: Place | null;
  right: Place | null;
  /** Gesture Recognizer, quand il tourne : ce qu'il voit sur chaque main levée nommée ici. */
  gesture?: Partial<Record<HandSide, SeenGesture>>;
  /** absent : PoseLandmarker ne voit personne ; hipsPoor : hanches à 0,3 ; shouldersPoor : épaules à 0,3. */
  person?: 'present' | 'absent' | 'hipsPoor' | 'shouldersPoor';
  body?: Body;
};

export const STANDING: Shot = { left: PLACES.restLeft, right: PLACES.restRight };

/** Position normalisée d'une main placée en unités du corps. */
export function placeToPoint(place: Place, body: Body): { x: number; y: number } {
  const x = (body.centerX * body.aspect - place.u * body.half) / body.aspect;
  return { x, y: body.shoulderY + place.v * body.torso };
}

/** Les 33 repères de PoseLandmarker pour ce plan, ou null s'il ne voit personne. */
export function poseOf(shot: Shot): PoseLandmark[] | null {
  if (shot.person === 'absent') return null;
  const body = shot.body ?? PORTRAIT;
  const cx = body.centerX * body.aspect;
  const at = (xIso: number, y: number, visibility = 1): PoseLandmark => ({ x: xIso / body.aspect, y, visibility });
  const hipsY = body.shoulderY + body.torso;
  const shoulderVis = shot.person === 'shouldersPoor' ? 0.3 : 1;
  const hipVis = shot.person === 'hipsPoor' ? 0.3 : 1;
  const pose: PoseLandmark[] = Array.from({ length: 33 }, () => at(cx, body.shoulderY - 0.4 * body.torso));
  // Son côté gauche est du côté des x plus grands : l'image brute de la caméra frontale n'est pas inversée.
  pose[POSE_LANDMARKS.leftShoulder] = at(cx + body.half, body.shoulderY, shoulderVis);
  pose[POSE_LANDMARKS.rightShoulder] = at(cx - body.half, body.shoulderY, shoulderVis);
  pose[POSE_LANDMARKS.leftHip] = at(cx + body.hipsHalf, hipsY, hipVis);
  pose[POSE_LANDMARKS.rightHip] = at(cx - body.hipsHalf, hipsY, hipVis);
  pose[POSE_LANDMARKS.leftKnee] = at(cx + body.hipsHalf, hipsY + 0.9 * body.torso);
  pose[POSE_LANDMARKS.rightKnee] = at(cx - body.hipsHalf, hipsY + 0.9 * body.torso);
  for (const side of ['left', 'right'] as const) {
    const place = shot[side];
    const wrist = side === 'left' ? POSE_LANDMARKS.leftWrist : POSE_LANDMARKS.rightWrist;
    const index = side === 'left' ? POSE_LANDMARKS.leftIndex : POSE_LANDMARKS.rightIndex;
    if (!place) {
      pose[wrist] = at(cx, hipsY, 0.1);
      pose[index] = at(cx, hipsY, 0.1);
      continue;
    }
    // Poignet un peu sous l'index : leur milieu est la main.
    const p = placeToPoint(place, body);
    const dy = 0.06 * body.torso;
    pose[wrist] = { x: p.x, y: p.y + dy, visibility: 1 };
    pose[index] = { x: p.x, y: p.y - dy, visibility: 1 };
  }
  return pose;
}

/** Ce que rend le Gesture Recognizer pour ce plan (centre de chaque main nommée dans `gesture`). */
export function handsOf(shot: Shot): RecognizedHand[] {
  if (shot.person === 'absent') return [];
  const body = shot.body ?? PORTRAIT;
  const out: RecognizedHand[] = [];
  for (const side of ['left', 'right'] as const) {
    const seen = shot.gesture?.[side];
    const place = shot[side];
    if (seen === undefined || !place) continue;
    const { category, score } = typeof seen === 'string' ? { category: seen, score: 0.9 } : seen;
    // Le centre de la main du Gesture Recognizer tombe un peu à côté du point de la pose.
    const p = placeToPoint({ u: place.u + 0.1, v: place.v - 0.03 }, body);
    out.push({ category, score, x: p.x, y: p.y, handedness: side === 'left' ? 'Right' : 'Left' });
  }
  return out;
}

/** Une image : la pose, et les mains si le Gesture Recognizer a tourné. */
export function frameOf(t: number, shot: Shot, recognizer: boolean): GestureFrame {
  const body = shot.body ?? PORTRAIT;
  return { t, aspect: body.aspect, pose: poseOf(shot), hands: recognizer ? handsOf(shot) : null };
}

type Segment = { ms: number; from: Shot; to: Shot };

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function lerpPlace(a: Place | null, b: Place | null, k: number): Place | null {
  if (!a || !b) return b;
  return { u: lerp(a.u, b.u, k), v: lerp(a.v, b.v, k) };
}

/** Un mouvement dans le temps : des plans tenus et des mouvements (interpolés en ligne droite). */
export class Script {
  private readonly segments: Segment[] = [];
  private last: Shot;

  constructor(start: Shot = STANDING) {
    this.last = start;
  }

  /** Reste `ms` dans ce plan (le précédent, modifié par `change`). */
  stay(ms: number, change: Partial<Shot> = {}): this {
    const shot = { ...this.last, ...change };
    this.segments.push({ ms, from: shot, to: shot });
    this.last = shot;
    return this;
  }

  /** Va en `ms` du plan précédent à celui-ci ; `gesture` et `person` sont ceux d'arrivée. */
  move(ms: number, change: Partial<Shot>): this {
    const to = { ...this.last, ...change };
    this.segments.push({ ms, from: { ...this.last, gesture: to.gesture, person: to.person }, to });
    this.last = to;
    return this;
  }

  get duration(): number {
    return this.segments.reduce((sum, s) => sum + s.ms, 0);
  }

  shotAt(t: number): Shot {
    let start = 0;
    for (const s of this.segments) {
      if (t < start + s.ms) {
        const k = s.ms > 0 ? (t - start) / s.ms : 1;
        return { ...s.to, left: lerpPlace(s.from.left, s.to.left, k), right: lerpPlace(s.from.right, s.to.right, k) };
      }
      start += s.ms;
    }
    return this.last;
  }
}

export type Played = {
  state: GestureState;
  outputs: Array<{ t: number; output: GestureOutput }>;
  actions: Array<{ t: number; action: GestureAction }>;
  /** Instants où PoseLandmarker et le Gesture Recognizer ont tourné. */
  poseAt: number[];
  recognizerAt: number[];
};

/**
 * Joue le mouvement comme le miroir : une horloge d'écran à 60 Hz, et à chaque tic, cameraPacing
 * dit s'il faut analyser l'image (et avec le Gesture Recognizer ou non). `disabledHolds` : les
 * gestes tenus que l'écran ne peut pas faire à cet instant (local au mouvement).
 */
export function play(
  script: Script,
  options: {
    state?: GestureState;
    start?: number;
    tickMs?: number;
    disabledHolds?: (local: number) => readonly HoldAction[];
  } = {},
): Played {
  let state = options.state ?? createGestureState();
  const start = options.start ?? 0;
  const tickMs = options.tickMs ?? 1000 / 60;
  const played: Played = { state, outputs: [], actions: [], poseAt: [], recognizerAt: [] };
  for (let i = 0; i * tickMs <= script.duration; i++) {
    const local = i * tickMs;
    const t = start + local;
    const pacing = cameraPacing(state, t);
    if (!pacing.runPose) continue;
    const frame = frameOf(t, script.shotAt(local), pacing.runRecognizer);
    const step = stepGestures(state, { ...frame, disabledHolds: options.disabledHolds?.(local) });
    state = step.state;
    played.poseAt.push(t);
    if (pacing.runRecognizer) played.recognizerAt.push(t);
    played.outputs.push({ t, output: step.output });
    for (const action of step.output.actions) played.actions.push({ t, action });
  }
  played.state = state;
  return played;
}

/**
 * Les deux mains devant la poitrine, puis levées en 300 ms, la droite `lag` ms après la gauche (même
 * vitesse, en ligne droite). `gesture` : ce que voit le Gesture Recognizer pendant et après.
 */
export function raiseBothLate(lag: number, upLeft: Place, upRight: Place, gesture: Shot['gesture'] = {}): Script {
  const along = (from: Place, to: Place, k: number): Place => ({
    u: from.u + (to.u - from.u) * k,
    v: from.v + (to.v - from.v) * k,
  });
  const { chestLeft, chestRight } = PLACES;
  const script = new Script().stay(300).move(400, { left: chestLeft, right: chestRight }).stay(200);
  if (lag > 0) script.move(lag, { left: along(chestLeft, upLeft, lag / 300), gesture });
  script.move(300 - lag, { left: upLeft, right: along(chestRight, upRight, (300 - lag) / 300), gesture });
  if (lag > 0) script.move(lag, { right: upRight, gesture });
  return script;
}

/** Les actions seules, dans l'ordre. */
export function actionsOf(played: Played): GestureAction[] {
  return played.actions.map((a) => a.action);
}
