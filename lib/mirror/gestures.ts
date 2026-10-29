import type { ArmState, GestureAction, GestureOutput, HandSide, HandView, HoldAction, HoldView } from '@/lib/gestures';
import { KEY_ACTION_LABELS } from '@/lib/types';
import type { CameraStatus } from './camera';
import { messageHidesOutfit, type MirrorState } from './state';

// Les gestes caméra sur le miroir (docs/conception.md §4, §5) : ce que l'écran fait d'une image analysée, et ce
// qu'affiche ?gestures=debug. Fonctions pures : la caméra et MediaPipe sont dans
// components/mirror/gestures/, la machine à gestes dans lib/gestures/.

/** Quelqu'un devant le miroir repousse la veille au plus une fois par seconde (pas à chaque image). */
export const PRESENCE_ACTIVITY_MS = 1_000;

/** Ce que fait le miroir d'une image analysée. */
export type GestureEffect = {
  /** Quelqu'un arrive devant le miroir endormi : il se réveille, et rien d'autre. */
  wake: boolean;
  /** Quelqu'un est là, ou un geste est parti : la veille est repoussée (2 min). */
  activity: boolean;
  /** Actions à faire, exactement comme leurs touches. */
  actions: GestureAction[];
  /** L'écran n'accepte pas de geste : la machine oublie les gestes commencés (disarm). */
  disarm: boolean;
  /** Anneau de progression du geste tenu, ou null. */
  hold: HoldView | null;
};

/** Écran qui accepte les gestes : la composition, éveillée, hors test des touches. */
export function acceptsGestures(state: MirrorState): boolean {
  return state.status === 'ready' && !state.sleeping && state.keyTest === null;
}

/**
 * Une image analysée sur cet écran :
 * - pendant « Chargement… », rien ;
 * - en veille, quelqu'un qui arrive réveille l'écran (aussi un écran de problème ou le test des
 *   touches), et l'image ne fait rien d'autre ; personne : rien ;
 * - éveillé, la présence repousse la veille ; les actions ne passent que sur la composition, hors
 *   test des touches. Ailleurs, la machine oublie les gestes commencés : rien ne part quand
 *   l'écran les accepte de nouveau.
 */
export function gestureEffect(
  state: MirrorState,
  output: Pick<GestureOutput, 'present' | 'actions' | 'hold'>,
): GestureEffect {
  if (state.status === 'loading') return { wake: false, activity: false, actions: [], disarm: true, hold: null };
  if (state.sleeping) {
    return { wake: output.present, activity: output.present, actions: [], disarm: true, hold: null };
  }
  const accepts = acceptsGestures(state);
  return {
    wake: false,
    activity: output.present || output.actions.length > 0,
    actions: accepts ? [...output.actions] : [],
    disarm: !accepts,
    hold: accepts ? output.hold : null,
  };
}

/**
 * « Oui » et « non » attendent-ils (docs/conception.md §4) ? Oui tant que la silhouette de la légende n'est pas
 * dessinée (l'ancienne est encore à l'écran : on n'enregistre jamais une tenue qu'on n'a pas vue),
 * sauf pendant un message qui cache la tenue (« Recommencer », « Touches enregistrées »), qu'ils
 * effacent seulement. `shown` n'est demandé que s'il le faut. Le même garde-fou pour les touches
 * et pour les gestes.
 */
export function confirmWaits(state: MirrorState, shown: () => boolean): boolean {
  return !messageHidesOutfit(state.message) && !shown();
}

const CONFIRM_HOLDS: readonly HoldAction[] = ['accept', 'refuse'];
const ALL_HOLDS: readonly HoldAction[] = ['accept', 'refuse', 'jacket'];

/**
 * Les gestes tenus que l'écran ne peut pas faire en ce moment :
 * - pendant un message qui cache la tenue (« Appuie encore pour recommencer », « On recommence »,
 *   « Touches enregistrées »), la légende du bas est cachée, et l'anneau avec elle : aucun geste
 *   tenu ne commence (il remplirait un anneau invisible pour effacer le message). Un défilement ou
 *   une touche l'efface ; sinon il s'en va seul ;
 * - « oui » et « non » quand ils attendent (confirmWaits) : le pouce ou le poing ne remplit pas son
 *   anneau pour rien, le maintien ne commence (ou ne reprend de zéro) qu'une fois la silhouette
 *   dessinée. Le V reste libre.
 */
export function disabledHolds(state: MirrorState, shown: () => boolean): readonly HoldAction[] {
  if (!acceptsGestures(state)) return [];
  if (messageHidesOutfit(state.message)) return ALL_HOLDS;
  return confirmWaits(state, shown) ? CONFIRM_HOLDS : [];
}

/** Même anneau à l'écran : même geste, même main, progression à moins de 1 % près. */
export function sameHold(a: HoldView | null, b: HoldView | null): boolean {
  if (!a || !b) return a === b;
  return a.action === b.action && a.side === b.side && Math.abs(a.progress - b.progress) < 0.01;
}

/** Les instants (ms) de la dernière seconde, pour compter les images/s du debug. */
export function recentTimes(times: readonly number[], now: number, windowMs = 1_000): number[] {
  return times.filter((t) => t > now - windowMs && t <= now);
}

/**
 * Images/s du debug, d'après l'intervalle moyen des images de la dernière seconde (jusqu'à
 * maintenant). Compter les images d'une fenêtre d'1 s en prend souvent une de trop : 31 au lieu de
 * 30, 11 au lieu de 10 (essai sur vidéo).
 */
