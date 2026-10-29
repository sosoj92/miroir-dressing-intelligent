import { HOLD_GESTURES, RECOGNIZER_FPS_MAX } from './constants';
import {
  debugZones,
  handPoint,
  horizontalOf,
  isBodyVisible,
  isFacing,
  isInChest,
  isPresent,
  readSkeleton,
  smoothSkeleton,
  zonesOf,
  type Skeleton,
  type Zones,
} from './geometry';
import { DEFAULT_GESTURE_SETTINGS, type GestureSettings } from './settings';
import type {
  ArmState,
  GestureAction,
  GestureFrame,
  GestureOutput,
  HandSide,
  HandView,
  HoldAction,
  RecognizedHand,
} from './types';

// Reconnaissance des gestes : machine à états pure (docs/conception.md §5, AGENTS.md). Une image entre (repères
// de pose, mains du Gesture Recognizer), un nouvel état et ce qu'elle déclenche sortent. Rien ne lit
// l'horloge : l'instant vient de l'image.
//
// Défilements, par zones (essai de calibration, gestures()) :
// - main devant la poitrine : elle s'arme (revenir au buste ne déclenche rien, ça réarme) ;
// - depuis armée, sortie sur le côté (plus horizontale que verticale, entre les lignes du haut et du
//   bas) : à sa droite haut suivant, à sa gauche haut précédent ;
// - depuis armée, main au-dessus de la tête (plus verticale) : bas suivant ;
// - depuis armée, main devant les cuisses (plus verticale, près du milieu des hanches) : bas
//   précédent. Les bras qui retombent sur les côtés ne comptent pas ;
// - EXIT_FRAMES images de suite dans la zone d'action, et plus de 500 ms depuis le dernier
//   défilement (des deux mains). Après un défilement, la main revient au repos.
// Corrigé après le contrôle final : dans l'essai, la zone de la poitrine montait plus haut
// (BAND_TOP) que la ligne du haut (UP_LINE), donc une main levée tout droit au milieu s'y réarmait à
// chaque image et « bas suivant » ne partait jamais (aucun dans l'essai). Une main armée ne se réarme
// plus au-dessus de la ligne du haut : elle y est « au-dessus de la tête ». « Bas suivant » demande
// en plus que la main ait été armée sous la ligne des épaules pendant cet armement (devant la
// poitrine, pas devant le visage) : une main qui flotte à hauteur de la ligne ne défile qu'une fois.
// Une main au repos s'arme toujours dans toute la zone de l'essai.
// Ajouté après l'essai (vérifié en rejouant des journaux de gestes) :
// - une main armée revient au repos quand son bras retombe le long du corps (sous la taille, hors
//   de la zone des cuisses, sous la ligne du bas ou par un mouvement surtout vertical), ou quand elle
//   n'est pas repassée devant la poitrine depuis ARM_TIMEOUT_MS : un mouvement fait des secondes
//   plus tard ne part pas d'une vieille position ;
// - après un défilement, l'autre main revient au repos si elle a déjà quitté la poitrine : deux bras
//   ouverts en grand ne défilent qu'une fois. Après « bas suivant » ou « bas précédent », elle est
//   bloquée si elle est encore armée devant la poitrine (relecture) : deux mains levées
//   tout droit ensemble, l'une un peu après l'autre, ne défilent qu'une fois.
//
// Gestes tenus (Gesture Recognizer) : pouce levé = oui, poing = non, V = veste suivante, tenus 1 s,
// main à peu près immobile et levée au-dessus de la taille. Le geste se valide à une image où le
// Gesture Recognizer le voit encore, 1 s ou plus après le début : le délai de grâce garde l'anneau
// pendant une image hésitante, il ne compte jamais comme une seconde tenue. Ensuite :
// - 1,5 s sans geste tenu, et le même maintien ne compte qu'une fois (il faut le relâcher) ;
// - les deux mains sont bloquées : elles ne s'arment qu'après avoir quitté la poitrine, donc un geste
//   tenu ne déclenche jamais aussi un défilement en repartant.
// Un défilement annule le maintien en cours ; la main qui a défilé ne peut pas tenir de geste avant
// d'être revenue devant la poitrine sous la ligne du haut (pas seulement dans la zone de l'essai, qui
// monte plus haut, là où part « bas suivant »), ou sous la taille, et aucun maintien ne commence dans
// les 500 ms. De même pour l'autre main quand elle a suivi le mouvement (remise au repos ou bloquée
// par ce défilement) : deux poings levés au-dessus de la tête donnent « bas suivant », pas « non ».
//
// Sans présence, épaules et hanches mal vues, ou de profil (épaules confondues dans l'image, ajouté
// après l'essai sur vidéo) : aucune action, et les mains armées reviennent au repos (essai). Un
// maintien en cours n'avance pas, mais survit au délai de grâce (HOLD_GRACE_MS), comme à une image
// hésitante du Gesture Recognizer. Une image sans personne à moins de POSE_GAP_MS de la dernière où
// on l'a vue ne change rien : l'essai sautait ces images.
//
// disarm (réveil, écran qui n'accepte pas de geste, caméra reprise) : ce qui est commencé ne part
// jamais, même si le Gesture Recognizer ne l'a pas encore vu. Les mains sont bloquées jusqu'à ce
// qu'on les voie hors de la poitrine, et un geste tenu déjà levé ne compte qu'une fois relâché.
// Un geste tenu que l'écran ne peut pas faire (frame.disabledHolds) ne commence pas.

