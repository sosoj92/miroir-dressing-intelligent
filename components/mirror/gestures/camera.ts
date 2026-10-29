import type { GestureRecognizer, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  cameraPacing,
  createGestureState,
  disarm,
  recognizedHands,
  stepGestures,
  type GestureOutput,
  type GestureState,
  type HoldAction,
  type PoseLandmark,
  type RecognizedHand,
} from '@/lib/gestures';
import {
  CAMERA_PAGE_GAP_MS,
  CAMERA_STALL_LIMIT,
  CAMERA_STALL_MS,
  GPU_PROBE_FRAMES,
  cameraProblemOf,
  cameraRetryDelay,
  engineFailuresAfterFrame,
  gpuTooSlow,
  initialDelegate,
  isCameraProblem,
  shouldRetryCamera,
  stallProblem,
  stallsInARow,
  type CameraProblem,
  type CameraStatus,
  type Delegate,
} from '@/lib/mirror/camera';
import { framesPerSecond, recentTimes } from '@/lib/mirror/gestures';

// Caméra frontale et MediaPipe, dans le navigateur de la tablette (docs/conception.md §5, §9). L'image de la
// caméra ne quitte jamais l'appareil : elle n'est ni envoyée, ni enregistrée, ni affichée. La vidéo
// n'est pas dans la page ; MediaPipe n'en tire que des repères (corps, mains), donnés à la machine à
// gestes (lib/gestures). Une seule caméra à la fois (startGestureCamera arrête la précédente),
// rendue quand la page est cachée et reprise à son retour.
//
// Rythme (cameraPacing) : PoseLandmarker lite à 5 images/s sans personne, jusqu'à 30 avec quelqu'un ;
// Gesture Recognizer seulement main levée, à 10 images/s au plus, sur la même image. L'analyse part
// juste après le dessin de l'image d'écran (requestAnimationFrame puis un message) : elle ne retarde
// pas l'affichage d'une nouvelle silhouette.
//
// Délégué : le GPU, sauf sur un moteur WebGL logiciel (le CPU d'emblée), puis le CPU si le GPU échoue
// ou s'il est trop lent sur les premières images (gpuTooSlow), et ce jusqu'au prochain chargement de
// la page. Le premier appel de chaque modèle bloque la page (2,2 à 2,5 s pour PoseLandmarker, 1,2 s
// pour le Gesture Recognizer sur le PC) : il se fait au chargement, sur une image noire, et non sur
// la première image ou au premier bras levé.
//
// Chien de garde : une vidéo qui ne donne plus d'image (piste muette, vidéo hors de la page mise en
// pause par le navigateur) alors que la caméra « tourne » est rouverte au bout de CAMERA_STALL_MS ;
// après CAMERA_STALL_LIMIT blocages de suite, la ligne du miroir le dit. Une caméra ouverte qui ne
// donne aucune première image (play() en attente) est signalée de même au bout de CAMERA_STALL_MS.
// Pendant un nouvel essai, la ligne reste jusqu'à ce que la vidéo avance vraiment.

/** Moteur et modèles servis par l'app elle-même (scripts/mediapipe-assets.mjs, au predev et au prebuild) : aucun CDN. */
const WASM_PATH = '/mediapipe/wasm';
const POSE_MODEL = '/mediapipe/models/pose_landmarker_lite.task';
const GESTURE_MODEL = '/mediapipe/models/gesture_recognizer.task';

/** ~640×480 suffit aux repères ; jamais de son. */
const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
};

export type { Delegate };

type Vision = {
  pose: PoseLandmarker;
  recognizer: GestureRecognizer;
  delegate: Delegate;
  /** GPU : durées (ms) de PoseLandmarker sur les premières images avec quelqu'un ; null une fois jugé. */
  probe: number[] | null;
};

/** Une image analysée. */
export type CameraFrame = {
  output: GestureOutput;
  /** performance.now() de l'image (même horloge que event.timeStamp). */
  t: number;
  /** Largeur / hauteur de l'image analysée. */
  aspect: number;
  delegate: Delegate;
  /** Images analysées par PoseLandmarker et par le Gesture Recognizer pendant la dernière seconde. */
  poseFps: number;
  recognizerFps: number;
};

export type CameraState = { status: CameraStatus; delegate: Delegate | null };

export type GestureCameraHandlers = {
  onFrame(frame: CameraFrame): void;
  onStatus(state: CameraState): void;
  /**
   * Les gestes tenus que l'écran ne peut pas faire en ce moment (« oui » et « non » tant que la
   * silhouette de la légende n'est pas dessinée) : ils ne commencent pas. Lu à chaque image où le
   * Gesture Recognizer tourne ou qu'un maintien est en cours.
   */
  disabledHolds?(): readonly HoldAction[];
};

