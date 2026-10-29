import { describe, expect, it } from 'vitest';
import {
  CAMERA_LINES,
  CAMERA_RETRY_MS,
  CAMERA_STALL_LIMIT,
  CAMERA_STALL_MS,
  CAMERA_STALL_WINDOW_MS,
  ENGINE_STABLE_MS,
  GPU_PROBE_FRAMES,
  GPU_SLOW_MS,
  cameraLine,
  cameraProblemOf,
  cameraRetryDelay,
  engineFailuresAfterFrame,
  gpuTooSlow,
  initialDelegate,
  isCameraProblem,
  shouldRetryCamera,
  stallProblem,
  stallsInARow,
} from './camera';

describe('caméra : erreurs de getUserMedia', () => {
  it('refusée : NotAllowedError (et ses anciens noms)', () => {
    expect(cameraProblemOf(new DOMException('Permission denied', 'NotAllowedError'))).toBe('denied');
    expect(cameraProblemOf({ name: 'PermissionDeniedError' })).toBe('denied');
    expect(cameraProblemOf(new DOMException('', 'SecurityError'))).toBe('denied');
  });

  it('occupée par une autre appli : NotReadableError (une autre appli la garde : visio, assistant vocal…)', () => {
    expect(cameraProblemOf(new DOMException('Could not start video source', 'NotReadableError'))).toBe('busy');
    expect(cameraProblemOf({ name: 'TrackStartError' })).toBe('busy');
    expect(cameraProblemOf(new DOMException('', 'AbortError'))).toBe('busy');
  });

  it('pas de caméra, ou erreur inconnue : « absente » (rien ne s’affiche)', () => {
    expect(cameraProblemOf(new DOMException('', 'NotFoundError'))).toBe('absent');
    expect(cameraProblemOf(new DOMException('', 'OverconstrainedError'))).toBe('absent');
    // Chromium sans caméra (tests e2e) : NotSupportedError.
    expect(cameraProblemOf(new DOMException('Not supported', 'NotSupportedError'))).toBe('absent');
    expect(cameraProblemOf(new Error('boom'))).toBe('absent');
    expect(cameraProblemOf(null)).toBe('absent');
    expect(cameraProblemOf('texte')).toBe('absent');
  });
});

describe('caméra : la ligne du miroir', () => {
  it('une seule petite ligne, quand les gestes ne marchent pas et qu’on ne le verrait pas autrement', () => {
    expect(cameraLine('denied')).toBe('Caméra refusée : gestes coupés.');
    expect(cameraLine('busy')).toBe('Caméra occupée par une autre appli.');
    // Moteur des gestes en panne : les bras sont la seule commande, il faut le savoir.
    expect(cameraLine('failed')).toBe("Gestes indisponibles pour l'instant.");
    expect(CAMERA_LINES).toEqual({ denied: cameraLine('denied'), busy: cameraLine('busy'), failed: cameraLine('failed') });
    for (const status of ['off', 'starting', 'running', 'paused', 'absent'] as const) {
      expect(cameraLine(status)).toBeNull();
    }
  });

  it('problèmes et états de marche', () => {
    expect(['denied', 'busy', 'absent', 'failed'].every((s) => isCameraProblem(s as never))).toBe(true);
    expect(['off', 'starting', 'running', 'paused'].some((s) => isCameraProblem(s as never))).toBe(false);
  });
});

describe('caméra : nouvel essai', () => {
  it('toutes les 30 s, sauf une demande d’autorisation écartée (elle se rouvrirait toutes les 30 s)', () => {
    expect(CAMERA_RETRY_MS).toBe(30_000);
    expect(shouldRetryCamera('busy', 'granted')).toBe(true);
    expect(shouldRetryCamera('absent', null)).toBe(true);
    expect(shouldRetryCamera('failed', 'granted')).toBe(true);
    // Autorisation bloquée : getUserMedia échoue sans rien demander, on réessaie quand même.
    expect(shouldRetryCamera('denied', 'denied')).toBe(true);
    expect(shouldRetryCamera('denied', null)).toBe(true);
    expect(shouldRetryCamera('denied', 'prompt')).toBe(false);
  });

  it('caméra refusée, occupée ou absente : toujours 30 s', () => {
    for (const problem of ['denied', 'busy', 'absent'] as const) {
      expect(cameraRetryDelay(problem, 0)).toBe(CAMERA_RETRY_MS);
      expect(cameraRetryDelay(problem, 7)).toBe(CAMERA_RETRY_MS);
    }
  });

  it('moteur en échec : 30 s, puis 2 min, puis toutes les 10 min (il recompile tout à chaque essai)', () => {
    expect(cameraRetryDelay('failed', 1)).toBe(30_000);
    expect(cameraRetryDelay('failed', 2)).toBe(2 * 60_000);
    expect(cameraRetryDelay('failed', 3)).toBe(10 * 60_000);
    expect(cameraRetryDelay('failed', 50)).toBe(10 * 60_000);
    // Compte inattendu : le premier délai.
    expect(cameraRetryDelay('failed', 0)).toBe(30_000);
  });
});

