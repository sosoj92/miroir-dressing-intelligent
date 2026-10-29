import type { AssemblyProgress } from '@/lib/import/assemblage-client';
import type { ImportProgress } from '@/lib/import/client';

// Ce qu'affiche l'écran Importer pendant l'envoi, pour les deux formats (paquet d'assemblage,
// prototype) : un seul format de compte, « Photos envoyées : 12 sur 20 ».

export function progressMessage(progress: ImportProgress | AssemblyProgress): string {
  switch (progress.step) {
    case 'read':
      return 'Lecture du fichier…';
    case 'check':
      return 'Vérification du paquet…';
    case 'photos':
      return `Photos envoyées : ${progress.done} sur ${progress.total}`;
    case 'sleeves':
      return `Manches envoyées : ${progress.done} sur ${progress.total}`;
    case 'save':
      return progress.total > 1 ? `Enregistrement : ${progress.done} sur ${progress.total}` : 'Enregistrement…';
  }
}

/** Un verrou obtenu. `released` : vrai une fois relâché, par l'app ou par le navigateur. */
export type WakeLockSentinelLike = { readonly released?: boolean; release(): Promise<void> };

/** Le minimum de l'API Screen Wake Lock dont l'import a besoin (navigator.wakeLock). */
export type WakeLockLike = { request(type: 'screen'): Promise<WakeLockSentinelLike> };

/** La page (document) : le verrou est redemandé quand elle revient au premier plan. */
export type PageLike = {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
};

/**
 * Écran gardé allumé pendant l'envoi, ou non (navigateur sans Wake Lock, batterie faible, verrou
 * perdu et pas rendu) : `held` est relu à chaque message de l'envoi.
 */
export type ScreenHold = { readonly held: boolean; release: () => Promise<void> };

/**
 * Garde l'écran allumé pendant l'envoi : un téléphone qui se met en veille coupe l'import. Le
 * navigateur relâche le verrou dès que la page passe en arrière-plan (autre app, notification) :
 * il est redemandé quand elle revient. Ne lève jamais.
 */
export async function holdScreen(wakeLock: WakeLockLike | undefined, page: PageLike): Promise<ScreenHold> {
  if (!wakeLock) return { held: false, release: async () => {} };
  const api = wakeLock;

  let sentinel: WakeLockSentinelLike | null = null;
  let asking = false;
  let done = false;
  const lost = () => sentinel === null || sentinel.released === true;

  async function request() {
    asking = true;
    try {
      const next = await api.request('screen');
      // Envoi fini pendant la demande : le verrou ne sert plus.
      if (done) await next.release().catch(() => undefined);
      else sentinel = next;
    } catch {
      // Refusé (batterie faible, page cachée) : la consigne demande de garder l'écran allumé.
    } finally {
      asking = false;
    }
  }

  // Une seule demande à la fois : deux retours rapprochés ne prennent pas deux verrous.
  function onVisibilityChange() {
    if (done || asking || page.visibilityState !== 'visible' || !lost()) return;
    void request();
  }

  await request();
  page.addEventListener('visibilitychange', onVisibilityChange);
  return {
    get held() {
      return !lost();
    },
    release: async () => {
      done = true;
      page.removeEventListener('visibilitychange', onVisibilityChange);
      const current = sentinel;
      sentinel = null;
      await current?.release().catch(() => undefined);
    },
  };
}

/** Consigne pendant l'envoi : sans Wake Lock, l'écran doit rester allumé à la main. */
export function sendingHint(held: boolean): string {
  return held ? "Reste sur cette page pendant l'envoi." : "Reste sur cette page pendant l'envoi. Garde l'écran allumé.";
}