export type GestureCamera = {
  stop(): void;
  /**
   * Oublie les gestes commencés jusqu'à ce qu'ils soient relâchés (veille, réveil, écran qui
   * n'accepte pas les gestes) : un pouce déjà levé ou une main déjà devant la poitrine ne fait rien.
   */
  disarm(): void;
};

/** Le préchauffage attend un moment où la page n'a rien à faire, 1 s au plus. */
const WARM_UP_IDLE_MS = 1_000;
/** L'image noire du préchauffage a la taille de l'image de la caméra. */
const WARM_UP_WIDTH = 640;
const WARM_UP_HEIGHT = 480;

/** Attend que la page soit libre (les photos de la première tenue passent avant), 1 s au plus. */
function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: WARM_UP_IDLE_MS });
    else setTimeout(resolve, 0);
  });
}

/**
 * Premier appel de chaque modèle, sur une image noire (aucune image de la caméra) : c'est lui qui
 * bloque la page le plus longtemps. Fait ici, avant « running », il ne tombe ni sur la première image
 * analysée ni au premier bras levé. Une erreur ici fait passer au CPU, comme au chargement.
 */
async function warmUp(pose: PoseLandmarker, recognizer: GestureRecognizer) {
  const canvas = document.createElement('canvas');
  canvas.width = WARM_UP_WIDTH;
  canvas.height = WARM_UP_HEIGHT;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#000';
    context.fillRect(0, 0, WARM_UP_WIDTH, WARM_UP_HEIGHT);
  }
  // Deux longues tâches séparées, chacune quand la page est libre.
  await idle();
  pose.detectForVideo(canvas, performance.now());
  await idle();
  recognizer.recognizeForVideo(canvas, performance.now());
}

async function createVision(delegate: Delegate): Promise<Vision> {
  // Import dynamique : rien de MediaPipe au rendu serveur, ni avant que la caméra soit ouverte.
  const { FilesetResolver, GestureRecognizer, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const pose = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: POSE_MODEL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  let recognizer: GestureRecognizer | null = null;
  try {
    recognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: GESTURE_MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
    });
    await warmUp(pose, recognizer);
    return { pose, recognizer, delegate, probe: delegate === 'GPU' ? [] : null };
  } catch (error) {
    closeTasks([pose, recognizer]);
    throw error;
  }
}

function closeTasks(tasks: ReadonlyArray<{ close(): void } | null>) {
  for (const task of tasks) {
    try {
      task?.close();
    } catch {
      // Contexte GPU perdu : rien à libérer de plus.
    }
  }
}

function closeVision(vision: Vision) {
  closeTasks([vision.pose, vision.recognizer]);
}

/** Nom du moteur WebGL de ce navigateur ; null sans WebGL. */
function webglRenderer(): string | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name: unknown = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof name === 'string' ? name : '';
  } catch {
    return null;
  }
}

/** Les modèles, chargés une fois par page (une caméra reprise ne les recharge pas). */
let visionPromise: Promise<Vision> | null = null;

/**
 * Le CPU, une fois le GPU jugé trop lent ou en panne (en cours d'analyse, ou au chargement quand le
 * CPU, lui, se charge) : retenu jusqu'au prochain chargement de la page. Sans lui, chaque nouvel
 * essai après un échec du moteur repasserait par ce GPU, sa sonde, puis le CPU.
 */
let preferCpu = false;

function keepVision(promise: Promise<Vision>): Promise<Vision> {
  visionPromise = promise;
  // Un échec n'est pas gardé : le prochain essai recharge.
  promise.catch(() => {
    if (visionPromise === promise) visionPromise = null;
  });
  return promise;
}

/**
 * Délégué GPU, CPU en secours ; le CPU d'emblée sans WebGL, sur un moteur WebGL logiciel, ou une fois
 * le GPU écarté (preferCpu).
 */
function loadVision(): Promise<Vision> {
  if (visionPromise) return visionPromise;
  if (preferCpu || initialDelegate(webglRenderer()) === 'CPU') return keepVision(createVision('CPU'));
  return keepVision(
    createVision('GPU').catch(async () => {
      const cpu = await createVision('CPU');
      // Seul le GPU a échoué : les prochains essais ne le reprennent pas.
      preferCpu = true;
      return cpu;
    }),
  );
}

/** Le GPU a échoué en cours de route, ou il est trop lent : les mêmes modèles sur le CPU, désormais. */
function cpuVision(broken: Vision): Promise<Vision> {
  preferCpu = true;
  closeVision(broken);
  return keepVision(createVision('CPU'));
}

