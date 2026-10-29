'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { retainSilhouettes } from '@/components/assembly/silhouette-store';
import { MirrorDate } from '@/components/mirror-date';
import { silhouetteKey } from '@/lib/assembly/render';
import type { GestureAction, HoldView } from '@/lib/gestures';
import { MODIFIER_KEYS } from '@/lib/keys/capture';
import { parseKeyMap } from '@/lib/keys/parse';
import { resolveKey } from '@/lib/keys/resolve';
import { buildBrowse, composedOutfit, itemsByProximity, neighbours } from '@/lib/mirror/browse';
import { itemImageUrls, itemsById, outfitSilhouettes, sameIds } from '@/lib/mirror/deck';
import { PRESENCE_ACTIVITY_MS, confirmWaits, disabledHolds, gestureEffect, sameHold } from '@/lib/mirror/gestures';
import { isChoiceJob, pendingChoices, pendingKeyMapBody, pendingRefusalIds } from '@/lib/mirror/queue';
import {
  applyAction,
  clearFlash,
  clearMessage,
  currentMark,
  currentOutfit,
  fallAsleep,
  initialMirrorState,
  isMirrorPayload,
  keyTestKey,
  loadFailed,
  loaded,
  messageDuration,
  messageHidesOutfit,
  openKeyTest,
  pendingPayload,
  problemForStatus,
  unmappedKey,
  wake,
  withBrowse,
  withDeviceDay,
  withNetwork,
  type FlashField,
  type LoadProblem,
  type MirrorState,
  type Transition,
} from '@/lib/mirror/state';
import {
  DAY_CHECK_MS,
  HINT_MS,
  VERSION_POLL_MS,
  NOTE_LIT_MS,
  PRELOAD_TIMEOUT_MS,
  REFUSED_FLASH_MS,
  SLEEP_AFTER_MS,
  dayKey,
  formatWeather,
  isRepeatedRefusal,
  isStale,
  readDayKey,
} from '@/lib/mirror/timing';
import {
  knownRefusalCount,
  needsVersionReload,
  pendingVersion,
  refusalCountOf,
  refusalReload,
  versionOf,
} from '@/lib/mirror/version';
import type { KeyAction, MirrorItem, Outfit } from '@/lib/types';
import { isOutfitShown } from './display';
import { clearErrorReloads } from './error-screen';
import { startGestureCamera, type CameraFrame, type CameraState, type GestureCamera } from './gestures/camera';
import { CameraLine } from './gestures/camera-line';
import { GestureDebug, type DebugSnapshot } from './gestures/gesture-debug';
import { HoldRing } from './gestures/hold-ring';
import { createStore, useStore, type Store } from './gestures/store';
import { FistIcon, ScrollIcon, ThumbUpIcon, UpDownIcon, VictoryIcon } from './icons';
import { KeyTestScreen } from './key-test-screen';
import { getMirrorQueue, startQueueRunner } from './mirror-queue';
import { OutfitView } from './outfit-view';
import { preloadImages, preloadOutfits, retainImages } from './preload';
import { SleepClock } from './sleep-clock';

// Écran miroir de la tablette (docs/conception.md §4, §5, §7 bis). Tout se décide dans le navigateur, à partir
// des données gardées en mémoire : changer le haut, le bas ou la veste, accepter et refuser
// n'attendent jamais le réseau, les enregistrements partent ensuite par la file d'envoi.
// Il se commande avec les bras (caméra frontale, MediaPipe sur l'appareil : gestures/camera.ts) ;
// les touches de PC restent en secours. Quelqu'un devant le miroir le tient éveillé et le réveille.

/** Assemblages gardés en mémoire : ceux affichés récemment et leurs voisins (docs/conception.md §7 bis). */
const RECENT_SILHOUETTES = 12;
/** Décodage de toutes les photos en arrière-plan, sans bloquer l'écran. */
const ALL_IMAGES_TIMEOUT_MS = 60_000;

/** Retours en texte (docs/conception.md §4) et leur délai d'effacement. */
const FLASH_MS: Record<FlashField, number> = { hint: HINT_MS, noteLit: NOTE_LIT_MS, refusedFlash: REFUSED_FLASH_MS };

/**
 * Sans session, un lien à toucher (la tablette se connecte une fois, avant d'être montée) : la
 * page de connexion ramène au miroir (`depuis=miroir`).
 */
const SIGN_IN_HREF = '/connexion?depuis=miroir';

const PROBLEM_TEXT: Record<LoadProblem, string> = {
  unauthenticated: 'Tablette non connectée',
  forbidden: "Ce compte n'a pas accès à Mon Dressing",
  unconfigured: "Mon Dressing n'est pas encore configuré",
  unreachable: 'Serveur injoignable, nouvel essai dans un instant',
};