describe('délégué de MediaPipe', () => {
  it('moteur WebGL logiciel ou absent : le CPU d’emblée ; sinon le GPU', () => {
    expect(initialDelegate('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe('CPU');
    expect(initialDelegate('Google SwiftShader')).toBe('CPU');
    expect(initialDelegate('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('CPU');
    expect(initialDelegate('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('CPU');
    expect(initialDelegate(null)).toBe('CPU');
    expect(initialDelegate('ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('GPU');
    expect(initialDelegate('ANGLE (Qualcomm, Adreno (TM) 810, OpenGL ES 3.2)')).toBe('GPU');
    expect(initialDelegate('Adreno (TM) 735')).toBe('GPU');
    // Navigateur qui cache le nom du moteur : on tente le GPU (le CPU reste en secours).
    expect(initialDelegate('WebKit WebGL')).toBe('GPU');
  });

  it('GPU trop lent : médiane de PoseLandmarker au-delà de 40 ms sur les 15 premières images', () => {
    const frames = (ms: number) => Array.from({ length: GPU_PROBE_FRAMES }, () => ms);
    // Mesures du PC : vrai GPU 6,5 ms, SwiftShader 77 ms.
    expect(gpuTooSlow(frames(6.5))).toBe(false);
    expect(gpuTooSlow(frames(77))).toBe(true);
    expect(gpuTooSlow(frames(GPU_SLOW_MS))).toBe(false);
    // Pas encore assez d'images : on attend.
    expect(gpuTooSlow(frames(77).slice(1))).toBe(false);
    // Quelques images lentes (une page qui se dessine) ne suffisent pas : la médiane.
    expect(gpuTooSlow([...frames(7).slice(0, 8), ...frames(120).slice(0, 7)])).toBe(false);
    expect(gpuTooSlow([...frames(7).slice(0, 7), ...frames(120).slice(0, 8)])).toBe(true);
  });
});

describe('moteur réparé, vidéo figée', () => {
  it('le compte des échecs du moteur ne repart de zéro qu’après 5 min de marche sans panne', () => {
    expect(ENGINE_STABLE_MS).toBe(5 * 60_000);
    // Une image analysée juste après un nouvel essai ne suffit pas.
    expect(engineFailuresAfterFrame(2, 10_000, 10_033)).toBe(2);
    expect(engineFailuresAfterFrame(2, 10_000, 10_000 + ENGINE_STABLE_MS - 1)).toBe(2);
    expect(engineFailuresAfterFrame(2, 10_000, 10_000 + ENGINE_STABLE_MS)).toBe(0);
  });

  it('vidéo figée 5 s : on rouvre la caméra ; trois fois de suite (moins d’une minute entre deux), la ligne', () => {
    expect(CAMERA_STALL_MS).toBe(5_000);
    expect(CAMERA_STALL_LIMIT).toBe(3);
    expect(stallsInARow(null, 1_000)).toBe(1);
    expect(stallsInARow({ count: 1, at: 1_000 }, 7_000)).toBe(2);
    expect(stallsInARow({ count: 2, at: 7_000 }, 13_000)).toBe(3);
    // Plus d'une minute de marche entre deux blocages : on repart à 1.
    expect(stallsInARow({ count: 2, at: 7_000 }, 7_000 + CAMERA_STALL_WINDOW_MS)).toBe(1);
  });

  it('après les blocages : piste muette, caméra occupée ; sinon, gestes indisponibles', () => {
    expect(stallProblem(true)).toBe('busy');
    expect(stallProblem(false)).toBe('failed');
    expect(cameraLine(stallProblem(true))).toBe(CAMERA_LINES.busy);
    expect(cameraLine(stallProblem(false))).toBe(CAMERA_LINES.failed);
  });
});