function forgetVision(broken: Vision) {
  closeVision(broken);
  visionPromise = null;
}

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

/** La caméra tenue en ce moment (une seule partie de l'app à la fois). */
let holder: GestureCamera | null = null;

export function startGestureCamera(handlers: GestureCameraHandlers): GestureCamera {
  holder?.stop();

  let disposed = false;
  let state: CameraState = { status: 'off', delegate: null };
  let stream: MediaStream | null = null;
  let vision: Vision | null = null;
  let opening = false;
  let fallingBack = false;
  let retryTimer = 0;
  let frameRequest = 0;
  let lastVideoTime = -1;
  let analysisQueued = false;
  let gestures: GestureState = createGestureState();
  let poseTimes: number[] = [];
  let recognizerTimes: number[] = [];
  let permission: PermissionStatus | null = null;
  /**
   * Échecs du moteur des gestes de suite (chargement, lecture de la vidéo, CPU en échec, vidéo
   * figée) : les nouveaux essais s'espacent (cameraRetryDelay), et chargent le moteur avant d'ouvrir
   * la caméra. Remis à zéro après ENGINE_STABLE_MS de marche sans panne.
   */
  let engineFailures = 0;
  /** Première image analysée depuis le dernier échec (pour ENGINE_STABLE_MS). */
  let engineRunningSince: number | null = null;
  /** Chien de garde : la dernière image de la vidéo vue (son currentTime), et quand. */
  let watchedVideoTime = -1;
  let watchedAt = 0;
  /** Dernière image d'écran (un long trou : page gelée, pas vidéo figée). */
  let lastAnimationAt = 0;
  /** Blocages de la vidéo de suite (stallsInARow). */
  let stalls: { count: number; at: number } | null = null;

  // Jamais dans la page : MediaPipe lit ses images, personne ne les voit.
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  const channel = new MessageChannel();

  const report = (status: CameraStatus, delegate: Delegate | null = null) => {
    if (disposed || (state.status === status && state.delegate === delegate)) return;
    state = { status, delegate };
    handlers.onStatus(state);
  };

  const scheduleRetry = (problem: CameraProblem) => {
    window.clearTimeout(retryTimer);
    if (disposed || !shouldRetryCamera(problem, permission?.state ?? null)) return;
    retryTimer = window.setTimeout(() => void start(), cameraRetryDelay(problem, engineFailures));
  };

  /** Rend la caméra (les modèles restent chargés). */
  const release = () => {
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    lastVideoTime = -1;
    if (stream) {
      for (const track of stream.getTracks()) track.removeEventListener('ended', onEnded);
      stopTracks(stream);
      stream = null;
    }
    video.pause();
    video.srcObject = null;
    gestures = disarm(gestures);
  };

  const fail = (problem: CameraProblem) => {
    release();
    report(problem);
    engineRunningSince = null;
    if (problem === 'failed') engineFailures += 1;
    scheduleRetry(problem);
  };

  const hidden = () => document.visibilityState === 'hidden';

  async function start() {
    if (disposed || opening || stream) return;
    window.clearTimeout(retryTimer);
    if (hidden()) {
      report('paused');
      return;
    }
    opening = true;
    // Un nouvel essai garde la ligne du problème jusqu'à son résultat, c'est-à-dire jusqu'à ce que
    // la vidéo avance vraiment (videoStalled) : elle ne clignote pas, même si la caméra s'ouvre mais
    // reste muette ou figée.
    const retrying = isCameraProblem(state.status);
    if (!retrying) report('starting');
    // Page cachée, ou caméra arrêtée, pendant une attente : on rend ce qu'on vient d'ouvrir.
    const abandon = (opened: MediaStream) => {
      stopTracks(opened);
      video.srcObject = null;
      opening = false;
      if (!disposed) report('paused');
    };

    // D'habitude la caméra d'abord : refusée, occupée ou absente, le moteur n'est même pas chargé.
    // Mais après un échec du moteur, il se charge d'abord : s'il manque encore, la caméra (et son
    // témoin, derrière la vitre) ne s'allume pas pour rien.
    let loaded: Vision | null = vision;
    if (!loaded && engineFailures > 0) {
      try {
        loaded = await loadVision();
      } catch {
        opening = false;
        if (!disposed) fail('failed');
        return;
      }
      if (disposed || hidden()) {
        opening = false;
        if (!disposed) report('paused');
        return;
      }
    }

    let opened: MediaStream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('Pas de caméra', 'NotSupportedError');
      opened = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    } catch (error) {
      opening = false;
      if (!disposed) fail(cameraProblemOf(error));
      return;
    }
    if (disposed || hidden()) return abandon(opened);
    // La caméra est ouverte, le moteur se charge. Un nouvel essai garde sa ligne (« refusée »,
    // « occupée »…) jusqu'aux premières images.
    if (!retrying) report('starting');

    if (!loaded) {
      try {
        loaded = await loadVision();
      } catch {
        stopTracks(opened);
        opening = false;
        if (!disposed) fail('failed');
        return;
      }
      if (disposed || hidden()) return abandon(opened);
    }

    // La vidéo d'une caméra ne « joue » qu'à sa première image : une caméra ouverte qui n'en donne
    // aucune (piste muette, webcam tenue ailleurs) laisserait play() en attente, sans ligne ni
    // nouvel essai, et le chien de garde ne part qu'après. Au bout de CAMERA_STALL_MS, l'attente est
    // abandonnée (pause() la fait échouer) et comptée comme une vidéo figée.
    let playTimedOut = false;
    const playTimer = window.setTimeout(() => {
      playTimedOut = true;
      video.pause();
      video.srcObject = null;
    }, CAMERA_STALL_MS);
    try {
      video.srcObject = opened;
      await video.play();
    } catch {
      // Page cachée (release() fait échouer play()) ou caméra arrêtée pendant l'attente : ce n'est
      // pas une panne du moteur.
      if (disposed || hidden()) return abandon(opened);
      stopTracks(opened);
      video.srcObject = null;
      opening = false;
      fail(playTimedOut ? stallProblem(opened.getVideoTracks().some((track) => track.muted)) : 'failed');
      return;
    } finally {
      window.clearTimeout(playTimer);
    }
    if (disposed || hidden()) return abandon(opened);

    opening = false;
    stream = opened;
    vision = loaded;
    for (const track of opened.getVideoTracks()) track.addEventListener('ended', onEnded);
    gestures = disarm(gestures);
    // Le chien de garde part de maintenant : une vidéo qui s'arrête après sa première image compte
    // aussi (avant la première, c'est l'attente de play() ci-dessus).
    watchedVideoTime = -1;
    watchedAt = performance.now();
    lastAnimationAt = watchedAt;
    // Un nouvel essai après un problème : « running » quand la vidéo avance (videoStalled).
    if (!retrying) report('running', loaded.delegate);
    requestFrame();
  }

  /** Caméra prise par une autre appli, débranchée, autorisation retirée : on la rouvre (ou on dit pourquoi). */
  function onEnded() {
    release();
    void start();
  }

  const requestFrame = () => {
    if (!frameRequest && stream) frameRequest = requestAnimationFrame(onAnimationFrame);
  };

  function onAnimationFrame() {
    frameRequest = 0;
    if (!stream) return;
    if (videoStalled(performance.now())) return;
    requestFrame();
    if (analysisQueued || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) return;
    // Une nouvelle image de la vidéo, et c'est le moment (cameraPacing) : on l'analyse juste après
    // le dessin de cette image d'écran.
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    if (!cameraPacing(gestures, performance.now()).runPose) return;
    analysisQueued = true;
    channel.port2.postMessage(null);
  }

  /**
   * Chien de garde, à chaque image d'écran : la vidéo n'a pas donné d'image depuis CAMERA_STALL_MS
   * alors que la caméra tourne. On la rouvre ; au CAMERA_STALL_LIMIT-ième blocage de suite, la ligne
   * du miroir le dit (piste muette : caméra occupée ; sinon : gestes indisponibles), et un nouvel
   * essai suit. Vrai si la vidéo était figée (la caméra a été rendue).
   */
  function videoStalled(now: number): boolean {
    // Page gelée, horloge qui saute : ce n'est pas la vidéo, le chien de garde repart d'ici.
    if (now - lastAnimationAt > CAMERA_PAGE_GAP_MS) watchedAt = now;
    lastAnimationAt = now;
    // Une piste muette ne donne pas d'image, même si l'horloge de la vidéo avance (elle suit le flux,
    // pas les images) : lue à chaque image d'écran, plutôt qu'écoutée.
    const muted = stream?.getVideoTracks().some((track) => track.muted) ?? false;
    if (!muted && video.currentTime !== watchedVideoTime) {
      // Nouvel essai après un problème : sa ligne s'en va quand la vidéo avance vraiment (pas à sa
      // toute première lecture, qui part de -1 même pour une vidéo figée).
      if (watchedVideoTime !== -1 && vision && isCameraProblem(state.status)) report('running', vision.delegate);
      watchedVideoTime = video.currentTime;
      watchedAt = now;
      return false;
    }
    if (now - watchedAt <= CAMERA_STALL_MS) return false;
    // Le compte n'est pas remis à zéro quand la ligne s'affiche : un nouvel essai qui se fige encore
    // dans la minute la redit aussitôt, sans rouvrir la caméra trois fois de plus.
    const count = stallsInARow(stalls, now);
    stalls = { count, at: now };
    if (count >= CAMERA_STALL_LIMIT) {
      fail(stallProblem(muted));
    } else {
      release();
      void start();
    }
    return true;
  }

  function analyse() {
    analysisQueued = false;
    if (disposed || !stream || !vision || fallingBack || video.videoWidth === 0) return;
    const now = performance.now();
    const pacing = cameraPacing(gestures, now);
    if (!pacing.runPose) return;
    const current = vision;
    let pose: readonly PoseLandmark[] | null;
    let poseMs: number;
    let hands: RecognizedHand[] | null = null;
    try {
      pose = current.pose.detectForVideo(video, now).landmarks[0] ?? null;
      poseMs = performance.now() - now;
      if (pacing.runRecognizer) hands = recognizedHands(current.recognizer.recognizeForVideo(video, now));
    } catch {
      void fallBack(current);
      return;
    }
    // Le moteur tourne : après ENGINE_STABLE_MS sans panne, un prochain échec repartira du premier
    // délai (30 s).
    engineRunningSince ??= now;
    engineFailures = engineFailuresAfterFrame(engineFailures, engineRunningSince, now);
    const aspect = video.videoWidth / video.videoHeight;
    // Seulement quand c'est utile : sans Gesture Recognizer ni maintien, aucun geste tenu ne commence.
    const disabledHolds = hands || gestures.hold ? handlers.disabledHolds?.() : undefined;
    const step = stepGestures(gestures, { t: now, aspect, pose, hands, disabledHolds });
    gestures = step.state;
    poseTimes = recentTimes([...poseTimes, now], now);
    recognizerTimes = recentTimes(hands ? [...recognizerTimes, now] : recognizerTimes, now);
    handlers.onFrame({
      output: step.output,
      t: now,
      aspect,
      delegate: current.delegate,
      poseFps: framesPerSecond(poseTimes, now),
      recognizerFps: framesPerSecond(recognizerTimes, now),
    });
    // GPU : les premières images avec quelqu'un devant sont chronométrées ; trop lent, on passe au CPU.
    if (current.probe && pose) {
      current.probe.push(poseMs);
      if (current.probe.length >= GPU_PROBE_FRAMES) {
        const slow = gpuTooSlow(current.probe);
        current.probe = null;
        if (slow && vision === current) void fallBack(current);
      }
    }
  }
  channel.port1.onmessage = analyse;

  /**
   * MediaPipe a échoué sur une image, ou le GPU est trop lent : avec le GPU, on passe au CPU ; avec
   * le CPU (échec seulement), nouvel essai plus tard.
   */
  async function fallBack(broken: Vision) {
    if (fallingBack) return;
    vision = null;
    engineRunningSince = null;
    if (broken.delegate === 'CPU') {
      forgetVision(broken);
      fail('failed');
      return;
    }
    fallingBack = true;
    try {
      const cpu = await cpuVision(broken);
      if (disposed) return;
      vision = cpu;
      gestures = disarm(gestures);
      if (stream) report('running', cpu.delegate);
    } catch {
      if (!disposed) fail('failed');
    } finally {
      fallingBack = false;
    }
  }

  const onVisibility = () => {
    if (hidden()) {
      window.clearTimeout(retryTimer);
      release();
      report('paused');
    } else {
      void start();
    }
  };

  // Autorisation donnée après un refus (icône de la barre d'adresse) : on rouvre tout de suite.
  const onPermissionChange = () => {
    if (permission?.state === 'granted' && !stream && !opening) void start();
  };

  document.addEventListener('visibilitychange', onVisibility);
  navigator.permissions?.query({ name: 'camera' as PermissionName }).then(
    (result) => {
      if (disposed) return;
      permission = result;
      result.addEventListener('change', onPermissionChange);
    },
    () => {
      // Navigateur sans l'API des autorisations : les nouveaux essais suffisent.
    },
  );

  const camera: GestureCamera = {
    stop() {
      if (disposed) return;
      disposed = true;
      window.clearTimeout(retryTimer);
      release();
      document.removeEventListener('visibilitychange', onVisibility);
      permission?.removeEventListener('change', onPermissionChange);
      channel.port1.close();
      if (holder === camera) holder = null;
    },
    disarm() {
      gestures = disarm(gestures);
    },
  };
  holder = camera;
  void start();
  return camera;
}
