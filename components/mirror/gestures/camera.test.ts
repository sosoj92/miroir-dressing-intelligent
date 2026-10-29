import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STANDING, poseOf } from '@/lib/gestures/test-poses';
import { CAMERA_RETRY_MS, CAMERA_STALL_MS, ENGINE_STABLE_MS, GPU_PROBE_FRAMES } from '@/lib/mirror/camera';
import type { CameraState } from './camera';

// La caméra du miroir (camera.ts) sans navigateur ni MediaPipe : une fausse vidéo, de fausses tâches
// MediaPipe qui peuvent échouer au chargement ou en cours d'analyse, ou être lentes, une horloge à la
// main (performance.now) et des minuteurs simulés (nouveaux essais). Aucune image : PoseLandmarker
// « voit » une pose synthétique (test-poses), le préchauffage une toile noire.

type Delegate = 'GPU' | 'CPU';

const env = vi.hoisted(() => ({
  now: 0,
  behaviour: { GPU: 'ok', CPU: 'ok' } as Record<'GPU' | 'CPU', 'ok' | 'load-fails' | 'analyse-fails' | 'slow'>,
  /** Délégué de chaque PoseLandmarker créé, dans l'ordre. */
  created: [] as string[],
  /** La seule vidéo de la caméra (les autres éléments sont des toiles). */
  video: null as unknown,
  person: [] as unknown[],
}));

vi.mock('@mediapipe/tasks-vision', () => {
  const task = (delegate: 'GPU' | 'CPU') => ({
    detectForVideo(source: unknown) {
      // Préchauffage sur une toile noire : personne.
      if (source !== env.video) return { landmarks: [] };
      if (env.behaviour[delegate] === 'analyse-fails') throw new Error('MediaPipe en panne');
      // GPU « lent » : chaque image prend 60 ms (au-delà des 40 ms de GPU_SLOW_MS).
      if (env.behaviour[delegate] === 'slow') env.now += 60;
      return { landmarks: [env.person] };
    },
    recognizeForVideo(source: unknown) {
      if (source === env.video && env.behaviour[delegate] === 'analyse-fails') throw new Error('MediaPipe en panne');
      return { gestures: [], landmarks: [], handedness: [] };
    },
    close() {},
  });
  const create = (kind: 'pose' | 'gestures') => async (_fileset: unknown, options: { baseOptions: { delegate: 'GPU' | 'CPU' } }) => {
    const delegate = options.baseOptions.delegate;
    if (kind === 'pose') env.created.push(delegate);
    if (env.behaviour[delegate] === 'load-fails') throw new Error('modèle introuvable');
    return task(delegate);
  };
  return {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    PoseLandmarker: { createFromOptions: create('pose') },
    GestureRecognizer: { createFromOptions: create('gestures') },
  };
});

type FakeVideo = {
  muted: boolean;
  playsInline: boolean;
  srcObject: unknown;
  readyState: number;
  videoWidth: number;
  videoHeight: number;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
};

type FakeTrack = { muted: boolean; stop: ReturnType<typeof vi.fn>; addEventListener(): void; removeEventListener(): void };

let video: FakeVideo;
let tracks: FakeTrack[];
let getUserMedia: ReturnType<typeof vi.fn>;
let frameCallbacks: Map<number, () => void>;
let messages: Array<{ onmessage: (() => void) | null }>;
let statuses: CameraState[];
let analysed: number;
let stopCamera: (() => void) | null;
/**
 * `waits` : comme une vraie vidéo de caméra qui n'a pas encore d'image, play() reste en attente ;
 * pause() le fait échouer (AbortError), comme dans Chromium.
 */
let playMode: 'ok' | 'waits';
let pendingPlay: ((error: unknown) => void) | null;
let visibilityListeners: Set<() => void>;
let page: { visibilityState: 'visible' | 'hidden' };