const SIDES: readonly HandSide[] = ['left', 'right'];

/** Intervalle entre deux images du Gesture Recognizer, au plus vite. */
const RECOGNIZER_FRAME_MS = 1_000 / RECOGNIZER_FPS_MAX;

/** L'anneau reste ouvert tant que le geste n'est pas validé : plein, il dirait « c'est fait ». */
const RING_BEFORE_FIRED = 0.95;

type HandMemory = {
  state: ArmState;
  /** Images de suite devant la poitrine (pour ARM_FRAMES). */
  inCenter: number;
  /** Images de suite dans une zone d'action, depuis armée. */
  outSide: number;
  /** Dernière position devant la poitrine : le geste se mesure depuis là. */
  anchorX: number;
  anchorY: number;
  /** Instant de la dernière image devant la poitrine (pour ARM_TIMEOUT_MS). */
  chestAt: number;
  /**
   * Armée vue sous la ligne des épaules (devant la poitrine même, pas devant le visage) depuis le
   * début de cet armement : seule une telle main peut donner « bas suivant ».
   */
  low: boolean;
  /**
   * A défilé (ou suivi le défilement de l'autre main) : pas de geste tenu avant d'être revenue
   * devant la poitrine sous la ligne du haut, ou sous la taille.
   */
  swept: boolean;
  /**
   * Bloquée par « bas suivant » ou « bas précédent » de l'autre main alors qu'elle était encore armée
   * devant la poitrine. Si elle monte au-dessus de la ligne du haut avant d'être passée sous la
   * taille ou de s'être réarmée, elle a suivi le mouvement (deux mains levées ensemble) : swept.
   * Restée devant la poitrine sous cette ligne, elle peut tenir un geste.
   */
  trailing: boolean;
  /** |u| le plus petit du dernier armement (pour le debug : armée de justesse ou bien au centre). */
  armMinU: number | null;
};

type HoldMemory = {
  action: HoldAction;
  category: string;
  side: HandSide;
  /** Début du maintien (repart de zéro si la main bouge). */
  since: number;
  /** Dernière image du Gesture Recognizer qui l'a vu. */
  lastMatchAt: number;
  anchorX: number;
  anchorY: number;
  /** Déjà validé (ou neutralisé par disarm) : il reste tant qu'on le tient, sans compter. */
  fired: boolean;
};

