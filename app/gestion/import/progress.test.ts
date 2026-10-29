import { describe, expect, it, vi } from 'vitest';
import {
  holdScreen,
  progressMessage,
  sendingHint,
  type PageLike,
  type WakeLockLike,
  type WakeLockSentinelLike,
} from './progress';

/** Page simulée : `show` change sa visibilité et prévient les écouteurs, comme le navigateur. */
function fakePage() {
  const listeners = new Set<() => void>();
  const page: { -readonly [K in keyof PageLike]: PageLike[K] } = {
    visibilityState: 'visible',
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
  };
  const show = (state: DocumentVisibilityState) => {
    page.visibilityState = state;
    for (const listener of listeners) listener();
  };
  return { page, show, listeners };
}

/** Verrou simulé ; `lose` fait ce que fait le navigateur quand la page passe en arrière-plan. */
function fakeSentinel() {
  const sentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true;
    }),
    lose: () => {
      sentinel.released = true;
    },
  };
  return sentinel satisfies WakeLockSentinelLike;
}

/** Laisse finir les demandes de verrou en cours. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('progressMessage', () => {
  it('un seul format de compte pour les deux imports', () => {
    expect(progressMessage({ step: 'photos', done: 12, total: 20 })).toBe('Photos envoyées : 12 sur 20');
    expect(progressMessage({ step: 'sleeves', done: 3, total: 9 })).toBe('Manches envoyées : 3 sur 9');
    expect(progressMessage({ step: 'save', done: 2, total: 3 })).toBe('Enregistrement : 2 sur 3');
    expect(progressMessage({ step: 'save', done: 0, total: 1 })).toBe('Enregistrement…');
    expect(progressMessage({ step: 'read' })).toBe('Lecture du fichier…');
    expect(progressMessage({ step: 'check' })).toBe('Vérification du paquet…');
  });
});

describe('holdScreen', () => {
  it('navigateur sans Wake Lock : rien à relâcher', async () => {
    const { page, listeners } = fakePage();
    const hold = await holdScreen(undefined, page);
    expect(hold.held).toBe(false);
    expect(listeners.size).toBe(0);
    await expect(hold.release()).resolves.toBeUndefined();
  });

  it('demande refusée (batterie faible, page cachée) : pas de verrou, pas d’erreur', async () => {
    const wakeLock: WakeLockLike = { request: vi.fn().mockRejectedValue(new Error('NotAllowedError')) };
    const hold = await holdScreen(wakeLock, fakePage().page);
    expect(hold.held).toBe(false);
  });

  it("verrou obtenu : relâché à la fin, même si le navigateur l'a déjà relâché", async () => {
    const release = vi.fn().mockRejectedValueOnce(new Error('déjà relâché'));
    const wakeLock: WakeLockLike = { request: vi.fn().mockResolvedValue({ release }) };
    const { page, listeners } = fakePage();
    const hold = await holdScreen(wakeLock, page);
    expect(wakeLock.request).toHaveBeenCalledWith('screen');
    expect(hold.held).toBe(true);
    await expect(hold.release()).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it('page passée en arrière-plan : verrou perdu, redemandé à son retour', async () => {
    const first = fakeSentinel();
    const second = fakeSentinel();
    const wakeLock: WakeLockLike = { request: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) };
    const { page, show } = fakePage();
    const hold = await holdScreen(wakeLock, page);

    // Notification ouverte : le navigateur relâche le verrou.
    first.lose();
    show('hidden');
    expect(hold.held).toBe(false);
    expect(wakeLock.request).toHaveBeenCalledTimes(1);

    show('visible');
    await settle();
    expect(wakeLock.request).toHaveBeenCalledTimes(2);
    expect(hold.held).toBe(true);

    await hold.release();
    expect(second.release).toHaveBeenCalledTimes(1);
    expect(first.release).not.toHaveBeenCalled();
  });

  it('retour sur la page avec le verrou encore tenu : rien n’est redemandé', async () => {
    const wakeLock: WakeLockLike = { request: vi.fn().mockResolvedValue(fakeSentinel()) };
    const { page, show } = fakePage();
    await holdScreen(wakeLock, page);
    show('visible');
    await settle();
    expect(wakeLock.request).toHaveBeenCalledTimes(1);
  });

  it('deux retours rapprochés : une seule nouvelle demande', async () => {
    const first = fakeSentinel();
    const wakeLock: WakeLockLike = { request: vi.fn().mockResolvedValueOnce(first).mockResolvedValue(fakeSentinel()) };
    const { page, show } = fakePage();
    await holdScreen(wakeLock, page);
    first.lose();
    show('visible');
    show('visible');
    await settle();
    expect(wakeLock.request).toHaveBeenCalledTimes(2);
  });

  it('nouvelle demande refusée : la consigne redemande de garder l’écran allumé', async () => {
    const first = fakeSentinel();
    const wakeLock: WakeLockLike = {
      request: vi.fn().mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('NotAllowedError')),
    };
    const { page, show } = fakePage();
    const hold = await holdScreen(wakeLock, page);
    first.lose();
    show('visible');
    await settle();
    expect(hold.held).toBe(false);
  });

  it('envoi fini pendant une nouvelle demande : le verrou obtenu après est relâché', async () => {
    const first = fakeSentinel();
    const late = fakeSentinel();
    let grant: (sentinel: WakeLockSentinelLike) => void = () => {};
    const wakeLock: WakeLockLike = {
      request: vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockImplementationOnce(() => new Promise<WakeLockSentinelLike>((resolve) => (grant = resolve))),
    };
    const { page, show, listeners } = fakePage();
    const hold = await holdScreen(wakeLock, page);
    first.lose();
    show('visible');
    await hold.release();
    expect(listeners.size).toBe(0);

    grant(late);
    await settle();
    expect(late.release).toHaveBeenCalledTimes(1);
    expect(hold.held).toBe(false);
  });
});

describe('sendingHint', () => {
  it("« Garde l'écran allumé. » seulement sans Wake Lock", () => {
    expect(sendingHint(true)).toBe("Reste sur cette page pendant l'envoi.");
    expect(sendingHint(false)).toBe("Reste sur cette page pendant l'envoi. Garde l'écran allumé.");
  });
});