function fakeStream() {
  const track: FakeTrack = { muted: false, stop: vi.fn(), addEventListener() {}, removeEventListener() {} };
  tracks.push(track);
  return { getTracks: () => [track], getVideoTracks: () => [track] };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  env.now = 1_000;
  env.behaviour = { GPU: 'ok', CPU: 'ok' };
  env.created = [];
  env.person = poseOf(STANDING)!;
  playMode = 'ok';
  pendingPlay = null;
  visibilityListeners = new Set();
  video = {
    muted: false,
    playsInline: false,
    srcObject: null,
    readyState: 4,
    videoWidth: 640,
    videoHeight: 480,
    currentTime: 0,
    play: () =>
      playMode === 'ok'
        ? Promise.resolve()
        : new Promise<void>((_resolve, reject) => {
            pendingPlay = reject;
          }),
    pause() {
      pendingPlay?.(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'));
      pendingPlay = null;
    },
  };
  env.video = video;
  tracks = [];
  getUserMedia = vi.fn(async () => fakeStream());
  frameCallbacks = new Map();
  messages = [];
  statuses = [];
  analysed = 0;
  stopCamera = null;

  const gl = {
    RENDERER: 0x1f01,
    getExtension: (name: string) =>
      name === 'WEBGL_debug_renderer_info'
        ? { UNMASKED_RENDERER_WEBGL: 0x9246 }
        : name === 'WEBGL_lose_context'
          ? { loseContext() {} }
          : null,
    getParameter: () => 'Mali-G615 MC6',
  };
  const canvas = { width: 0, height: 0, getContext: (kind: string) => (kind === '2d' ? { fillStyle: '', fillRect() {} } : gl) };
  vi.stubGlobal('window', globalThis);
  page = {
    visibilityState: 'visible',
    createElement: (tag: string) => (tag === 'video' ? video : canvas),
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'visibilitychange') visibilityListeners.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => visibilityListeners.delete(listener),
  } as { visibilityState: 'visible' | 'hidden' };
  vi.stubGlobal('document', page);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });
  let nextFrame = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    const id = nextFrame++;
    frameCallbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frameCallbacks.delete(id));
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1 = { onmessage: null as (() => void) | null, close() {} };
      port2 = { postMessage: () => messages.push(this.port1) };
    },
  );
  vi.spyOn(performance, 'now').mockImplementation(() => env.now);
});