/** État de la machine (données seulement, à garder d'une image à l'autre). */
export type GestureState = {
  readonly settings: GestureSettings;
  /** Repères lissés pour les zones (espace des zones), null quand personne n'est vu. */
  readonly skeleton: Skeleton | null;
  readonly hands: Readonly<Record<HandSide, Readonly<HandMemory>>>;
  readonly hold: Readonly<HoldMemory> | null;
  /**
   * Posé par disarm : un maintien qui commence ne compte pas (il est créé déjà validé, et ne
   * s'efface qu'une fois relâché). Tombe à la première image, corps bien vu, sans geste tenu sur
   * une main levée : aucune main levée, ou le Gesture Recognizer n'y voit ni pouce, ni poing, ni V.
   */
  readonly holdBlocked: boolean;
  readonly lastScrollAt: number;
  readonly lastHoldAt: number;
  /** Instant de la dernière image analysée (PoseLandmarker a tourné). */
  readonly lastPoseAt: number;
  /** Instant de la dernière image où le Gesture Recognizer a tourné. */
  readonly lastRecognizerAt: number;
  /** Instant de la dernière image avec quelqu'un. */
  readonly lastSeenAt: number;
  readonly present: boolean;
  readonly body: boolean;
  /** Une main vue au-dessus de la taille (corps bien vu), à la dernière image. */
  readonly raised: boolean;
};

const REST_HAND: HandMemory = {
  state: 'rest',
  inCenter: 0,
  outSide: 0,
  anchorX: 0,
  anchorY: 0,
  chestAt: Number.NEGATIVE_INFINITY,
  low: false,
  swept: false,
  trailing: false,
  armMinU: null,
};

/** État de départ. `settings` : seuils à changer (sensibilité, tests) ; les autres restent ceux par défaut. */
export function createGestureState(settings: Partial<GestureSettings> = {}): GestureState {
  return {
    settings: { ...DEFAULT_GESTURE_SETTINGS, ...settings },
    skeleton: null,
    hands: { left: REST_HAND, right: REST_HAND },
    hold: null,
    holdBlocked: false,
    lastScrollAt: Number.NEGATIVE_INFINITY,
    lastHoldAt: Number.NEGATIVE_INFINITY,
    lastPoseAt: Number.NEGATIVE_INFINITY,
    lastRecognizerAt: Number.NEGATIVE_INFINITY,
    lastSeenAt: Number.NEGATIVE_INFINITY,
    present: false,
    body: false,
    raised: false,
  };
}

/** Main remise au repos ; une main bloquée le reste (elle n'a pas été vue quitter la poitrine). */
function toRest(hand: HandMemory): HandMemory {
  return { ...hand, state: hand.state === 'locked' ? 'locked' : 'rest', inCenter: 0, outSide: 0 };
}

/** Main bloquée : elle ne s'arme qu'après avoir été vue hors de la poitrine. */
function toLocked(hand: HandMemory): HandMemory {
  return { ...hand, state: 'locked', inCenter: 0, outSide: 0, trailing: false };
}

/**
 * Oublie les gestes commencés, jusqu'à ce qu'ils soient relâchés (docs/conception.md §4 : « un pouce déjà levé
 * ne compte pas : il faut le relâcher ») :
 * - les deux mains sont bloquées : une main déjà devant la poitrine ne s'arme qu'après l'avoir
 *   quittée, une main ailleurs se débloque dès l'image suivante ;
 * - un maintien en cours ne comptera pas : il reste tant que le geste est tenu, puis s'efface quand
 *   la main le relâche (délai de grâce) ;
 * - un maintien que le Gesture Recognizer n'a pas encore vu (il ne tourne qu'une fois une main vue
 *   levée) ne comptera pas non plus : holdBlocked.
 * Pour le miroir : réveil, veille, écrans qui n'acceptent pas de geste, caméra reprise. L'image ou
 * la touche qui réveille ne fait rien d'autre. La présence et le rythme ne changent pas.
 */
export function disarm(state: GestureState): GestureState {
  return {
    ...state,
    hands: { left: toLocked(state.hands.left), right: toLocked(state.hands.right) },
    hold: state.hold ? { ...state.hold, fired: true } : null,
    holdBlocked: true,
  };
}

type Point = { x: number; y: number };

/**
 * Action de zone d'une main armée sortie de la poitrine (essai : gestures()), ou null. `low` : armée
 * sous la ligne des épaules (seule condition ajoutée à l'essai, pour « bas suivant »).
 */
function zoneAction(
  point: Point,
  anchor: Point,
  low: boolean,
  u: number,
  zones: Zones,
  settings: GestureSettings,
): GestureAction | null {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const k = settings.horizontal;
  if (Math.abs(u) > settings.sideOut && Math.abs(dx) > k * Math.abs(dy) && point.y > zones.up && point.y < zones.down) {
    return u > 0 ? 'next' : 'previous';
  }
  if (low && point.y < zones.up && Math.abs(dy) > k * Math.abs(dx)) return 'bottomNext';
  if (
    point.y > zones.down &&
    Math.abs(dy) > k * Math.abs(dx) &&
    Math.abs(point.x - zones.hipsX) < settings.thighFront * zones.hipsHalf
  ) {
    return 'bottomPrevious';
  }
  return null;
}