declare global {
  interface Window {
    /** ?gestures=debug seulement : le store de l'anneau de progression (tests e2e). */
    monDressingGestures?: { hold: Store<HoldView | null> };
  }
}

/** Ce qui change à chaque image de la caméra, lu par les seuls composants qui l'affichent. */
type GestureStores = {
  hold: Store<HoldView | null>;
  camera: Store<CameraState>;
  debug: Store<DebugSnapshot | null>;
};

const CAMERA_OFF: CameraState = { status: 'off', delegate: null };

function createGestureStores(): GestureStores {
  return {
    hold: createStore<HoldView | null>(null, sameHold),
    camera: createStore(CAMERA_OFF, (a, b) => a.status === b.status && a.delegate === b.delegate),
    debug: createStore<DebugSnapshot | null>(null),
  };
}

/** Un dernier geste reconnu reste affiché par le debug ce temps-là (le Gesture Recognizer tourne à 10 images/s au plus). */
const RECOGNIZED_SHOWN_MS = 500;

/** ?gestures=debug : zones, mains et mesures sur le miroir, pour régler les seuils (docs/conception.md §5). */
function readGesturesDebug(): boolean {
  return new URLSearchParams(window.location.search).get('gestures') === 'debug';
}

const noSubscription = () => () => {};

