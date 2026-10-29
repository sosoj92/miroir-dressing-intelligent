// Seuils des gestes caméra, en un seul endroit (docs/conception.md §5 : « Les seuils sont des constantes nommées »).
//
// Méthode des zones validée en conditions réelles (essai de calibration) : ces valeurs
// sont reprises À L'IDENTIQUE et font foi. Les longueurs sont en unités du corps : « demi-largeur
// d'épaules » pour l'horizontale, « longueur de buste » (milieu des épaules → milieu des hanches)
// pour la verticale.

/** Un repère est vu s'il a au moins cette visibilité (poignet et index pour une main). */
export const MIN_VISIBILITY = 0.5;
/** Épaules ET hanches bien vues, sinon aucun geste (les deux mains reviennent au repos). */
export const BODY_VISIBILITY = 0.6;
/** Lissage des repères pour les zones : 75 % de la nouvelle image, 25 % de l'ancienne. */
export const ZONE_SMOOTHING = 0.75;

/** Devant la poitrine : |u| < CENTER_IN demi-largeur d'épaules. C'est là que la main s'arme. */
export const CENTER_IN = 0.8;
/** Sur le côté : |u| > SIDE_OUT demi-largeur d'épaules. */
export const SIDE_OUT = 1.3;
/**
 * Images devant la poitrine pour armer. Avec 1, un seul passage suffit (un balayage rapide compte) :
 * c'est le comportement de l'essai, qui armait dès la première image.
 */
export const ARM_FRAMES = 1;
/** Images de suite hors de la poitrine, dans une zone d'action, avant de déclencher. */
export const EXIT_FRAMES = 2;
/** Entre deux défilements (strict : il faut plus de 500 ms). */
export const GESTURE_COOLDOWN_MS = 500;
/**
 * Ajouté après l'essai, qui n'avait pas de limite : une main armée qui n'est pas repassée devant la
 * poitrine depuis plus d'1 s revient au repos (main levée pour autre chose, trou entre deux images).
 * Sur des journaux de gestes rejoués, la dernière image devant la poitrine précède presque toujours
 * le défilement de 0,1 à 0,9 s. Les rares cas au-delà d'1 s (deux bras levés au-dessus de la tête,
 * armés là-haut, puis redescendus en s'ouvrant ; une main sortie sous la taille longtemps après un
 * geste de l'autre main, qu'elle annulait) sont annulés par cette limite ; c'est voulu.
 */
export const ARM_TIMEOUT_MS = 1_000;
/** Limite haut / bas : 62 % de la longueur de buste sous les épaules (≈ nombril). La « taille ». */
export const WAIST = 0.62;
/**
 * La zone de la poitrine monte jusqu'à 1,2 longueur de buste au-dessus des épaules (tête comprise) :
 * c'est là qu'une main au repos s'arme. Plus haut que la ligne du haut (UP_LINE) : une main déjà
 * armée ne s'y réarme pas au-dessus de cette ligne (sinon « bas suivant » ne partirait jamais).
 */
export const BAND_TOP = 1.2;
/** Un geste doit être plus horizontal que vertical (ou l'inverse) d'un facteur 1,2. */
export const HORIZONTAL = 1.2;
/** « Au-dessus de la tête » : 0,65 longueur de buste au-dessus des épaules. */
export const UP_LINE = 0.65;
/** « Vers les cuisses » : 0,2 longueur de buste sous les hanches. */
export const DOWN_LINE = 0.2;
/** Devant les cuisses : à moins de 1,6 demi-largeur de hanches du milieu des hanches. */
export const THIGH_FRONT = 1.6;
/**
 * Ajouté après l'essai sur vidéo : de profil, les épaules se superposent dans l'image, la
 * demi-largeur d'épaules s'effondre et u explose (jusqu'à 19,9 pour une main près du corps), donc de
 * faux défilements. Une image où la demi-largeur d'épaules est sous MIN_SHOULDER_RATIO longueur de
 * buste compte comme un corps mal vu : aucun geste, mains au repos. De face, le rapport vaut 0,30 à
 * 0,35 (1 % des images sous 0,23) ; les faux défilements de l'essai partaient à 0,16 et 0,18.
 */