/** Une main, une image : armement, sortie, défilement. */
function stepHand(
  memory: HandMemory,
  point: Point | null,
  zones: Zones,
  settings: GestureSettings,
  now: number,
  lastScrollAt: number,
): { hand: HandMemory; action: GestureAction | null } {
  // Main mal vue : au repos, comme l'essai.
  if (!point) return { hand: toRest(memory), action: null };
  const inChest = isInChest(point, zones, settings);
  const hand: HandMemory = { ...memory };
  // Revenue devant la poitrine (sous la ligne du haut : la zone de l'essai monte plus haut, là où
  // « bas suivant » vient de partir) ou sous la taille : elle peut de nouveau tenir un geste.
  if ((inChest && point.y >= zones.up) || point.y >= zones.waist) hand.swept = false;
  // Bloquée par « bas suivant » de l'autre main, puis montée au-dessus de la ligne du haut (tout
  // droit ou en s'écartant) : elle a suivi le mouvement, pas de geste tenu là-haut (deux poings
  // levés ensemble : « bas suivant » seulement). Oublié sous la taille, ou à un nouvel armement.
  if (point.y >= zones.waist) hand.trailing = false;
  if (hand.trailing && point.y < zones.up) hand.swept = true;

  if (hand.state === 'locked') {
    // Bloquée après un geste tenu : elle se débloque en quittant la poitrine, au repos (pas armée).
    if (!inChest) hand.state = 'rest';
    hand.inCenter = 0;
    hand.outSide = 0;
    return { hand, action: null };
  }
  // Une main armée au-dessus de la ligne du haut n'est plus devant la poitrine, même si la zone de
  // l'essai monte plus haut : elle ne s'y réarme pas, c'est « bas suivant » qui se joue.
  const rearms = inChest && !(hand.state === 'armed' && point.y < zones.up);
  if (rearms) {
    hand.inCenter += 1;
    hand.outSide = 0;
    hand.anchorX = point.x;
    hand.anchorY = point.y;
    hand.chestAt = now;
    const u = Math.abs(horizontalOf(point.x, zones));
    // Un nouvel armement repart de sa première image devant la poitrine ; revenir devant la poitrine
    // sans avoir défilé, c'est le même armement.
    const fresh = hand.state !== 'armed' && hand.inCenter === 1;
    if (fresh) hand.trailing = false;
    hand.armMinU = fresh || hand.armMinU === null ? u : Math.min(hand.armMinU, u);
    const low = point.y >= zones.shoulderY;
    hand.low = fresh ? low : hand.low || low;
    if (hand.inCenter >= settings.armFrames) hand.state = 'armed';
    return { hand, action: null };
  }
  hand.inCenter = 0;
  if (hand.state !== 'armed') return { hand, action: null };
  if (now - hand.chestAt > settings.armTimeoutMs) {
    // Pas repassée devant la poitrine depuis trop longtemps (ou trou entre deux images) : au repos,
    // avant de regarder les zones, pour que rien ne parte d'une vieille position de départ.
    hand.state = 'rest';
    hand.outSide = 0;
    return { hand, action: null };
  }

  const anchor = { x: hand.anchorX, y: hand.anchorY };
  const action = zoneAction(point, anchor, hand.low, horizontalOf(point.x, zones), zones, settings);
  if (!action) {
    hand.outSide = 0;
    // Bras retombé le long du corps (sous la taille, hors de la zone des cuisses) : au repos. Le
    // chemin vers les cuisses (bas précédent) passe devant elles : il n'est pas concerné. Un
    // défilement sur le côté commencé à hauteur du nombril peut passer sous la taille en sortant :
    // seul un bras qui retombe (sous la ligne du bas, ou mouvement surtout vertical) revient au repos.
    const dx = Math.abs(point.x - anchor.x);
    const dy = Math.abs(point.y - anchor.y);
    if (
      point.y >= zones.waist &&
      Math.abs(point.x - zones.hipsX) >= settings.thighFront * zones.hipsHalf &&
      (point.y > zones.down || dy > settings.horizontal * dx)
    ) {
      hand.state = 'rest';
    }
    return { hand, action: null };
  }
  hand.outSide += 1;
  if (hand.outSide < settings.exitFrames || now - lastScrollAt <= settings.cooldownMs) return { hand, action: null };
  hand.state = 'rest';
  hand.outSide = 0;
  return { hand, action };
}

