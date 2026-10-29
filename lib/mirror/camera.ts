// Caméra du miroir (docs/conception.md §5) : états et lignes affichées. Fonctions pures, sans DOM ni MediaPipe.

import { errorReloadDelay } from './timing';

/**
 * Ce qui empêche les gestes :
 * - `denied` : caméra refusée (autorisation) ;
 * - `busy` : occupée par une autre appli (visio, assistant vocal…) ;
 * - `absent` : pas de caméra (ou navigateur sans caméra) ;
 * - `failed` : le moteur des gestes (MediaPipe) n'a pas pu se charger ou tourner.
 */
export type CameraProblem = 'denied' | 'busy' | 'absent' | 'failed';

/**
 * `off` : pas encore lancée (pendant « Chargement… ») ; `starting` : ouverture de la caméra et
 * chargement du moteur ; `running` : les images sont analysées ; `paused` : page cachée, caméra
 * rendue.
 */
export type CameraStatus = 'off' | 'starting' | 'running' | 'paused' | CameraProblem;

/** Nouvel essai d'ouvrir la caméra (refusée, occupée, absente). */
export const CAMERA_RETRY_MS = 30_000;

/**
 * Délai avant le nouvel essai. Caméra refusée, occupée ou absente : 30 s (getUserMedia seul, sans
 * MediaPipe). Moteur des gestes en échec : comme l'écran de secours (docs/conception.md §8), 30 s, puis 2 min,
 * puis toutes les 10 min, car chaque essai recharge et recompile tout le moteur ; `failures` :
 * échecs du moteur de suite, celui-ci compris (le compte repart de zéro après ENGINE_STABLE_MS de
 * marche sans panne).
 */
export function cameraRetryDelay(problem: CameraProblem, failures: number): number {
  return problem === 'failed' ? errorReloadDelay(failures - 1) : CAMERA_RETRY_MS;
}

/**
 * Le moteur des gestes est jugé réparé après 5 min de marche sans panne (pas dès la première image :
 * un moteur qui repart puis retombe ne doit pas revenir aux essais toutes les 30 s, qui bloquent la
 * page 2 à 3,5 s chacun, justement quand quelqu'un est devant le miroir).
 */
export const ENGINE_STABLE_MS = 5 * 60_000;

/** Le compte des échecs du moteur, après une image analysée ; `runningSince` : première image depuis le dernier échec. */
export function engineFailuresAfterFrame(failures: number, runningSince: number, now: number): number {
  return now - runningSince >= ENGINE_STABLE_MS ? 0 : failures;
}

// --- Vidéo figée (chien de garde) ---------------------------------------------------------------

/**
 * La caméra « tourne », mais la vidéo ne donne plus d'image depuis 5 s : sur Android, une autre appli
 * qui prend la caméra rend souvent la piste muette au lieu de la terminer, et une vidéo hors de la
 * page peut cesser de produire des images (économies d'énergie). Rien ne serait analysé, sans aucune
 * ligne : une panne passerait pour un geste raté. On rouvre la caméra.
 */
export const CAMERA_STALL_MS = 5_000;
/** Trois blocages de suite (moins d'une minute entre deux) : la ligne du miroir le dit. */
export const CAMERA_STALL_LIMIT = 3;
export const CAMERA_STALL_WINDOW_MS = 60_000;
/**
 * Plus d'une seconde entre deux images d'écran : la page a été gelée (ou l'horloge a sauté), ce
 * n'est pas la vidéo qui est figée. Le chien de garde repart de cet instant.
 */
export const CAMERA_PAGE_GAP_MS = 1_000;

/** Blocages de suite, celui-ci compris : un blocage plus d'une minute après le précédent repart à 1. */
export function stallsInARow(previous: { count: number; at: number } | null, now: number): number {
  return previous && now - previous.at < CAMERA_STALL_WINDOW_MS ? previous.count + 1 : 1;
}

/** Après CAMERA_STALL_LIMIT blocages : piste muette, la caméra est prise ailleurs ; sinon, les gestes ne tournent pas. */
export function stallProblem(muted: boolean): CameraProblem {
  return muted ? 'busy' : 'failed';
}