export function framesPerSecond(times: readonly number[], now: number, windowMs = 1_000): number {
  const recent = recentTimes(times, now, windowMs);
  if (recent.length < 2) return recent.length;
  return Math.round(((recent.length - 1) * 1_000) / Math.max(1, now - recent[0]));
}

// --- ?gestures=debug ---------------------------------------------------------------------------

/** Dessin des zones et des mains sur noir, vu de la personne face au miroir : x écran = 1 − x caméra. */
export type DebugDrawing = {
  /** Le cadre de l'image analysée : largeur `aspect`, hauteur 1 (unités du dessin). */
  width: number;
  rects: Array<{ id: 'chest' | 'thighs'; x: number; y: number; width: number; height: number }>;
  lines: Array<{ id: 'up' | 'down' | 'waist' | 'side-left' | 'side-right'; x1: number; y1: number; x2: number; y2: number }>;
  hands: Array<{ side: HandSide; x: number; y: number; state: ArmState; raised: boolean }>;
};

/**
 * Zones et mains d'une image, dans le cadre de l'image analysée retourné comme un miroir. Les
 * coordonnées de la machine sont normalisées dans l'image brute de la caméra frontale (non
 * inversée) : sa main droite y est à gauche, elle se dessine à droite, comme son reflet.
 */
export function debugDrawing(output: Pick<GestureOutput, 'zones' | 'hands'>, aspect: number): DebugDrawing {
  const width = aspect > 0 ? aspect : 1;
  const mx = (x: number) => (1 - x) * width;
  const drawing: DebugDrawing = { width, rects: [], lines: [], hands: [] };
  const zones = output.zones;
  if (zones) {
    const span = ({ x0, x1 }: { x0: number; x1: number }) => ({ x: mx(x1), width: (x1 - x0) * width });
    drawing.rects.push({ id: 'chest', ...span(zones.chest), y: zones.chest.y0, height: zones.chest.y1 - zones.chest.y0 });
    drawing.rects.push({ id: 'thighs', ...span(zones.thighs), y: zones.downY, height: Math.max(0, 1 - zones.downY) });
    const across = (id: 'up' | 'down' | 'waist', y: number) => drawing.lines.push({ id, x1: 0, y1: y, x2: width, y2: y });
    across('up', zones.upY);
    across('down', zones.downY);
    across('waist', zones.waistY);
    // Limites des côtés, entre les lignes du haut et du bas (là où un défilement de haut peut partir).
    // sides.x0 (petits x de la caméra) est à sa droite : à droite de l'écran.
    drawing.lines.push({ id: 'side-right', x1: mx(zones.sides.x0), y1: zones.upY, x2: mx(zones.sides.x0), y2: zones.downY });
    drawing.lines.push({ id: 'side-left', x1: mx(zones.sides.x1), y1: zones.upY, x2: mx(zones.sides.x1), y2: zones.downY });
  }
  for (const side of ['left', 'right'] as const) {
    const hand = output.hands[side];
    if (hand) drawing.hands.push({ side, x: mx(hand.x), y: hand.y, state: hand.state, raised: hand.raised });
  }
  return drawing;
}

export const ARM_STATE_LABELS: Record<ArmState, string> = { rest: 'au repos', armed: 'armée', locked: 'bloquée' };

/** Ce que voit PoseLandmarker, en mots. */
export function presenceLabel(output: Pick<GestureOutput, 'present' | 'body' | 'turned'>): string {
  if (!output.present) return 'Personne';
  if (output.turned) return 'De profil : épaules confondues';
  return output.body ? 'Présente' : 'Recule : épaules et hanches mal vues';
}

const SIDE_LABELS: Record<HandSide, string> = { left: 'Gauche', right: 'Droite' };

/** « 0,42 » : un nombre du debug, au centième, à la française. */
function decimal(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

/**
 * L'état des deux mains, en mots, avec entre parenthèses le |u| le plus petit de son dernier
 * armement (armée de justesse près de CENTER_IN, ou bien au centre) : « Gauche : au repos ·
 * Droite : armée (0,17) ». « — » : main mal vue.
 */
export function handsLabel(hands: Record<HandSide, Pick<HandView, 'state' | 'armMinU'> | null>): string {
  return (['left', 'right'] as const)
    .map((side) => {
      const hand = hands[side];
      if (!hand) return `${SIDE_LABELS[side]} : —`;
      const depth = hand.armMinU === null ? '' : ` (${decimal(hand.armMinU)})`;
      return `${SIDE_LABELS[side]} : ${ARM_STATE_LABELS[hand.state]}${depth}`;
    })
    .join(' · ');
}

/** État de la caméra quand elle n'analyse pas d'image. */
export const CAMERA_DEBUG_TEXT: Record<CameraStatus, string> = {
  off: 'Caméra pas encore lancée',
  starting: 'Caméra : démarrage…',
  running: 'Caméra',
  paused: 'Caméra rendue (page cachée)',
  denied: 'Caméra refusée',
  busy: 'Caméra occupée',
  absent: 'Pas de caméra',
  failed: 'Moteur des gestes indisponible',
};

/** « Thumb_Up 0,87 » : la catégorie telle que la donne le Gesture Recognizer, et son score. */
export function recognizedLabel(recognized: { category: string; score: number }): string {
  return `${recognized.category} ${decimal(recognized.score)}`;
}

/** « haut suivant », « oui »… : le dernier geste parti, en mots. */
export function actionLabel(action: GestureAction): string {
  return KEY_ACTION_LABELS[action].toLocaleLowerCase('fr-FR');
}