type Candidate = { hand: RecognizedHand; side: HandSide | null };

/** Chaque main du Gesture Recognizer, rattachée à la main du corps la plus proche (ou à aucune). */
function matchHands(
  hands: readonly RecognizedHand[],
  points: Record<HandSide, Point | null>,
  zones: Zones,
  aspect: number,
  settings: GestureSettings,
): Candidate[] {
  const radius = settings.holdMatch * zones.half;
  return hands.map((hand) => {
    let side: HandSide | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const s of SIDES) {
      const p = points[s];
      if (!p) continue;
      const d = Math.hypot(hand.x * aspect - p.x, hand.y - p.y);
      if (d <= radius && d < best) {
        best = d;
        side = s;
      }
    }
    return { hand, side };
  });
}

function holdActionOf(category: string): HoldAction | null {
  return Object.hasOwn(HOLD_GESTURES, category) ? HOLD_GESTURES[category as keyof typeof HOLD_GESTURES] : null;
}

function bestRecognized(candidates: readonly Candidate[]): GestureOutput['recognized'] {
  let best: Candidate | null = null;
  for (const c of candidates) if (!best || c.hand.score > best.hand.score) best = c;
  return best ? { category: best.hand.category, score: best.hand.score, side: best.side } : null;
}

/** Une image : nouvel état, et ce qu'elle déclenche. */
export function stepGestures(state: GestureState, frame: GestureFrame): { state: GestureState; output: GestureOutput } {
  const settings = state.settings;
  const now = frame.t;
  const raw = frame.pose ? readSkeleton(frame.pose, frame.aspect) : null;
  const seen = raw ? smoothSkeleton(state.skeleton, raw, settings.zoneSmoothing) : null;
  // Personne sur cette image, mais vue il y a peu : PoseLandmarker l'a perdue un instant.
  const gap = !raw && now - state.lastSeenAt <= settings.poseGapMs;
  // Personne depuis plus longtemps : le lissage est oublié, sinon son retour serait mélangé à sa
  // position d'avant. Pendant un trou, il est gardé (comme l'essai).
  const skeleton = seen ?? (gap ? state.skeleton : null);
  const present = seen !== null && isPresent(seen, settings);
  const visible = seen !== null && present && isBodyVisible(seen, settings);
  const seenZones = seen !== null && visible ? zonesOf(seen, settings) : null;
  // De profil : épaules et hanches bien vues, mais confondues dans l'image. Comme un corps mal vu.
  const turned = seenZones !== null && !isFacing(seenZones, settings);
  const zones = turned ? null : seenZones;
  const body = zones !== null;

  const hands: Record<HandSide, HandMemory> = { left: { ...state.hands.left }, right: { ...state.hands.right } };
  let hold: HoldMemory | null = state.hold ? { ...state.hold } : null;
  let holdBlocked = state.holdBlocked;
  const disabled = new Set<HoldAction>(frame.disabledHolds ?? []);
  let lastScrollAt = state.lastScrollAt;
  let lastHoldAt = state.lastHoldAt;
  const actions: GestureAction[] = [];
  const views: Record<HandSide, HandView | null> = { left: null, right: null };
  let zonesView: GestureOutput['zones'] = null;
  let raised = false;
  let recognized: GestureOutput['recognized'] = null;

  if (!seen || !zones) {
    // Aucune action. Un maintien en cours n'avance pas, mais survit au délai de grâce.
    if (hold && now - hold.lastMatchAt > settings.holdGraceMs) hold = null;
    if (!seen && !gap) {
      // Personne depuis plus de POSE_GAP_MS : tout est oublié.
      for (const side of SIDES) hands[side] = toRest(hands[side]);
      hold = null;
    } else if (seen) {
      // Corps mal vu (ou de profil) : les mains armées reviennent au repos (essai).
      for (const side of SIDES) hands[side] = toRest(hands[side]);
    }
    if (frame.hands) recognized = bestRecognized(frame.hands.map((hand) => ({ hand, side: null })));
  } else {
    zonesView = debugZones(zones, frame.aspect, settings);
    const points: Record<HandSide, Point | null> = {
      left: handPoint(seen, 'left', settings),
      right: handPoint(seen, 'right', settings),
    };
    const isRaised = (side: HandSide) => {
      const p = points[side];
      return p !== null && p.y < zones.waist;
    };

    // Défilements, main gauche puis main droite (le délai entre défilements vaut pour les deux, donc
    // une seule peut défiler par image).
    let scroller: HandSide | null = null;
    let scroll: GestureAction | null = null;
    for (const side of SIDES) {
      const { hand, action } = stepHand(hands[side], points[side], zones, settings, now, lastScrollAt);
      hands[side] = hand;
      if (action) {
        actions.push(action);
        lastScrollAt = now;
        hand.swept = true;
        scroller = side;
        scroll = action;
      }
    }
    if (scroller) {
      // L'autre main, si elle a déjà quitté la poitrine, revient au repos : sinon elle défilerait à
      // son tour après le délai (deux bras ouverts en grand : deux changements qui s'annulent).
      // Après « bas suivant » ou « bas précédent », encore armée devant la poitrine, elle est
      // bloquée : deux mains levées ensemble tout droit, l'une un peu après l'autre, ne défilent
      // qu'une fois (la seconde est encore dans la zone de la poitrine, qui monte au-dessus de la
      // ligne du haut). Bloquée, elle doit sortir de cette zone (|u| ≥ 0,8, ou sous la taille) avant
      // de se réarmer, comme après un geste tenu ; si elle monte ensuite au-dessus de la ligne du
      // haut, elle a suivi le mouvement (trailing). Remise au repos hors de la poitrine, elle l'a suivi
      // aussi. Dans ces deux cas, comme la main qui a défilé, pas de geste tenu avant d'être revenue
      // devant la poitrine sous la ligne du haut, ou sous la taille (deux poings levés : « bas
      // suivant » seulement, pas « non »). Restée devant la poitrine, elle peut tenir un geste ; après
      // un défilement sur le côté, elle y reste armée.
      const other: HandSide = scroller === 'left' ? 'right' : 'left';
      const hand = hands[other];
      if (hand.state === 'armed' && hand.inCenter === 0) {
        hands[other] = { ...hand, state: 'rest', outSide: 0, swept: true };
      } else if (hand.state === 'armed' && (scroll === 'bottomNext' || scroll === 'bottomPrevious')) {
        hands[other] = { ...toLocked(hand), trailing: true };
      }
    }
    const scrolled = scroller !== null;
    raised = SIDES.some(isRaised);

    // Gestes tenus.
    const candidates = frame.hands ? matchHands(frame.hands, points, zones, frame.aspect, settings) : [];
    if (frame.hands) recognized = bestRecognized(candidates);
    /** Un pouce, un poing ou un V sur une main levée du corps. */
    const showsHold = (c: Candidate): c is Candidate & { side: HandSide } =>
      c.side !== null &&
      c.hand.score >= settings.holdMinScore &&
      holdActionOf(c.hand.category) !== null &&
      isRaised(c.side);
    /** Peut tenir le maintien en cours (un maintien déjà validé reste tant qu'on le tient). */
    const holdable = (c: Candidate): c is Candidate & { side: HandSide } => showsHold(c) && !hands[c.side].swept;
    /** Peut commencer un maintien. */
    const eligible = (c: Candidate): c is Candidate & { side: HandSide } =>
      holdable(c) && !disabled.has(holdActionOf(c.hand.category) as HoldAction);

    // Après disarm : relâché quand aucune main n'est levée, ou que le Gesture Recognizer n'y voit
    // plus de geste tenu. Une image où il n'a pas tourné ne dit rien.
    if (holdBlocked && (!raised || (frame.hands && !candidates.some(showsHold)))) holdBlocked = false;

    if (scrolled) hold = null;
    // Geste que l'écran ne peut pas faire maintenant : le maintien s'arrête sans rien valider
    // (l'anneau disparaît) ; il repartira de zéro. Un maintien déjà validé reste, jusqu'au relâchement.
    if (hold && !hold.fired && disabled.has(hold.action)) hold = null;
    if (hold) {
      // Main redescendue sous la taille : le maintien est rompu. Main pas vue une image : le délai de
      // grâce décide (elle ne peut plus être rattachée au Gesture Recognizer).
      const p = points[hold.side];
      if (p && p.y >= zones.waist) hold = null;
    }
    if (hold && frame.hands) {
      const current = hold;
      if (candidates.some((c) => holdable(c) && c.side === current.side && c.hand.category === current.category)) {
        hold.lastMatchAt = now;
      }
    }
    if (hold && now - hold.lastMatchAt > settings.holdGraceMs) hold = null;
    const holdPoint = hold ? points[hold.side] : null;
    if (
      hold &&
      holdPoint &&
      Math.hypot(holdPoint.x - hold.anchorX, holdPoint.y - hold.anchorY) > settings.holdStill * zones.half
    ) {
      // La main a bougé : le maintien repart de zéro, d'ici.
      hold.since = now;
      hold.anchorX = holdPoint.x;
      hold.anchorY = holdPoint.y;
    }
    if (!hold && !scrolled && now - lastHoldAt >= settings.holdPauseMs && now - lastScrollAt > settings.cooldownMs) {
      let start: (Candidate & { side: HandSide }) | null = null;
      for (const c of candidates) if (eligible(c) && (!start || c.hand.score > start.hand.score)) start = c;
      if (start) {
        const p = points[start.side] as Point;
        hold = {
          action: holdActionOf(start.hand.category) as HoldAction,
          category: start.hand.category,
          side: start.side,
          since: now,
          lastMatchAt: now,
          anchorX: p.x,
          anchorY: p.y,
          // Déjà levé au moment de disarm : il reste, sans compter, jusqu'à ce qu'il soit relâché.
          fired: holdBlocked,
        };
      }
    }
    // Validé à une image où le Gesture Recognizer voit encore le geste, 1 s ou plus après le début :
    // un geste relâché pendant le délai de grâce ne compte pas (l'anneau s'arrête, voir holdView).
    if (hold && !hold.fired && hold.lastMatchAt - hold.since >= settings.holdMs) {
      actions.push(hold.action);
      hold.fired = true;
      lastHoldAt = now;
      // Les deux mains sont bloquées : rien ne part quand la main redescend.
      for (const side of SIDES) hands[side] = toLocked(hands[side]);
    }

    for (const side of SIDES) {
      const p = points[side];
      if (!p) continue;
      views[side] = {
        x: p.x / frame.aspect,
        y: p.y,
        u: horizontalOf(p.x, zones),
        state: hands[side].state,
        raised: isRaised(side),
        armMinU: hands[side].armMinU,
      };
    }
  }

  // Un maintien qui survit à un trou reste affiché (l'anneau ne clignote pas) ; il ne peut se valider
  // qu'à une image où le corps est bien vu. L'anneau suit le temps, mais pas plus d'une image du
  // Gesture Recognizer au-delà de la dernière qui a vu le geste : relâché, il s'arrête (puis s'efface
  // au délai de grâce) au lieu de se remplir pour rien. Il ne se ferme jamais avant la validation
  // (qui le fait disparaître à la même image) : relâché à 0,9-1 s, il serait plein sans « oui ».
  const holdView =
    hold && !hold.fired
      ? {
          action: hold.action,
          side: hold.side,
          progress: Math.min(
            RING_BEFORE_FIRED,
            Math.max(0, Math.min(now - hold.since, hold.lastMatchAt - hold.since + RECOGNIZER_FRAME_MS) / settings.holdMs),
          ),
        }
      : null;

  return {
    state: {
      settings,
      skeleton,
      hands,
      hold,
      holdBlocked,
      lastScrollAt,
      lastHoldAt,
      lastPoseAt: now,
      lastRecognizerAt: frame.hands ? now : state.lastRecognizerAt,
      lastSeenAt: present ? now : state.lastSeenAt,
      present,
      body,
      raised,
    },
    output: { actions, present, body, turned, hold: holdView, hands: views, zones: zonesView, recognized },
  };
}