/**
 * Erreur de getUserMedia → problème, par son nom (DOMException). Une erreur inconnue compte comme
 * « pas de caméra » : rien ne s'affiche, le clavier marche, on réessaiera.
 */
export function cameraProblemOf(error: unknown): Exclude<CameraProblem, 'failed'> {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy';
    default:
      // NotFoundError, OverconstrainedError, NotSupportedError (Chromium sans caméra)…
      return 'absent';
  }
}

/**
 * La seule ligne que le miroir affiche pour la caméra : quand les gestes ne marchent pas et qu'elle
 * ne le verrait pas autrement. Les bras sont la seule commande de la tablette (pas de manette) : un
 * moteur en panne ne doit pas passer pour un geste raté. Pas de caméra : rien (PC, tests).
 */
export const CAMERA_LINES = {
  denied: 'Caméra refusée : gestes coupés.',
  busy: 'Caméra occupée par une autre appli.',
  failed: "Gestes indisponibles pour l'instant.",
} as const satisfies Partial<Record<CameraStatus, string>>;

export function cameraLine(status: CameraStatus): string | null {
  return status === 'denied' || status === 'busy' || status === 'failed' ? CAMERA_LINES[status] : null;
}

export function isCameraProblem(status: CameraStatus): status is CameraProblem {
  return status === 'denied' || status === 'busy' || status === 'absent' || status === 'failed';
}

/**
 * Faut-il réessayer d'ouvrir la caméra dans CAMERA_RETRY_MS ? Toujours, sauf une demande
 * d'autorisation écartée (refus alors que le navigateur demanderait encore) : un nouvel essai la
 * rouvrirait toutes les 30 s ; on attend que l'autorisation change.
 */
export function shouldRetryCamera(problem: CameraProblem, permission: PermissionState | null): boolean {
  return !(problem === 'denied' && permission === 'prompt');
}

// --- Délégué de MediaPipe (essai sur vidéo) ---------------------------------------------

/** Où tourne MediaPipe : le GPU (WebGL) d'abord, le CPU en secours. */
export type Delegate = 'GPU' | 'CPU';

/**
 * Moteurs WebGL logiciels (SwiftShader de Chromium, llvmpipe de Mesa, WARP de Windows) : le délégué
 * GPU y « marche », mais rame. Mesuré sur le PC, même vidéo : GPU sur SwiftShader 2,2 images/s,
 * CPU 16,6, vrai GPU 35,6.
 */
const SOFTWARE_RENDERER = /SwiftShader|llvmpipe|softpipe|software|Basic Render/i;

/**
 * Délégué de départ, d'après le nom du moteur WebGL (`UNMASKED_RENDERER_WEBGL`) : le CPU sans
 * WebGL (null) ou sur un moteur logiciel ; sinon le GPU.
 */
export function initialDelegate(renderer: string | null): Delegate {
  return renderer === null || SOFTWARE_RENDERER.test(renderer) ? 'CPU' : 'GPU';
}

/** Les premières images analysées sur le GPU avec quelqu'un devant sont chronométrées… */
export const GPU_PROBE_FRAMES = 15;
/**
 * … et au-delà de 40 ms par image en médiane pour PoseLandmarker (moins de 25 images/s), on passe au
 * CPU, une fois pour toutes (jusqu'au prochain chargement de la page, même après un échec du moteur
 * sur le CPU). Seuil tiré du PC (vrai GPU 6,5 ms, CPU 17,6, SwiftShader 77) **[À mesurer]** : sur
 * la tablette, le CPU pourrait être plus lent qu'un GPU « lent ».
 */
export const GPU_SLOW_MS = 40;

/** Le GPU est-il trop lent, d'après les durées (ms) de PoseLandmarker sur les premières images ? */
export function gpuTooSlow(poseMs: readonly number[]): boolean {
  if (poseMs.length < GPU_PROBE_FRAMES) return false;
  const sorted = [...poseMs].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  return median > GPU_SLOW_MS;
}