export function Mirror() {
  const [state, setState] = useState<MirrorState>(initialMirrorState);
  // Source de vérité des gestionnaires d'événements : deux touches rapprochées voient chacune
  // l'état laissé par la précédente, sans attendre le rendu.
  const stateRef = useRef(state);
  const [gestureStores] = useState(createGestureStores);
  const debugGestures = useSyncExternalStore(noSubscription, readGesturesDebug, () => false);
  const cameraState = useStore(gestureStores.camera, CAMERA_OFF);

  useEffect(() => {
    let disposed = false;
    let loading = false;
    /** Une lecture demandée pendant une autre : elle part dès que la première est finie. */
    let reloadAfter = false;
    /**
     * Nombre de choix faits ici (« Recommencer », « oui ») : une lecture commencée avant l'un d'eux
     * est jetée, le serveur l'a peut-être reçu ou non avant de répondre.
     */
    let choiceSeq = 0;
    let lastDayKey: string | null = null;
    let sleepTimer = 0;
    let messageTimer = 0;
    const flashTimers: Record<FlashField, number> = { hint: 0, noteLit: 0, refusedFlash: 0 };
    /**
     * Heure (event.timeStamp, horloge monotone) du dernier « non » pris en compte : un second dans
     * les 300 ms est ignoré. L'heure de l'appareil peut reculer (resynchronisation) : elle bloquerait
     * les « non » suivants.
     */
    let lastRefusalAt = Number.NEGATIVE_INFINITY;
    /** Le toucher qui vient de réveiller l'écran : son clic n'ouvre rien (lien apparu sous le doigt). */
    let swallowClick = false;
    /** Empreinte de GET /api/miroir/touches qui a demandé la prochaine relecture. */
    let requestedVersion: string | null = null;
    /** Dernière empreinte de /touches pour laquelle une relecture a réussi (needsVersionReload). */
    let settledVersion: string | null = null;
    /** Nombre de refus de /touches qui a demandé la prochaine relecture (refusalReload). */
    let requestedRefusals: number | null = null;
    /** Nombre de refus pour lequel une relecture a réussi sans accorder les comptes (refusalReload). */
    let settledRefusals: number | null = null;
    const queue = getMirrorQueue();
    const stopQueue = startQueueRunner(queue);
    const params = new URLSearchParams(window.location.search);
    const gesturesDebug = params.get('gestures') === 'debug';
    // ?gestures=debug seulement : l'anneau de progression peut être dessiné à la main, sans geste
    // (tests e2e : la fausse caméra ne montre qu'une mire, aucun pouce).
    if (gesturesDebug) window.monDressingGestures = { hold: gestureStores.hold };
    /** ?touches=test : le test des touches s'ouvre une fois les données lues (docs/conception.md §5). */
    let keyTestFromUrl = params.get('touches') === 'test';
    /** Caméra et gestes (docs/conception.md §5), lancés après la première lecture. */
    let camera: GestureCamera | null = null;
    /** performance.now() de la dernière image où la présence a repoussé la veille. */
    let lastPresenceAt = Number.NEGATIVE_INFINITY;
    let lastRecognized: { value: { category: string; score: number }; t: number } | null = null;
    let lastGestureAction: GestureAction | null = null;

    const scheduleSleep = () => {
      window.clearTimeout(sleepTimer);
      sleepTimer = window.setTimeout(() => {
        commit(fallAsleep(stateRef.current));
        // Rien ne part pendant la veille : les gestes commencés sont oubliés.
        camera?.disarm();
      }, SLEEP_AFTER_MS);
    };

    const commit = (next: MirrorState) => {
      const before = stateRef.current;
      if (disposed || next === before) return;
      stateRef.current = next;
      setState(next);
      // La veille revient 2 min après chaque réveil, quel qu'il soit (touche, quelqu'un qui arrive),
      // 2 min après « Chargement… » (tenue ou écran de problème), et 2 min après l'ouverture du test
      // des touches, même sur un écran déjà éveillé.
      if (
        (before.sleeping && !next.sleeping) ||
        (before.status === 'loading' && next.status !== 'loading') ||
        (!before.keyTest && next.keyTest !== null)
      ) {
        scheduleSleep();
      }
    };

    const pendingKeyMap = () => {
      const body = pendingKeyMapBody(queue.jobs());
      return body === undefined ? null : parseKeyMap(body);
    };

    // La tenue affichée et ses voisines d'une touche (haut, bas, veste), à préparer d'avance.
    const around = (state: MirrorState): Outfit[] => {
      const { browse, payload } = state;
      const shown = currentOutfit(state);
      if (!browse || !payload || !shown) return [];
      const next = neighbours(browse, state.selection)
        .map((selection) => composedOutfit(browse, selection, payload))
        .filter((outfit): outfit is Outfit => outfit !== null);
      return [shown, ...next];
    };

    const silhouetteKeys = (state: MirrorState): string[] =>
      state.payload ? outfitSilhouettes(around(state), state.payload.items).map(silhouetteKey) : [];

    // En arrière-plan, après chaque changement : les assemblages voisins sont dessinés d'avance ;
    // on garde les plus récents (RECENT_SILHOUETTES), les autres sont oubliés. Ceux que prépare une
    // lecture en cours (`pinned`, aux nouvelles URL) restent : une touche pendant l'attente ne les
    // efface pas.
    let recent: string[] = [];
    let pinned: string[] = [];
    const prepareAround = (state: MirrorState) => {
      const payload = state.payload;
      if (!payload) return;
      recent = [...new Set([...silhouetteKeys(state), ...recent])].slice(0, RECENT_SILHOUETTES);
      retainSilhouettes([...recent, ...pinned]);
      void preloadOutfits(around(state), payload.items, PRELOAD_TIMEOUT_MS);
    };

    const run = (transition: Transition) => {
      const before = stateRef.current;
      let next = transition.state;
      const payload = next.payload;
      if (transition.rebuild && payload) {
        // « Recommencer » : listes et point de départ recalculés. Les photos sont déjà décodées
        // (retainImages) ; seul l'assemblage du départ est redessiné.
        next = withBrowse(next, buildBrowse(payload, next.localRefusals));
      }
      commit(next);
      if (next.selection !== before.selection || next.browse !== before.browse) prepareAround(next);
      if (transition.post && isChoiceJob(transition.post)) choiceSeq += 1;
      if (transition.post) queue.push(transition.post);
      const message = next.message;
      if (message && message.id !== before.message?.id) {
        window.clearTimeout(messageTimer);
        messageTimer = window.setTimeout(
          () => commit(clearMessage(stateRef.current, message.id)),
          messageDuration(message),
        );
      }
      // Chaque retour en texte s'efface à son délai, sauf s'il a été remplacé entre-temps.
      for (const field of Object.keys(FLASH_MS) as FlashField[]) {
        const flash = next[field];
        if (!flash || flash.id === before[field]?.id) continue;
        window.clearTimeout(flashTimers[field]);
        flashTimers[field] = window.setTimeout(
          () => commit(clearFlash(stateRef.current, field, flash.id)),
          FLASH_MS[field],
        );
      }
    };

    async function load() {
      if (loading) {
        reloadAfter = true;
        return;
      }
      loading = true;
      // L'empreinte (ou le nombre de refus) qui a demandé cette lecture : réglée si la lecture
      // réussit, sinon redemandée.
      const triggeredBy = requestedVersion;
      const triggeredByRefusals = requestedRefusals;
      requestedVersion = null;
      requestedRefusals = null;
      let settled = false;
      // Avant la lecture : les refus faits ici que le serveur a déjà reçus (plus dans la file). S'il
      // ne les renvoie pas, ils ont été effacés (« Recommencer » sur le téléphone).
      const startedAt = new Date();
      const seqAtStart = choiceSeq;
      const jobsAtStart = queue.jobs();
      const choiceIdsAtStart = jobsAtStart.filter(isChoiceJob).map((job) => job.id);
      const unsent = pendingRefusalIds(jobsAtStart);
      const receivedRefusals = stateRef.current.localRefusals.filter(
        (local) => !unsent.some((ids) => sameIds(ids, local.item_ids)),
      );
      try {
        let response: Response;
        try {
          response = await fetch('/api/miroir', { cache: 'no-store', credentials: 'same-origin' });
        } catch {
          // Pas de réseau : l'écran reste tel quel, avec « · hors ligne » (docs/conception.md §8).
          commit(withNetwork(loadFailed(stateRef.current, 'unreachable'), true));
          return;
        }
        commit(withNetwork(stateRef.current, false));
        if (!response.ok) {
          commit(loadFailed(stateRef.current, problemForStatus(response.status)));
          return;
        }
        const received: unknown = await response.json();
        if (!isMirrorPayload(received)) {
          commit(loadFailed(stateRef.current, 'unreachable'));
          return;
        }
        // Un choix parti pendant la lecture : on ne sait pas si le serveur l'avait reçu avant de
        // répondre (ni ce qui l'a suivi), on relit.
        if (choiceIdsAtStart.some((id) => !queue.jobs().some((job) => job.id === id))) {
          reloadAfter = true;
          return;
        }
        // Choix encore dans la file : le serveur renvoie l'ancien choix (et les anciens refus), et
        // l'empreinte d'avant ce choix.
        const choices = pendingChoices(queue.jobs());
        const payload = pendingPayload(received, choices);
        const localRefusals = stateRef.current.localRefusals.filter(
          (local) => !receivedRefusals.some((sent) => sameIds(sent.item_ids, local.item_ids)),
        );
        // La tenue à afficher et ses voisines sont prêtes avant d'être affichées (docs/conception.md §7 bis) ;
        // toutes les autres photos se décodent ensuite en arrière-plan.
        const browse = buildBrowse(payload, localRefusals);
        const version = pendingVersion(versionOf(received), choices, received.targetDate);
        const preview = () =>
          loaded(stateRef.current, payload, browse, Date.now(), pendingKeyMap(), receivedRefusals, version);
        const first = preview();
        pinned = silhouetteKeys(first);
        await preloadOutfits(around(first), payload.items, PRELOAD_TIMEOUT_MS);
        if (disposed) return;
        // Des touches pendant l'attente ont changé la tenue : on prépare aussi la nouvelle, jusqu'à
        // ce qu'elle ne bouge plus, PRELOAD_TIMEOUT_MS de plus au total.
        const deadline = Date.now() + PRELOAD_TIMEOUT_MS;
        let prepared = first;
        for (;;) {
          const next = preview();
          if (currentOutfit(next)?.key === currentOutfit(prepared)?.key || Date.now() >= deadline) break;
          prepared = next;
          pinned = [...pinned, ...silhouetteKeys(next)];
          await preloadOutfits(around(next), payload.items, Math.max(0, deadline - Date.now()));
          if (disposed) return;
        }
        // Un choix pendant la lecture : ces données sont peut-être d'avant, on relit.
        if (choiceSeq !== seqAtStart) {
          reloadAfter = true;
          return;
        }

        commit(preview());
        settled = true;
        // ?touches=test : seule façon d'ouvrir le test des touches (plus de manette, docs/conception.md §5). Il
        // quitte l'adresse dès l'ouverture : un rechargement de la page (écran de secours) ne le
        // rouvre pas. Une tablette sans clavier laissée sur le test en sort à la relecture suivante
        // de 18 h, minuit ou 4 h, une fois en veille (loaded).
        if (keyTestFromUrl) {
          keyTestFromUrl = false;
          commit(openKeyTest(stateRef.current));
          forgetKeyTestUrl();
        }
        if (triggeredBy !== null) settledVersion = triggeredBy;
        if (triggeredByRefusals !== null) settledRefusals = triggeredByRefusals;
        // D'abord la tenue affichée et ses voisines, puis toutes les pièces que le miroir dessine
        // (ni chaussures ni accessoires), les plus proches d'abord.
        pinned = [];
        recent = [];
        prepareAround(stateRef.current);
        // Une photo partagée par deux pièces partage aussi ses couches : chaque URL une fois. Les
        // couches d'un haut dépendent des bas avec lesquels il peut s'assembler.
        const urls = [
          ...new Set(
            itemsByProximity(browse, stateRef.current.selection).flatMap((item) => itemImageUrls(item, browse.bottoms)),
          ),
        ];
        retainImages(urls);
        void preloadImages(urls, ALL_IMAGES_TIMEOUT_MS);
        lastDayKey = readDayKey(payload.today, payload.targetDate, startedAt, payload.timezone);
      } catch {
        commit(loadFailed(stateRef.current, 'unreachable'));
      } finally {
        loading = false;
        pinned = [];
        if (!settled) {
          requestedVersion ??= triggeredBy;
          requestedRefusals ??= triggeredByRefusals;
        }
        // La caméra après la première lecture, quelle qu'en soit l'issue : ses modèles ne retardent
        // pas les photos de la première tenue, et quelqu'un qui arrive réveille aussi un écran de
        // problème.
        startCamera();
        if (reloadAfter && !disposed) {
          reloadAfter = false;
          void load();
        }
      }
    }

    /** La tenue de la légende est-elle à l'écran (sa silhouette dessinée, ou ses pièces) ? */
    const isCurrentShown = (state: MirrorState): boolean => {
      const outfit = currentOutfit(state);
      return !outfit || !state.payload || isOutfitShown(outfit, itemsById(state.payload.items));
    };

    /**
     * Une action, d'une touche ou d'un geste (docs/conception.md §5), sur la composition éveillée : les mêmes
     * garde-fous pour les deux. `now` : event.timeStamp ou performance.now(), la même horloge
     * monotone (l'heure de l'appareil peut reculer).
     */
    const perform = (action: KeyAction, now: number) => {
      const current = stateRef.current;
      // « Oui » et « non » valent pour ce qu'on voit (docs/conception.md §6) : tant que la silhouette de la
      // légende n'est pas dessinée (l'ancienne est encore à l'écran), ils ne font rien. Les flèches
      // et la veste restent libres. Pendant un message de « Recommencer » ou « Touches enregistrées »
      // (tenue cachée), ils l'effacent seulement (applyAction).
      // Les gestes tenus « oui » et « non » ne commencent même pas dans ce cas (disabledHolds).
      if ((action === 'accept' || action === 'refuse') && confirmWaits(current, () => isCurrentShown(current))) return;
      const hidden = messageHidesOutfit(current.message);
      // Un second « non » dans les 300 ms (double appui) n'écarte pas une deuxième tenue.
      if (action === 'refuse' && !hidden && isRepeatedRefusal(lastRefusalAt, now)) return;
      const transition = applyAction(current, action);
      if (action === 'refuse' && transition.post) lastRefusalAt = now;
      run(transition);
    };

    /**
     * Réveil (touche, toucher, quelqu'un qui arrive) : rien d'autre (docs/conception.md §5), et les gestes
     * commencés sont oubliés jusqu'à ce qu'ils soient relâchés : un pouce déjà levé, ou une main
     * déjà devant la poitrine, ne fait rien. Des données vieilles de plus de 10 min sont relues.
     */
    const wakeUp = (current: MirrorState) => {
      scheduleSleep();
      commit(wake(current));
      camera?.disarm();
      if (current.status === 'ready' && isStale(current.loadedAt, Date.now())) void load();
    };

    /** ?touches=test retiré de l'adresse dès l'ouverture du test : un rechargement ne le rouvre pas. */
    function forgetKeyTestUrl() {
      const url = new URL(window.location.href);
      if (url.searchParams.get('touches') !== 'test') return;
      url.searchParams.delete('touches');
      window.history.replaceState(null, '', url);
    }

    const onKeyDown = (event: KeyboardEvent) => {
      swallowClick = false;
      const current = stateRef.current;
      // Pendant « Chargement… », rien ; ensuite chaque touche repousse la veille de 2 min, aussi
      // pendant le test des touches et sur un écran de problème.
      if (current.status === 'loading' || event.repeat) return;
      scheduleSleep();

      if (current.sleeping) {
        // La touche qui réveille ne fait rien d'autre (docs/conception.md §5) : ni action, ni touche du test.
        event.preventDefault();
        wakeUp(current);
        return;
      }
      // Écran de problème : le nouvel essai part toutes les 30 s, une touche ne fait rien d'autre.
      if (current.status !== 'ready') return;
      // Raccourcis du navigateur (Ctrl+R…) : on laisse passer.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const input = { code: event.code ?? '', key: event.key ?? '' };
      if (current.keyTest) {
        event.preventDefault();
        run(keyTestKey(current, input));
        return;
      }
      const action = resolveKey(input, current.keyMap);
      if (!action) {
        // Une touche sans action annule aussi « Appuie encore pour recommencer », et efface la
        // phrase d'une touche sans effet.
        if (!MODIFIER_KEYS.has(input.key)) commit(unmappedKey(current));
        return;
      }
      event.preventDefault();
      perform(action, event.timeStamp);
    };

    /**
     * Une image analysée par la caméra (docs/conception.md §5) : quelqu'un qui arrive réveille l'écran, et cette
     * image ne fait rien d'autre ; la présence repousse la veille ; les gestes font exactement ce
     * que font leurs touches, seulement sur la composition éveillée.
     */
    const onGestureFrame = (frame: CameraFrame) => {
      const current = stateRef.current;
      const effect = gestureEffect(current, frame.output);
      if (effect.disarm) camera?.disarm();
      gestureStores.hold.set(effect.hold);
      if (frame.output.recognized) lastRecognized = { value: frame.output.recognized, t: frame.t };
      if (effect.wake) {
        lastPresenceAt = frame.t;
        wakeUp(current);
      } else {
        if (effect.activity && frame.t - lastPresenceAt >= PRESENCE_ACTIVITY_MS) {
          lastPresenceAt = frame.t;
          scheduleSleep();
        }
        for (const action of effect.actions) {
          lastGestureAction = action;
          perform(action, frame.t);
        }
      }
      if (gesturesDebug) {
        const recognized = lastRecognized && frame.t - lastRecognized.t <= RECOGNIZED_SHOWN_MS ? lastRecognized.value : null;
        gestureStores.debug.set({ frame, recognized, lastAction: lastGestureAction });
      }
    };

    function startCamera() {
      if (camera || disposed) return;
      camera = startGestureCamera({
        onFrame: onGestureFrame,
        onStatus: (status) => {
          gestureStores.camera.set(status);
          if (status.status !== 'running') gestureStores.hold.set(null);
        },
        // « Oui » et « non » attendent la silhouette de la légende : leur anneau ne se remplit pas
        // pour rien, le maintien commence une fois qu'elle est dessinée.
        disabledHolds: () => {
          const current = stateRef.current;
          return disabledHolds(current, () => isCurrentShown(current));
        },
      });
    }

    // Avant que la tablette soit montée (écran « Tablette non connectée »), un toucher réveille
    // aussi l'écran, et ne fait rien d'autre, comme la touche qui réveille (docs/conception.md §5). Écran éveillé,
    // le toucher suit son cours (lien « Se connecter »).
    const onPointerDown = (event: PointerEvent) => {
      swallowClick = false;
      const current = stateRef.current;
      if (current.status === 'loading' || !current.sleeping) return;
      event.preventDefault();
      swallowClick = true;
      wakeUp(current);
    };
    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    /** Un choix fait ici (« Recommencer », « oui ») que le serveur n'a pas encore. */
    const choicePending = () => queue.jobs().some(isChoiceJob);

    // Toutes les 30 s : nouvel essai si les données manquent ; sinon, le téléphone a-t-il changé les
    // données (empreinte) ou effacé des refus ? Un changement fait sur le téléphone arrive ainsi sur
    // le miroir en 30 s au plus, même en veille (docs/conception.md §4).
    const pollTimer = window.setInterval(async () => {
      const current = stateRef.current;
      if (current.status !== 'ready') {
        void load();
        return;
      }
      if (current.keyTest || pendingKeyMap()) return;
      // Avant l'appel : un choix encore en route, ou fait pendant l'appel, rend la réponse peut-être
      // plus vieille que l'écran ; les refus connus sont comptés sans ceux qui partiront pendant.
      const seqAtStart = choiceSeq;
      const choiceAtStart = choicePending();
      const known = current.payload
        ? knownRefusalCount(current.payload.refusals, current.localRefusals, pendingRefusalIds(queue.jobs()))
        : null;
      let response: Response;
      try {
        response = await fetch('/api/miroir/touches', { cache: 'no-store', credentials: 'same-origin' });
      } catch {
        // Pas de réseau : « · hors ligne », on réessaiera.
        commit(withNetwork(stateRef.current, true));
        return;
      }
      commit(withNetwork(stateRef.current, false));
      if (!response.ok) return;
      try {
        const body: unknown = await response.json();
        const latest = stateRef.current;
        if (latest.keyTest || choiceAtStart || choiceSeq !== seqAtStart || choicePending() || known === null) return;
        const version = versionOf(body);
        const refusals = refusalCountOf(body);
        const versionChanged = needsVersionReload(latest.version, version, settledVersion);
        // Seul le téléphone efface des refus : s'il en compte moins que la tablette, on relit.
        const refusalCheck = refusalReload(known, refusals, settledRefusals);
        settledRefusals = refusalCheck.settled;
        if (versionChanged || refusalCheck.reload) {
          if (versionChanged) requestedVersion = version;
          if (refusalCheck.reload) requestedRefusals = refusals;
          void load();
        }
      } catch {
        // Réponse illisible : on réessaiera.
      }
    }, VERSION_POLL_MS);

    // Chaque minute : passage de minuit, de 4 h (préchargement du matin) ou de l'heure du soir →
    // nouvelles données (tenues, URL signées, météo). Sans réseau à minuit, la tablette corrige
    // elle-même « Demain » en attendant (withDeviceDay).
    const dayTimer = window.setInterval(() => {
      commit(withDeviceDay(stateRef.current, Date.now()));
      const payload = stateRef.current.payload;
      if (!payload || lastDayKey === null) return;
      if (dayKey(new Date(), payload.timezone, payload.eveningHour) !== lastDayKey) void load();
    }, DAY_CHECK_MS);

    // Retour du réseau (docs/conception.md §8) : on relit, ce qui redemande aussi les images ratées pendant la
    // coupure (nouvelles URL). « · hors ligne » s'en va à la première réponse.
    const onOnline = () => {
      void load();
    };
    const onOffline = () => commit(withNetwork(stateRef.current, true));

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('click', onClick, true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (!navigator.onLine) onOffline();
    void load();

    return () => {
      disposed = true;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearTimeout(sleepTimer);
      window.clearTimeout(messageTimer);
      for (const timer of Object.values(flashTimers)) window.clearTimeout(timer);
      window.clearInterval(pollTimer);
      window.clearInterval(dayTimer);
      stopQueue();
      // La caméra est rendue (une seule partie de l'app la tient).
      camera?.stop();
      gestureStores.hold.set(null);
      if (window.monDressingGestures?.hold === gestureStores.hold) delete window.monDressingGestures;
    };
  }, [gestureStores]);

  const payload = state.payload;
  const byId = useMemo(() => itemsById(payload?.items ?? []), [payload]);

  // Une tenue s'affiche : le miroir est revenu, l'écran de secours repartira de 30 s (docs/conception.md §8).
  const showsOutfit = state.status === 'ready' && !state.sleeping && !state.keyTest && currentOutfit(state) !== null;
  useEffect(() => {
    if (showsOutfit) clearErrorReloads();
  }, [showsOutfit]);

  return (
    <main
      data-screen="mirror"
      data-camera={cameraState.status}
      aria-busy={state.status === 'loading'}
      className="flex h-dvh w-full flex-col items-center overflow-hidden bg-black px-10 text-white"
    >
      <MirrorContent state={state} byId={byId} gestures={gestureStores} />
      {debugGestures && <GestureDebug debug={gestureStores.debug} camera={gestureStores.camera} />}
    </main>
  );
}

function MirrorContent({
  state,
  byId,
  gestures,
}: {
  state: MirrorState;
  byId: ReadonlyMap<string, MirrorItem>;
  gestures: GestureStores;
}) {
  const payload = state.payload;
  // Au démarrage (jusqu'à 8 s de préchargement), un mot plutôt qu'un écran noir qui paraît éteint.
  if (state.status === 'loading') {
    return (
      <p data-testid="mirror-loading" className="m-auto text-center text-mirror-sm text-mirror-dim">
        Chargement…
      </p>
    );
  }
  // Veille (docs/conception.md §4) : aussi pendant le test des touches et sur un écran de problème ; sans données,
  // l'heure est celle du fuseau de l'appareil.
  if (state.sleeping) return <SleepClock timeZone={payload?.timezone ?? null} />;
  if (state.status !== 'ready' || !payload) {
    const problem = state.status === 'ready' ? 'unreachable' : state.status;
    return (
      <div className="m-auto flex max-w-[720px] flex-col items-center gap-2 text-center">
        <p data-testid="mirror-status" className="text-mirror-sm text-mirror-dim">
          {PROBLEM_TEXT[problem]}
        </p>
        {/* Une adresse ordinaire, sans préchargement : texte blanc sur noir, sans cadre. */}
        {problem === 'unauthenticated' && (
          <a href={SIGN_IN_HREF} className="flex min-h-11 items-center text-mirror-sm text-mirror-ink">
            Se connecter
          </a>
        )}
      </div>
    );
  }
  if (state.keyTest) return <KeyTestScreen test={state.keyTest} />;

  const outfit = currentOutfit(state);
  const hidesOutfit = messageHidesOutfit(state.message);
  // « Demain · mercredi 30 septembre · hors ligne » ne tient pas sur 720 px en 40 px : pendant la
  // coupure, cette ligne-là passe en 32 px, dans la même hauteur de 48 px.
  const compactDay = state.offline && payload.isTomorrow;

  return (
    <>
      {/* Lisible à 1–2 m derrière la vitre : la date sur une ligne, puis la météo, le plus gros texte.
          Ce qui va mal (pas de météo, pas de réseau, caméra refusée ou occupée, gestes
          indisponibles) s'écrit en petit, sans déplacer la silhouette. Les 24 px du bas de l'en-tête
          (156 px en tout) gardent la place de la ligne de la caméra au-dessus de la toile : elle ne
          touche jamais la tête. */}
      <header className="flex flex-col items-center pt-6 pb-6 text-center">
        <p
          data-testid="mirror-day"
          className={`text-mirror-ink ${compactDay ? 'text-mirror-sm leading-[48px]' : 'text-mirror-md'}`}
        >
          {payload.isTomorrow && <span data-testid="mirror-tomorrow">Demain · </span>}
          <MirrorDate isoDate={payload.targetDate} afterWord={payload.isTomorrow} />
          {state.offline && (
            <span data-testid="mirror-offline" className="text-mirror-sm text-mirror-dim">
              {' · hors ligne'}
            </span>
          )}
        </p>
        {/* Sans météo, les tenues supposent 16° sans pluie : on le dit plutôt que de laisser un blanc. */}
        <div className="relative">
          <p
            data-testid="mirror-weather"
            className={
              payload.weather ? 'text-mirror-lg text-mirror-ink' : 'text-mirror-sm leading-[60px] text-mirror-dim'
            }
          >
            {payload.weather ? formatWeather(payload.weather) : 'Météo indisponible'}
          </p>
          <CameraLine camera={gestures.camera} />
        </div>
      </header>

      {/* « Recommencer » et « Touches enregistrées » cachent la tenue ; « Bonne journée » et « Prête
          pour demain » prennent seulement la place de sa légende. */}
      {state.message && hidesOutfit ? (
        <p data-testid="mirror-message" role="status" className="m-auto text-center text-mirror-xl text-mirror-ink">
          {state.message.text}
        </p>
      ) : outfit ? (
        <OutfitView
          outfit={outfit}
          itemsById={byId}
          mark={currentMark(state)}
          hint={state.hint?.text ?? null}
          noteLit={state.noteLit !== null}
          message={state.message?.text ?? null}
        />
      ) : (
        <p data-testid="mirror-empty" className="m-auto text-center text-mirror-md text-mirror-ink">
          Aucune tenue disponible
        </p>
      )}

      {outfit && !hidesOutfit && (
        <Controls
          jacket={(state.browse?.jackets.length ?? 0) > 0}
          refused={state.refusedFlash !== null}
          hold={gestures.hold}
        />
      )}
    </>
  );
}

/**
 * « ← → haut  ↑ ↓ bas  V veste  oui  non », avec des icônes au trait assez grandes pour la distance
 * (docs/conception.md §4). « veste » et son V, seulement les jours où une veste propre peut être proposée.
 * Pendant un geste tenu, son anneau de progression entoure son icône (HoldRing) : 16 px entre le
 * V, le pouce ou le poing et son mot, pour que l'anneau (6 px de plus que l'icône de chaque côté)
 * reste à 10 px du mot ; 12 px après les flèches, sans anneau ; 22 px entre les groupes. Juste après
 * un « non », « écartée » prend la place du poing et de « non », centré sur eux : le groupe est plus
 * large que le mot, rien ne bouge et rien ne sort de la zone utile (40 à 760 px), V compris.
 */
function Controls({ jacket, refused, hold }: { jacket: boolean; refused: boolean; hold: Store<HoldView | null> }) {
  return (
    <footer data-testid="mirror-controls" className="flex items-center gap-5.5 pt-6 pb-10 text-mirror-sm text-mirror-dim">
      <span className="flex items-center gap-3">
        <ScrollIcon size={40} />
        haut
      </span>
      <span className="flex items-center gap-3">
        <UpDownIcon size={40} />
        bas
      </span>
      {jacket && (
        <span data-testid="mirror-controls-jacket" className="flex items-center gap-4">
          <span className="relative flex">
            <VictoryIcon size={40} />
            <HoldRing store={hold} action="jacket" />
          </span>
          veste
        </span>
      )}
      <span className="flex items-center gap-4">
        <span className="relative flex">
          <ThumbUpIcon size={40} />
          <HoldRing store={hold} action="accept" />
        </span>
        oui
      </span>
      <span className="relative flex items-center gap-4">
        <span className={`relative flex ${refused ? 'invisible' : ''}`}>
          <FistIcon size={40} />
          <HoldRing store={hold} action="refuse" />
        </span>
        <span className={refused ? 'invisible' : ''}>non</span>
        <span
          data-testid="mirror-controls-refused"
          aria-hidden={!refused}
          className={`absolute inset-0 flex items-center justify-center whitespace-nowrap text-mirror-ink ${refused ? '' : 'invisible'}`}
        >
          écartée
        </span>
      </span>
    </footer>
  );
}
