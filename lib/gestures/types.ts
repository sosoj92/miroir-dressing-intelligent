import type { KeyAction } from '@/lib/types';
import type { HOLD_GESTURES } from './constants';

// Entrées et sorties de la reconnaissance des gestes. Aucun type de MediaPipe : ce module reste pur
// et ne charge rien de MediaPipe (les résultats de MediaPipe y sont compatibles par leur forme).

/**
 * Ce que le miroir fait d'un geste : les actions des touches (lib/types), que applyAction prend
 * telles quelles. « Recommencer » n'a pas de geste.
 */
export type GestureAction = Exclude<KeyAction, 'restart'>;

/** Action d'un geste tenu. */
export type HoldAction = (typeof HOLD_GESTURES)[keyof typeof HOLD_GESTURES];

/** Main gauche ou droite de la personne filmée (repères 15/19 et 16/20 de PoseLandmarker). */
export type HandSide = 'left' | 'right';

/**
 * `rest` : au repos, rien ne peut partir.
 * `armed` : passée devant la poitrine, la prochaine sortie dans une zone d'action déclenche.
 * `locked` : après un geste tenu validé, ou quand les gestes sont oubliés (disarm : réveil, écran
 * qui n'accepte pas de geste) ; ne peut pas s'armer avant d'avoir quitté la poitrine.
 */
export type ArmState = 'rest' | 'armed' | 'locked';

/** Repère normalisé de PoseLandmarker (x, y entre 0 et 1 dans l'image analysée). */
export type PoseLandmark = { x: number; y: number; visibility?: number };

/** Une main vue par le Gesture Recognizer (sa catégorie la plus probable). */
export type RecognizedHand = {
  /** `categoryName` : « Thumb_Up », « Closed_Fist », « Victory », « None »… */
  category: string;
  score: number;
  /** Centre de la main, normalisé comme les repères de pose. */
  x: number;
  y: number;
  /**
   * « Left » ou « Right » selon MediaPipe. Pour information seulement : MediaPipe suppose une image
   * inversée, ce que n'est pas l'image brute de la caméra frontale. La main est reconnue par sa
   * position (la main du corps la plus proche).
   */
  handedness?: string;
};

/** Une image analysée. */
export type GestureFrame = {
  /** Instant de l'image, en ms (performance.now()), croissant. */
  t: number;
  /** Largeur / hauteur de l'image analysée : les x normalisés sont remis à l'échelle des y. */
  aspect: number;
  /** Les 33 repères de PoseLandmarker (`landmarks[0]`), ou null s'il ne voit personne. */
  pose: readonly PoseLandmark[] | null;
  /** Mains du Gesture Recognizer ; null quand il n'a pas tourné sur cette image ([] : aucune main). */
  hands: readonly RecognizedHand[] | null;
  /**
   * Gestes tenus que l'écran ne peut pas faire en ce moment (« oui » et « non » tant que la
   * silhouette de la légende n'est pas dessinée, docs/conception.md §4) : ils ne commencent pas, et un maintien
   * en cours s'arrête sans rien valider ; il repartira de zéro. Absent : tous possibles.
   */
  disabledHolds?: readonly HoldAction[];
};

/** Une main, pour le debug (coordonnées normalisées de l'image de la caméra, non inversée). */
export type HandView = {
  x: number;
  y: number;
  /** Position horizontale en demi-largeurs d'épaules depuis le milieu du buste ; > 0 : à sa droite. */
  u: number;
  state: ArmState;
  /** Au-dessus de la taille. */
  raised: boolean;
  /** |u| le plus petit pendant le dernier armement de cette main (null : pas encore armée). */
  armMinU: number | null;
};

/**
 * Zones, pour le debug, en coordonnées normalisées de l'image de la caméra (non inversée : pour un
 * dessin en miroir, x écran = 1 − x). `x0 < x1`, `y` croît vers le bas.
 */
export type DebugZones = {
  /** Où la main s'arme : |u| < CENTER_IN, de BAND_TOP au-dessus des épaules jusqu'à la taille. */
  chest: { x0: number; x1: number; y0: number; y1: number };
  /** Limites des côtés (|u| = SIDE_OUT). */
  sides: { x0: number; x1: number };
  /** Au-dessus : bas suivant. */
  upY: number;
  /** En dessous, devant les cuisses : bas précédent. */
  downY: number;
  /** La taille : une main au-dessus fait tourner le Gesture Recognizer. */
  waistY: number;
  /** Devant les cuisses (sous downY). */
  thighs: { x0: number; x1: number };
};

/** Maintien en cours, pour l'anneau de progression. */
export type HoldView = { action: HoldAction; side: HandSide; progress: number };

/** Ce que dit une image. */
export type GestureOutput = {
  /** Actions déclenchées par cette image (au plus une). */
  actions: GestureAction[];
  /** PoseLandmarker voit quelqu'un (ses deux épaules). */
  present: boolean;
  /** Épaules et hanches bien vues, et pas de profil : sans ça, aucun geste (« Recule »). */
  body: boolean;
  /**
   * De profil : épaules et hanches bien vues, mais la demi-largeur d'épaules est effondrée
   * (MIN_SHOULDER_RATIO). Aucun geste (body est faux).
   */
  turned: boolean;
  /** Maintien en cours (progression 0..1), null sinon ou une fois validé. */
  hold: HoldView | null;
  /** Mains vues (null : main mal vue, ou corps mal vu). */
  hands: Record<HandSide, HandView | null>;
  /** null quand le corps est mal vu. */
  zones: DebugZones | null;
  /** Ce qu'a vu le Gesture Recognizer sur cette image (la main la plus sûre), pour le debug. */
  recognized: { category: string; score: number; side: HandSide | null } | null;
};