export const MIN_SHOULDER_RATIO = 0.2;
/**
 * Garde contre une division par zéro (épaules ou hanches confondues). L'essai prenait 1 px ; ici,
 * en hauteurs d'image, 0,001 (≈ 1 px sur 1 000).
 */
export const MIN_HALF_WIDTH = 0.001;

/** Repères de PoseLandmarker (33 points). La main = milieu poignet – index. */
export const POSE_LANDMARKS = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftIndex: 19,
  rightIndex: 20,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
} as const;

// Gestes tenus (Gesture Recognizer), décidés après l'essai.

/** Un geste tenu se valide au bout d'1 s. */
export const HOLD_MS = 1_000;
/** Après un geste tenu validé : 1,5 s sans geste tenu. */
export const HOLD_PAUSE_MS = 1_500;
/** Score minimal du Gesture Recognizer pour compter une image. */
export const HOLD_MIN_SCORE = 0.6;
/**
 * Le Gesture Recognizer tourne à 10 images/s au plus et hésite parfois une image : le maintien
 * survit à un trou de 300 ms au plus depuis la dernière image du Gesture Recognizer qui a vu le
 * geste, au-delà il est rompu. Le trou peut être une image où il ne tourne pas, une autre catégorie,
 * une image sans personne ou un corps mal vu (le maintien n'avance pas, mais n'est pas rompu). Il
 * garde l'anneau ; il ne valide jamais : le geste se valide à une image qui le voit encore, 1 s ou
 * plus après son début.
 */
export const HOLD_GRACE_MS = 300;
/** « Main à peu près immobile » : à moins d'une demi-largeur d'épaules (≈ 10 cm) de son départ. */
export const HOLD_STILL = 0.5;
/** Une main vue par le Gesture Recognizer est celle du corps la plus proche, à une demi-largeur d'épaules près. */
export const HOLD_MATCH = 1;
/** Catégories lues par `categoryName`, jamais par index (docs/conception.md §5). « Recommencer » n'a pas de geste. */
export const HOLD_GESTURES = {
  Thumb_Up: 'accept',
  Closed_Fist: 'refuse',
  Victory: 'jacket',
} as const;

// Présence et économie (GPU de la tablette pas encore mesuré).

/** Quelqu'un est là si PoseLandmarker voit ses deux épaules. */
export const PRESENCE_VISIBILITY = 0.5;
/**
 * PoseLandmarker lite perd parfois la personne une à trois images pendant un mouvement rapide. Une
 * image sans personne à moins de 300 ms de la dernière où on l'a vue ne change rien aux gestes
 * (l'essai sautait ces images) ; au-delà, mains au repos, maintien annulé, lissage oublié.
 */
export const POSE_GAP_MS = 300;
/** PoseLandmarker lite : 5 images/s quand personne… */
export const POSE_FPS_IDLE = 5;
/** … jusqu'à 30 images/s quand quelqu'un est là. */
export const POSE_FPS_PRESENT = 30;
/** Après la dernière image avec quelqu'un, on reste à 30 images/s encore 1 s (une image ratée). */
export const POSE_FAST_LINGER_MS = 1_000;
/** Gesture Recognizer : 10 images/s au plus, et seulement quand une main est levée au-dessus de la taille. */
export const RECOGNIZER_FPS_MAX = 10;
/**
 * Tolérance du rythme : à 60 Hz, deux images d'écran font 33,3 ms à quelques ms près. Sans elle,
 * une image sur deux attendrait une image de plus et 30 images/s tomberaient à 24.
 */
export const PACING_SLACK_MS = 4;
