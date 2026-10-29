'use client';

import { useEffect, useState } from 'react';
import { ERROR_HEALTH_TIMEOUT_MS, SLEEP_AFTER_MS, errorReloadDelay } from '@/lib/mirror/timing';
import { SleepClock } from './sleep-clock';

// Écran de secours du miroir (app/error.tsx, app/global-error.tsx) : derrière la vitre, personne ne
// peut appuyer sur « Reload ». Noir pur, une ligne grise, et la page se recharge seule : au bout de
// 30 s, puis de 2 min, puis toutes les 10 min (docs/conception.md §8), si le serveur répond. Une touche, ou le
// retour du réseau, recharge tout de suite (s'il répond). Le nombre d'essais survit
// au rechargement (sessionStorage) et repart de zéro dès qu'une tenue s'affiche
// (components/mirror/mirror.tsx).
// Après 2 min sans touche, la veille (docs/conception.md §4) : l'heure seule, dans le fuseau de l'appareil. Les
// rechargements continuent ; une panne qui se répète la nuit repart en veille après chacun. Une
// touche ou un toucher réaffiche la ligne, sans rien faire d'autre (docs/conception.md §5).

export const MIRROR_ERROR_TEXT = "Souci d'affichage, nouvel essai dans un instant";

/** Essais faits par l'écran de secours depuis la dernière tenue affichée. */
export const ERROR_RELOADS_KEY = 'mon-dressing:miroir:rechargements';
/** L'écran de secours dormait quand il s'est rechargé : le suivant repart en veille. */
export const ERROR_ASLEEP_KEY = 'mon-dressing:miroir:secours-veille';

function readErrorReloads(): number {
  try {
    const value = Number(window.sessionStorage.getItem(ERROR_RELOADS_KEY) ?? '0');
    return Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0; // Stockage bloqué : on repart du premier délai.
  }
}

function writeErrorReloads(count: number) {
  try {
    window.sessionStorage.setItem(ERROR_RELOADS_KEY, String(count));
  } catch {
    // Stockage bloqué : le prochain écran de secours attendra de nouveau 30 s.
  }
}

function readErrorAsleep(): boolean {
  try {
    return window.sessionStorage.getItem(ERROR_ASLEEP_KEY) === '1';
  } catch {
    return false; // Stockage bloqué : l'écran suivant s'allume, puis se rendort au bout de 2 min.
  }
}

function writeErrorAsleep(asleep: boolean) {
  try {
    if (asleep) window.sessionStorage.setItem(ERROR_ASLEEP_KEY, '1');
    else window.sessionStorage.removeItem(ERROR_ASLEEP_KEY);
  } catch {
    // Stockage bloqué : l'écran suivant s'allume, puis se rendort au bout de 2 min.
  }
}

/** Le miroir est revenu (une tenue s'affiche) : la prochaine panne recommencera à 30 s, éveillée. */
export function clearErrorReloads() {
  try {
    window.sessionStorage.removeItem(ERROR_RELOADS_KEY);
    window.sessionStorage.removeItem(ERROR_ASLEEP_KEY);
  } catch {
    // Rien à effacer.
  }
}

/**
 * Le serveur répond-il ? Recharger sans réseau remplacerait l'écran noir par la page d'erreur du
 * navigateur (fond clair, pictogramme), allumée derrière la vitre sans garantie de se relancer.
 * /api/health est publique et ne lit rien.
 */
async function serverResponds(): Promise<boolean> {
  if (!navigator.onLine) return false;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), ERROR_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function MirrorErrorScreen() {
  // Rendu côté navigateur seulement après une panne ; sans `window` (rendu serveur), éveillé.
  const [sleeping, setSleeping] = useState(() => typeof window !== 'undefined' && readErrorAsleep());

  useEffect(() => {
    // Essais déjà faits : un essai raté (pas de réseau) repousse le suivant comme un rechargement.
    let attempt = readErrorReloads();
    let asleep = readErrorAsleep();
    let timer = 0;
    let sleepTimer = 0;
    let checking = false;
    let done = false;

    const scheduleSleep = () => {
      window.clearTimeout(sleepTimer);
      sleepTimer = window.setTimeout(() => {
        asleep = true;
        setSleeping(true);
      }, SLEEP_AFTER_MS);
    };
    const scheduleNext = () => {
      timer = window.setTimeout(() => void tryReload(true), errorReloadDelay(attempt));
    };
    // Recharge seulement si le serveur répond. Sans réponse : le prochain essai automatique suit
    // le calendrier ; une touche ou le retour du réseau ('online') ne fait qu'un essai de plus.
    const tryReload = async (fromTimer: boolean) => {
      if (done) return;
      if (checking) {
        if (fromTimer) {
          attempt += 1;
          scheduleNext();
        }
        return;
      }
      checking = true;
      const reachable = await serverResponds();
      checking = false;
      if (done) return;
      if (reachable) {
        done = true;
        window.clearTimeout(timer);
        window.clearTimeout(sleepTimer);
        writeErrorReloads(attempt + 1);
        writeErrorAsleep(asleep);
        window.location.reload();
      } else if (fromTimer) {
        attempt += 1;
        scheduleNext();
      }
    };

    /** La touche ou le toucher qui réveille réaffiche la ligne, sans rien faire d'autre. */
    const wake = () => {
      asleep = false;
      setSleeping(false);
      scheduleSleep();
    };

    scheduleNext();
    if (!asleep) scheduleSleep();
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      // Touche tenue enfoncée : seul le premier appui compte (celui qui réveille ne fait rien d'autre).
      if (event.repeat) return;
      if (asleep) {
        wake();
        return;
      }
      scheduleSleep();
      void tryReload(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!asleep) return;
      event.preventDefault();
      wake();
    };
    const onOnline = () => void tryReload(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('online', onOnline);
    return () => {
      done = true;
      window.clearTimeout(timer);
      window.clearTimeout(sleepTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  // Fond et couleur aussi en ligne : app/global-error.tsx peut s'afficher sans la feuille de style.
  return (
    <main
      data-screen="mirror"
      className="flex h-dvh w-full items-center justify-center bg-black px-10"
      style={{ background: '#000' }}
    >
      {sleeping ? (
        <SleepClock timeZone={null} />
      ) : (
        <p className="text-center text-mirror-sm text-mirror-dim" style={{ color: '#ccc' }}>
          {MIRROR_ERROR_TEXT}
        </p>
      )}
    </main>
  );
}