afterEach(() => {
  stopCamera?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Laisse finir les chargements (import, modèles, préchauffage) : promesses et minuteurs proches. Un
 * minuteur à 0 posé pendant un autre tombe 1 ms plus tard (minuteurs simulés) : on avance de 1 ms à
 * chaque tour, 25 ms en tout, loin des 30 s des nouveaux essais.
 */
async function settle() {
  for (let i = 0; i < 25; i++) {
    await vi.advanceTimersByTimeAsync(1);
    // L'import dynamique passe par le chargeur de modules : un vrai tour de boucle.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** `count` images d'écran de `ms` ; la vidéo avance d'autant, sauf figée. */
async function frames(count: number, { ms = 33, frozen = false } = {}) {
  for (let i = 0; i < count; i++) {
    env.now += ms;
    if (!frozen) video.currentTime += ms / 1000;
    const callbacks = [...frameCallbacks.values()];
    frameCallbacks.clear();
    for (const callback of callbacks) callback();
    for (const port of messages.splice(0)) port.onmessage?.();
    await settle();
  }
}

/** Attend `ms` sur les minuteurs simulés (nouveaux essais), sans image d'écran. */
async function wait(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

async function start() {
  // Le faux MediaPipe déjà chargé : son import dynamique, dans camera.ts, ne fait que le relire.
  await import('@mediapipe/tasks-vision');
  const { startGestureCamera } = await import('./camera');
  const camera = startGestureCamera({
    onFrame: () => {
      analysed += 1;
    },
    onStatus: (state) => statuses.push(state),
  });
  stopCamera = () => camera.stop();
  await settle();
  return camera;
}

const status = () => statuses.at(-1);
const running = (delegate: Delegate) => ({ status: 'running', delegate });

/** Page cachée (fenêtre couverte, autre onglet) ou de nouveau visible. */
async function setVisibility(state: 'visible' | 'hidden') {
  page.visibilityState = state;
  for (const listener of [...visibilityListeners]) listener();
  await settle();
}

describe('caméra du miroir : moteur des gestes en panne', () => {
  it('GPU qui plante en cours d’analyse : le CPU prend la relève ; s’il plante aussi, « Gestes indisponibles », puis le nouvel essai reprend le CPU', async () => {
    env.behaviour.GPU = 'analyse-fails';
    await start();
    expect(status()).toEqual(running('GPU'));
    await frames(3);
    expect(status()).toEqual(running('CPU'));
    expect(env.created).toEqual(['GPU', 'CPU']);
    await frames(10);
    expect(analysed).toBeGreaterThan(5);

    // Le CPU plante à son tour : la ligne du miroir, la caméra rendue.
    env.behaviour.CPU = 'analyse-fails';
    await frames(3);
    expect(status()).toEqual({ status: 'failed', delegate: null });
    expect(tracks[0].stop).toHaveBeenCalled();

    // Nouvel essai au bout de 30 s, directement sur le CPU : pas de retour au GPU qui a planté. La
    // ligne reste jusqu'à ce que la vidéo avance.
    env.behaviour.CPU = 'ok';
    await wait(CAMERA_RETRY_MS - 1_000);
    expect(env.created).toEqual(['GPU', 'CPU']);
    await wait(1_000);
    expect(env.created).toEqual(['GPU', 'CPU', 'CPU']);
    expect(status()).toEqual({ status: 'failed', delegate: null });
    await frames(2);
    expect(status()).toEqual(running('CPU'));
  });

  it('GPU trop lent (médiane au-delà de 40 ms sur les 15 premières images avec quelqu’un) : le CPU, une fois pour toutes', async () => {
    env.behaviour.GPU = 'slow';
    await start();
    expect(status()).toEqual(running('GPU'));
    await frames(GPU_PROBE_FRAMES + 5);
    expect(status()).toEqual(running('CPU'));
    expect(env.created).toEqual(['GPU', 'CPU']);

    // Le CPU plante plus tard : le nouvel essai ne repasse ni par le GPU ni par sa sonde.
    env.behaviour.CPU = 'analyse-fails';
    await frames(3);
    expect(status()).toEqual({ status: 'failed', delegate: null });
    env.behaviour.CPU = 'ok';
    await wait(CAMERA_RETRY_MS);
    expect(env.created).toEqual(['GPU', 'CPU', 'CPU']);
    await frames(2);
    expect(status()).toEqual(running('CPU'));
  });

  it('un GPU rapide reste le GPU', async () => {
    await start();
    await frames(GPU_PROBE_FRAMES + 10);
    expect(status()).toEqual(running('GPU'));
    expect(env.created).toEqual(['GPU']);
  });

  it('moteur qui repart puis retombe peu après : les essais s’espacent quand même ; après 5 min sans panne, on repart de 30 s', async () => {
    // Les modèles manquent : ni GPU ni CPU (aucune préférence retenue).
    env.behaviour = { GPU: 'load-fails', CPU: 'load-fails' };
    await start();
    expect(status()).toEqual({ status: 'failed', delegate: null });
    expect(env.created).toEqual(['GPU', 'CPU']);

    // 30 s plus tard, le CPU se charge (le GPU toujours pas) : retenu.
    env.behaviour.CPU = 'ok';
    await wait(CAMERA_RETRY_MS);
    expect(env.created).toEqual(['GPU', 'CPU', 'GPU', 'CPU']);
    await frames(10);
    expect(status()).toEqual(running('CPU'));

    // Il plante quelques images plus tard : deuxième échec de suite, le nouvel essai attend 2 min.
    env.behaviour.CPU = 'analyse-fails';
    await frames(3);
    expect(status()).toEqual({ status: 'failed', delegate: null });
    env.behaviour.CPU = 'ok';
    await wait(CAMERA_RETRY_MS);
    expect(env.created).toHaveLength(4);
    await wait(2 * 60_000 - CAMERA_RETRY_MS);
    expect(env.created).toEqual(['GPU', 'CPU', 'GPU', 'CPU', 'CPU']);

    // 5 min de marche sans panne : le moteur est jugé réparé, un nouvel échec repart de 30 s.
    await frames(5);
    expect(status()).toEqual(running('CPU'));
    await frames(1, { ms: ENGINE_STABLE_MS });
    await frames(5);
    env.behaviour.CPU = 'analyse-fails';
    await frames(3);
    expect(status()).toEqual({ status: 'failed', delegate: null });
    env.behaviour.CPU = 'ok';
    await wait(CAMERA_RETRY_MS);
    expect(env.created).toHaveLength(6);
    await frames(2);
    expect(status()).toEqual(running('CPU'));
  });
});

describe('caméra du miroir : vidéo figée', () => {
  /** Images d'écran pendant `ms`, la vidéo figée. */
  const frozenFor = (ms: number) => frames(Math.ceil(ms / 33), { frozen: true });

  it('la vidéo ne donne plus d’image : la caméra est rouverte ; figée trois fois de suite, « Gestes indisponibles »', async () => {
    await start();
    await frames(10);
    expect(status()).toEqual(running('GPU'));
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    // Moins de 5 s sans image : rien.
    await frozenFor(CAMERA_STALL_MS - 200);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    // Au-delà : la caméra est rendue puis rouverte (le moteur reste chargé).
    await frozenFor(400);
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(status()).toEqual(running('GPU'));
    expect(env.created).toEqual(['GPU']);

    // Toujours figée : deuxième blocage, puis troisième, et la ligne du miroir le dit.
    await frozenFor(CAMERA_STALL_MS + 400);
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    await frozenFor(CAMERA_STALL_MS + 400);
    expect(status()).toEqual({ status: 'failed', delegate: null });
    expect(tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true);

    // Nouvel essai 30 s plus tard : la ligne reste jusqu'à ce que la vidéo avance. Elle repart, les
    // images sont de nouveau analysées.
    await wait(CAMERA_RETRY_MS);
    expect(getUserMedia).toHaveBeenCalledTimes(4);
    expect(status()).toEqual({ status: 'failed', delegate: null });
    const before = analysed;
    await frames(20);
    expect(status()).toEqual(running('GPU'));
    expect(analysed).toBeGreaterThan(before);
  });

  it('toujours figée au nouvel essai : la ligne reste, sans clignoter, et revient sans rouvrir trois fois', async () => {
    await start();
    await frames(10);
    for (let i = 0; i < 3; i++) await frozenFor(CAMERA_STALL_MS + 400);
    expect(status()).toEqual({ status: 'failed', delegate: null });
    const shown = statuses.length;
    expect(getUserMedia).toHaveBeenCalledTimes(3);

    // Nouvel essai 30 s plus tard, la vidéo toujours figée : la ligne ne s'en va pas, et le premier
    // blocage dans la minute la redit aussitôt (pas trois de plus).
    await wait(CAMERA_RETRY_MS);
    expect(getUserMedia).toHaveBeenCalledTimes(4);
    await frozenFor(CAMERA_STALL_MS + 400);
    expect(statuses.slice(shown)).toEqual([]);
    expect(tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(4);
  });

  it('piste muette (caméra prise par une autre appli, sur Android) : « Caméra occupée », même si l’horloge de la vidéo avance', async () => {
    await start();
    await frames(10);
    // La piste devient muette ; l'horloge de la vidéo, elle, suit le flux et continue d'avancer.
    getUserMedia.mockImplementation(async () => {
      const stream = fakeStream();
      stream.getVideoTracks()[0].muted = true;
      return stream;
    });
    tracks[0].muted = true;
    await frames(Math.ceil((CAMERA_STALL_MS - 200) / 33));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await frames(Math.ceil(400 / 33));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 2; i++) await frames(Math.ceil((CAMERA_STALL_MS + 400) / 33));
    expect(status()).toEqual({ status: 'busy', delegate: null });

    // Toujours prise ailleurs : à chaque nouvel essai, « Caméra occupée » reste affichée (avant, elle
    // disparaissait 16 s à chaque essai, gestes morts sans ligne).
    const shown = statuses.length;
    for (let i = 0; i < 3; i++) {
      await wait(CAMERA_RETRY_MS);
      await frames(Math.ceil((CAMERA_STALL_MS + 400) / 33));
    }
    expect(statuses.slice(shown)).toEqual([]);
    expect(getUserMedia).toHaveBeenCalledTimes(3 + 3);

    // L'autre appli la rend : la ligne s'en va au nouvel essai, dès que la vidéo avance.
    getUserMedia.mockImplementation(async () => fakeStream());
    await wait(CAMERA_RETRY_MS);
    await frames(3);
    expect(status()).toEqual(running('GPU'));
  });

  it('caméra ouverte qui ne donne aucune image (play() en attente) : au bout de 5 s, rendue, « Gestes indisponibles », nouvel essai', async () => {
    playMode = 'waits';
    await start();
    expect(status()).toEqual({ status: 'starting', delegate: null });
    await wait(CAMERA_STALL_MS - 200);
    expect(status()).toEqual({ status: 'starting', delegate: null });
    expect(tracks[0].stop).not.toHaveBeenCalled();
    await wait(400);
    expect(status()).toEqual({ status: 'failed', delegate: null });
    expect(tracks[0].stop).toHaveBeenCalled();

    // Nouvel essai 30 s plus tard ; la caméra donne enfin des images : la ligne s'en va.
    playMode = 'ok';
    await wait(CAMERA_RETRY_MS);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    await frames(3);
    expect(status()).toEqual(running('GPU'));
  });

  it('piste muette, puis la caméra rouverte ne donne aucune image : « Caméra occupée », sans rester sur « starting »', async () => {
    await start();
    await frames(10);
    getUserMedia.mockImplementation(async () => {
      const stream = fakeStream();
      stream.getVideoTracks()[0].muted = true;
      return stream;
    });
    tracks[0].muted = true;
    playMode = 'waits';
    await frames(Math.ceil((CAMERA_STALL_MS + 400) / 33));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    await wait(CAMERA_STALL_MS + 400);
    expect(status()).toEqual({ status: 'busy', delegate: null });
    expect(tracks[1].stop).toHaveBeenCalled();
  });

  it('page cachée pendant l’attente de la première image : « paused », pas une panne du moteur', async () => {
    playMode = 'waits';
    await start();
    expect(status()).toEqual({ status: 'starting', delegate: null });
    await setVisibility('hidden');
    expect(status()).toEqual({ status: 'paused', delegate: null });
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(statuses.map((s) => s.status)).not.toContain('failed');

    // De retour : la caméra se rouvre aussitôt, sans attendre un nouvel essai.
    playMode = 'ok';
    await setVisibility('visible');
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(status()).toEqual(running('GPU'));
    expect(statuses.map((s) => s.status)).toEqual(['starting', 'paused', 'starting', 'running']);
  });

  it('une page gelée (ou une horloge qui saute) n’est pas une vidéo figée', async () => {
    await start();
    await frames(10);
    // 10 s entre deux images d'écran, sans nouvelle image de la vidéo : rien.
    await frames(1, { ms: 10_000, frozen: true });
    await frames(10);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(status()).toEqual(running('GPU'));
  });

  it('des blocages espacés de plus d’une minute ne s’additionnent pas', async () => {
    await start();
    for (let i = 0; i < 4; i++) {
      await frozenFor(CAMERA_STALL_MS + 400);
      await frames(1, { ms: 61_000 });
      await frames(10);
    }
    expect(getUserMedia).toHaveBeenCalledTimes(5);
    expect(status()).toEqual(running('GPU'));
  });
});
