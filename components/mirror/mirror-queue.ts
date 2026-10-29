import { createQueue, QUEUE_RETRY_MS, type KeyValueStore, type MirrorQueue } from '@/lib/mirror/queue';

// File d'envoi unique de la tablette, créée au premier usage dans le navigateur.

let queue: MirrorQueue | null = null;

function browserStorage(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null; // Navigation privée ou stockage bloqué : la file reste en mémoire.
  }
}

export function getMirrorQueue(): MirrorQueue {
  if (!queue) {
    queue = createQueue({
      fetch: (input, init) => fetch(input, init),
      storage: browserStorage(),
    });
  }
  return queue;
}

/** Envoie la file maintenant, au retour du réseau et toutes les 30 s. Renvoie l'arrêt. */
export function startQueueRunner(target: MirrorQueue): () => void {
  const flush = () => void target.flush();
  window.addEventListener('online', flush);
  const interval = window.setInterval(flush, QUEUE_RETRY_MS);
  flush();
  return () => {
    window.removeEventListener('online', flush);
    window.clearInterval(interval);
  };
}
