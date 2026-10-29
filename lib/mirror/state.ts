import { parseKeyMap } from '@/lib/keys/parse';
import { keyTestInput, startKeyTest, type KeyTestState } from '@/lib/keys/capture';
import type { KeyInput } from '@/lib/keys/resolve';
import type { HistoryEntry, KeyAction, KeyMap, MirrorPayload, Outfit, Refusal } from '@/lib/types';
import {
  EMPTY_SELECTION,
  afterRefusal,
  changesOnlyHidden,
  composedIds,
  composedOutfit,
  cycleJacket,
  drawnPlanIds,
  isDress,
  isRefused,
  moveBottom,
  moveTop,
  selectionOf,
  type Browse,
  type Selection,
} from './browse';
import { sameIds, sortedIds } from './deck';
import { MAX_NAMED_REFUSALS, type PendingChoice, type QueueRequest } from './queue';
import { targetDay } from '@/lib/dates';
import { MESSAGE_MS, RESTART_DONE_MS, dayKey } from './timing';
import { withPlanVersion } from './version';

// État de l'écran miroir : machine à états pure. Le composant applique les transitions, envoie
// les requêtes qu'elles renvoient (`post`) dans la file, et ne fait jamais attendre l'écran.

export type LoadProblem = 'unauthenticated' | 'forbidden' | 'unconfigured' | 'unreachable';
export type MirrorStatus = 'loading' | LoadProblem | 'ready';

/**
 * `accepted` : « Bonne journée » ou « Prête pour demain », à la place de la légende de la tenue,
 * qui reste affichée.
 * `restart-confirm` : « Appuie encore pour recommencer », un second appui confirme.
 * `restart-done` : « On recommence ».
 * `keys-saved` : « Touches enregistrées », à la fin du test des touches.
 * Pendant ces trois derniers, la tenue est cachée (et, après le test, pas encore vue).
 */
export type MirrorMessage = {
  id: number;
  text: string;
  kind: 'accepted' | 'restart-confirm' | 'restart-done' | 'keys-saved';
};

function isRestartMessage(message: MirrorMessage | null): boolean {
  return message?.kind === 'restart-confirm' || message?.kind === 'restart-done';
}

/** Ce message cache-t-il la tenue (« Recommencer », « Touches enregistrées ») ? */
export function messageHidesOutfit(message: MirrorMessage | null): boolean {
  return message !== null && message.kind !== 'accepted';
}

/** Durée d'affichage d'un message : « On recommence » 1,5 s, les autres 3 s (docs/conception.md §4). */
export function messageDuration(message: MirrorMessage): number {
  return message.kind === 'restart-done' ? RESTART_DONE_MS : MESSAGE_MS;
}

/** Retours en texte de quelques secondes, effacés par leur délai (mirror.tsx) ou la touche suivante. */
export type FlashField = 'hint' | 'noteLit' | 'refusedFlash';

export type MirrorState = {
  status: MirrorStatus;
  payload: MirrorPayload | null;
  /** Date.now() de la dernière lecture réussie des données. */
  loadedAt: number;
  /** Ce qu'on parcourt (composition libre, docs/conception.md §4) ; null avant les données ou pendant un recalcul. */
  browse: Browse | null;
  /** Haut, bas et veste affichés. */
  selection: Selection;
  /** Refus faits sur la tablette, gardés jusqu'à ce que le serveur les renvoie. */
  localRefusals: Refusal[];
  keyMap: KeyMap;
  keyTest: KeyTestState | null;
  message: MirrorMessage | null;
  /** Compteur des messages et des retours en texte : chacun a son id, pour être effacé à son délai. */
  messageSeq: number;
  /** Pourquoi la dernière touche n'a rien changé (« Une robe se porte sans bas »), HINT_MS. */
  hint: { id: number; text: string } | null;
  /** La dernière touche n'a changé que la pièce cachée : « Sous la veste : … » éclairée, NOTE_LIT_MS. */
  noteLit: { id: number } | null;
  /** Juste après un « non » : « écartée » à la place de « non » dans la légende, REFUSED_FLASH_MS. */
  refusedFlash: { id: number } | null;
  sleeping: boolean;
  /** Empreinte des données affichées (GET /api/miroir) ; null si le serveur n'en a pas donné. */
  version: string | null;
  /**
   * Hors ligne (docs/conception.md §8) : le navigateur le dit, ou le dernier appel (vérification de 30 s,
   * relecture) a échoué faute de réseau. Faux dès qu'un appel reçoit une réponse.
   */
  offline: boolean;
};

export type Transition = {
  state: MirrorState;
  /** Requête à mettre dans la file d'envoi. */
  post?: QueueRequest;
  /** « Recommencer » : recalculer les listes et le point de départ (withBrowse). */
  rebuild?: boolean;
};

export const ACCEPT_MESSAGES = { today: 'Bonne journée', tomorrow: 'Prête pour demain' } as const;
export const RESTART_MESSAGES = { confirm: 'Appuie encore pour recommencer', done: 'On recommence' } as const;
export const KEYS_SAVED_MESSAGE = 'Touches enregistrées';

/** Ligne d'état sous la légende (docs/conception.md §4), dans cet ordre de priorité. */
export const OUTFIT_MARKS = { chosen: 'Choisie', planned: 'Prévue', refused: 'Écartée' } as const;

/** Pourquoi une touche ou un geste ne change rien (docs/conception.md §4) : l'appui ou le geste a bien été reçu. */
export const NO_EFFECT_HINTS = {
  dress: 'Une robe se porte sans bas',
  noJacket: 'Aucune veste propre',
  oneTop: 'Un seul haut propre',
  oneDress: 'Une seule robe propre',
  oneBottom: 'Un seul bas propre',
} as const;

export const initialMirrorState: MirrorState = {
  status: 'loading',
  payload: null,
  loadedAt: 0,
  browse: null,
  selection: EMPTY_SELECTION,
  localRefusals: [],
  keyMap: {},
  keyTest: null,
  message: null,
  messageSeq: 0,
  hint: null,
  noteLit: null,
  refusedFlash: null,
  sleeping: false,
  version: null,
  offline: false,
};

/** Réponse HTTP de GET /api/miroir → problème affiché par la tablette. */
export function problemForStatus(status: number): LoadProblem {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 503) return 'unconfigured';
  return 'unreachable';
}

/** Vérification légère de la réponse de GET /api/miroir. */
export function isMirrorPayload(value: unknown): value is MirrorPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.today === 'string' &&
    typeof payload.targetDate === 'string' &&
    typeof payload.timezone === 'string' &&
    typeof payload.eveningHour === 'number' &&
    typeof payload.isTomorrow === 'boolean' &&
    Array.isArray(payload.items) &&
    Array.isArray(payload.history) &&
    Array.isArray(payload.refusals)
  );
}

/** La tenue composée affichée, ou null (pas encore de données, aucune pièce). */
export function currentOutfit(state: MirrorState): Outfit | null {
  if (!state.browse || !state.payload) return null;
  return composedOutfit(state.browse, state.selection, state.payload);
}

/** La tenue affichée a déjà été refusée (« Écartée ») : par le serveur ou sur cette tablette. */
export function isCurrentRefused(state: MirrorState): boolean {
  const outfit = currentOutfit(state);
  if (!outfit || !state.payload) return false;
  return isRefused(outfit, state.payload.refusals) || isRefused(outfit, state.localRefusals);
}

/**
 * La tenue affichée est celle acceptée ce matin (« Choisie ») : la tenue portée
 * aujourd'hui, comparée sur ses pièces composées (sans chaussures ni accessoires).
 */
export function isCurrentChosen(state: MirrorState): boolean {
  const outfit = currentOutfit(state);
  const payload = state.payload;
  if (!outfit || !payload || payload.targetDate !== payload.today) return false;
  return payload.history.some(
    (entry) => entry.date === payload.today && sameIds(drawnPlanIds(entry.item_ids, payload.items), outfit.item_ids),
  );
}

/** Ligne d'état sous la légende : « Choisie », sinon « Prévue », sinon « Écartée », sinon rien. */
export function currentMark(state: MirrorState): string | null {
  const outfit = currentOutfit(state);
  if (!outfit) return null;
  if (isCurrentChosen(state)) return OUTFIT_MARKS.chosen;
  if (outfit.planned) return OUTFIT_MARKS.planned;
  return isCurrentRefused(state) ? OUTFIT_MARKS.refused : null;
}

/**
 * Pourquoi cette touche ne change pas la tenue, ou null si elle la change (docs/conception.md §4) : ↑ ↓ avec une
 * robe, la veste sans veste propre, ← → avec un seul haut, ↑ ↓ avec un seul bas.
 */
export function noEffectHint(browse: Browse, selection: Selection, action: KeyAction): string | null {
  switch (action) {
    case 'next':
    case 'previous':
      if (browse.tops.length !== 1) return null;
      return browse.tops[0].category === 'robe' ? NO_EFFECT_HINTS.oneDress : NO_EFFECT_HINTS.oneTop;
    case 'bottomNext':
    case 'bottomPrevious':
      if (isDress(browse, selection)) return NO_EFFECT_HINTS.dress;
      return browse.bottoms.length === 1 ? NO_EFFECT_HINTS.oneBottom : null;
    case 'jacket':
      return browse.jackets.length === 0 ? NO_EFFECT_HINTS.noJacket : null;
    default:
      return null;
  }
}

function withMessage(state: MirrorState, text: string, kind: MirrorMessage['kind']): MirrorState {
  const id = state.messageSeq + 1;
  return { ...state, message: { id, text, kind }, messageSeq: id };
}

function withHint(state: MirrorState, text: string): MirrorState {
  const id = state.messageSeq + 1;
  return { ...state, hint: { id, text }, messageSeq: id };
}

function withFlash(state: MirrorState, field: Exclude<FlashField, 'hint'>): MirrorState {
  const id = state.messageSeq + 1;
  return { ...state, [field]: { id }, messageSeq: id };
}

/** Sans les retours de la touche précédente : chaque touche repart d'un écran sans retour. */
function withoutFlashes(state: MirrorState): MirrorState {
  if (!state.hint && !state.noteLit && !state.refusedFlash) return state;
  return { ...state, hint: null, noteLit: null, refusedFlash: null };
}

/** Un retour en texte arrivé à son délai ; sans effet s'il a été remplacé entre-temps. */
export function clearFlash(state: MirrorState, field: FlashField, id: number): MirrorState {
  return state[field]?.id === id ? { ...state, [field]: null } : state;
}

/** La tenue portée de ce jour-là remplace l'éventuelle précédente (une seule par jour). */
function withHistoryEntry(history: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...history.filter((other) => other.date !== entry.date)];
}

/** Ce qu'envoie « Recommencer » (POST /api/miroir/recommencer). */
export type RestartBody = { date: string; today: string; refused?: string[][] };

/**
 * Les données comme après « Recommencer » (docs/conception.md §4, §5), tant que le serveur ne l'a pas reçu :
 * plus de tenue prévue pour ce jour, plus de tenue portée si c'était aujourd'hui, plus de refus
 * faits pendant ce choix (ceux dont le jour visé est ce jour, et ceux nommés par la tablette).
 * Sans `restart`, celui du jour affiché. Relancée sur ses propres données, elle ne change rien.
 */
export function restartedPayload(
  payload: MirrorPayload,
  restart: RestartBody = { date: payload.targetDate, today: payload.today },
): MirrorPayload {
  const named = restart.refused ?? [];
  return {
    ...payload,
    plan: payload.plan && payload.plan.date === restart.date ? null : payload.plan,
    history:
      restart.date === restart.today ? payload.history.filter((entry) => entry.date !== restart.date) : payload.history,
    refusals: payload.refusals.filter(
      (refusal) => refusal.day !== restart.date && !named.some((ids) => sameIds(ids, refusal.item_ids)),
    ),
  };
}

/**
 * Les données reçues, corrigées des choix encore dans la file, dans l'ordre où le serveur les
 * recevra : « Recommencer » (restartedPayload), « oui » pour aujourd'hui (la tenue portée,
 * « Choisie ») et « oui » pour demain (la tenue prévue).
 */
export function pendingPayload(payload: MirrorPayload, choices: readonly PendingChoice[]): MirrorPayload {
  return choices.reduce((current, choice) => {
    if (choice.kind === 'restart') return restartedPayload(current, choice);
    if (choice.kind === 'history') {
      const entry = { date: choice.date, item_ids: choice.item_ids, title: choice.title };
      return { ...current, history: withHistoryEntry(current.history, entry) };
    }
    if (choice.date !== current.targetDate) return current;
    return { ...current, plan: { date: choice.date, item_ids: choice.item_ids, confirmed: true } };
  }, payload);
}

function samePlan(a: MirrorPayload['plan'], b: MirrorPayload['plan']): boolean {
  if (!a || !b) return a === b;
  return a.date === b.date && sameIds(a.item_ids, b.item_ids);
}

/**
 * « Recommencer » : un premier appui demande confirmation (3 s, MESSAGE_MS) ; le second efface le
 * choix et les refus faits pendant ce choix, puis revient au point de départ (le composant recalcule
 * les listes : rebuild). Les refus faits ici et peut-être
 * encore en file sont nommés dans la requête : le serveur les reçoit avant elle (file dans l'ordre).
 */
function restart(state: MirrorState, payload: MirrorPayload): Transition {
  if (state.message?.kind !== 'restart-confirm') {
    return { state: withMessage(state, RESTART_MESSAGES.confirm, 'restart-confirm') };
  }
  const body: RestartBody = {
    date: payload.targetDate,
    today: payload.today,
    // Les plus récents : au-delà, le serveur refuserait toute la requête.
    refused: state.localRefusals.slice(-MAX_NAMED_REFUSALS).map((refusal) => sortedIds(refusal.item_ids)),
  };
  return {
    state: withMessage(
      {
        ...state,
        payload: restartedPayload(payload, body),
        browse: null,
        selection: EMPTY_SELECTION,
        localRefusals: [],
        // Plus de tenue prévue : l'empreinte que renverra le serveur, sans tout relire pour ce choix.
        version: withPlanVersion(state.version, null),
      },
      RESTART_MESSAGES.done,
      'restart-done',
    ),
    post: { endpoint: '/api/miroir/recommencer', body, dedupeKey: `recommencer:${payload.targetDate}` },
    rebuild: true,
  };
}

/**
 * Données reçues. `browse` vient de buildBrowse. Même jour et même tenue prévue : la composition
 * affichée reste la même, et une pièce qui a disparu (passée au sale) est remplacée par celle du
 * point de départ. Sinon (18 h, minuit, 4 h, tenue choisie sur le téléphone), on repart du point
 * de départ : la tenue prévue, ou la meilleure du jour visé (docs/conception.md §4). 4 h ne change ni la date ni
 * le jour visé, mais la météo du matin est relue : on compare aussi dayKey de la lecture précédente
 * (`loadedAt`) et de celle-ci (`now`). `pendingKeyMap` : touches encore dans la file
 * d'envoi, qui priment sur celles du serveur.
 * `receivedRefusals` : refus locaux que le serveur avait déjà reçus avant la lecture ; s'il ne les
 * renvoie pas, ils ont été effacés (« Recommencer » sur le téléphone) et la tablette les oublie.
 * `version` : l'empreinte de ces données (lib/mirror/version.ts). Une relecture ne réveille pas
 * l'écran. Un key_map vide ou incomplet n'ouvre jamais le test des touches (plus de manette, docs/conception.md
 * §5) : les touches de PC servent de secours, et une tablette neuve n'y reste jamais bloquée.
 */
export function loaded(
  state: MirrorState,
  payload: MirrorPayload,
  browse: Browse,
  now: number,
  pendingKeyMap: KeyMap | null,
  receivedRefusals: readonly Refusal[] = [],
  version: string | null = null,
): MirrorState {
  const localRefusals = state.localRefusals.filter(
    (local) =>
      !payload.refusals.some((server) => sameIds(server.item_ids, local.item_ids)) &&
      !receivedRefusals.some((received) => sameIds(received.item_ids, local.item_ids)),
  );
  const previous = state.payload;
  const sameDay =
    dayKey(new Date(state.loadedAt), payload.timezone, payload.eveningHour) ===
    dayKey(new Date(now), payload.timezone, payload.eveningHour);
  const sameChoice =
    state.status === 'ready' &&
    previous !== null &&
    previous.today === payload.today &&
    previous.targetDate === payload.targetDate &&
    sameDay &&
    samePlan(previous.plan, payload.plan);
  let selection = browse.start;
  if (sameChoice && state.browse) {
    const shown = composedIds(state.browse, state.selection);
    if (shown.length > 0) selection = selectionOf(shown, browse, browse.start);
    // Une veste affichée passée au sale : celle du point de départ, pas « sans veste ».
    const jacket = state.selection.jacket > 0 ? state.browse.jackets[state.selection.jacket - 1] : undefined;
    if (jacket && !browse.jackets.some((item) => item.id === jacket.id)) selection = { ...selection, jacket: browse.start.jacket };
  }

  const keyMap = pendingKeyMap ?? parseKeyMap(payload.keyMap);

  // Un test des touches déjà ouvert (?touches=test, peut-être en veille) reste où il en est. Sauf
  // laissé en plan : en veille à la relecture de 18 h, de minuit ou de 4 h, il est fermé sans rien
  // enregistrer. Sans clavier, rien d'autre ne l'en ferait sortir (les gestes n'y font rien, la page
  // ne se recharge pas) ; quelqu'un qui le fait est devant le miroir, donc pas en veille.
  const keyTest = state.keyTest && (sameDay || !state.sleeping) ? state.keyTest : null;
  return {
    ...state,
    status: 'ready',
    payload: { ...payload, keyMap },
    loadedAt: now,
    browse,
    selection,
    localRefusals,
    keyMap,
    keyTest,
    version,
  };
}

/** Réponse reçue (`offline` faux) ou appel en échec faute de réseau (`offline` vrai). */
export function withNetwork(state: MirrorState, offline: boolean): MirrorState {
  return state.offline === offline ? state : { ...state, offline };
}

/**
 * Minuit passé sans relecture réussie (Wi-Fi coupé la nuit) : les données disent encore « Demain »
 * pour le jour qui est maintenant aujourd'hui. La tablette recalcule le jour elle-même (targetDay,
 * dans le fuseau du profil) : l'en-tête ne dit plus « Demain » et « oui » compte pour
 * aujourd'hui (tenue portée). Seulement si le jour visé est resté le même : sinon les tenues et la
 * météo affichées sont celles d'un autre jour, et on attend la relecture.
 */
export function withDeviceDay(state: MirrorState, now: number): MirrorState {
  const payload = state.payload;
  if (!payload) return state;
  const day = targetDay(new Date(now), payload.timezone, payload.eveningHour);
  if (day.today <= payload.today || day.targetDate !== payload.targetDate) return state;
  return { ...state, payload: { ...payload, today: day.today, isTomorrow: day.isTomorrow } };
}

/** Échec de lecture : sans données, on l'affiche ; avec des données, on garde l'écran tel quel. */
export function loadFailed(state: MirrorState, problem: LoadProblem): MirrorState {
  if (state.payload) return state;
  return { ...state, status: problem };
}

/** Nouvelles listes (après « Recommencer ») : on repart de leur point de départ. */
export function withBrowse(state: MirrorState, browse: Browse): MirrorState {
  return { ...state, browse, selection: browse.start };
}

/**
 * Le test des touches, ouvert par ?touches=test sur la tablette (docs/conception.md §5) : la seule façon de
 * l'ouvrir. Il réveille l'écran.
 */
export function openKeyTest(state: MirrorState): MirrorState {
  if (state.status !== 'ready' || state.keyTest) return state;
  return { ...state, keyTest: startKeyTest(), sleeping: false, message: null };
}

/** Une touche pendant le test des touches. */
export function keyTestKey(state: MirrorState, input: KeyInput): Transition {
  if (!state.keyTest) return { state };
  const { test, done } = keyTestInput(state.keyTest, input);
  if (!done) return { state: { ...state, keyTest: test } };

  const keyMap = parseKeyMap(done);
  const payload = state.payload ? { ...state.payload, keyMap } : null;
  return {
    state: withMessage({ ...state, keyTest: null, keyMap, payload }, KEYS_SAVED_MESSAGE, 'keys-saved'),
    post: { endpoint: '/api/miroir/touches', body: { keyMap }, dedupeKey: 'touches' },
  };
}

/**
 * Efface « Appuie encore pour recommencer » ou « On recommence » : une touche sans action l'annule
 * aussi (docs/conception.md §4). Sans un de ces messages, rien ne change.
 */
export function dismissRestartMessage(state: MirrorState): MirrorState {
  return isRestartMessage(state.message) ? { ...state, message: null } : state;
}

/**
 * Une touche sans action : elle annule « Appuie encore pour recommencer » ou « On recommence », et
 * efface la phrase d'une touche sans effet (« effacée à la touche suivante »).
 */
export function unmappedKey(state: MirrorState): MirrorState {
  const next = dismissRestartMessage(state);
  return next.hint ? { ...next, hint: null } : next;
}

export function clearMessage(state: MirrorState, id: number): MirrorState {
  return state.message?.id === id ? { ...state, message: null } : state;
}

/**
 * Veille après 2 min sans personne ni touche (docs/conception.md §4) : aussi pendant le test des touches, qui garde son
 * étape et les touches déjà choisies, et sur les écrans de problème (« Serveur injoignable… »),
 * dont le nouvel essai continue. Jamais pendant « Chargement… ».
 */
export function fallAsleep(state: MirrorState): MirrorState {
  if (state.status === 'loading' || state.sleeping) return state;
  return { ...withoutFlashes(state), sleeping: true, message: null };
}

/** Réveil : la touche, ou la personne qui arrive, ne fait rien d'autre (docs/conception.md §5). */
export function wake(state: MirrorState): MirrorState {
  return state.sleeping ? { ...state, sleeping: false } : state;
}

function sameSelection(a: Selection, b: Selection): boolean {
  return a.top === b.top && a.bottom === b.bottom && a.jacket === b.jacket;
}

/**
 * Une action, d'une touche ou d'un geste, écran éveillé et hors test des touches. Chaque action
 * efface les retours en texte de la précédente (phrase, note éclairée, « écartée ») et donne les
 * siens.
 */
export function applyAction(state: MirrorState, action: KeyAction): Transition {
  if (state.status !== 'ready' || state.keyTest || state.sleeping || !state.payload) return { state };
  const current = withoutFlashes(state);
  // Avant d'effacer le message : il porte la demande de confirmation de « Recommencer ».
  if (action === 'restart') return restart(current, state.payload);
  // Pendant « Appuie encore pour recommencer » ou « On recommence », la tenue est cachée : une autre
  // touche efface seulement le message, sans accepter, refuser ni défiler ce qu'on ne voit pas.
  if (isRestartMessage(current.message)) return { state: dismissRestartMessage(current) };
  // « Touches enregistrées » cache une tenue pas encore vue : « oui » et « non » effacent seulement
  // le message (on n'enregistre jamais une tenue qu'on n'a pas vue) ; les flèches et la veste
  // l'effacent et changent la tenue.
  if (current.message?.kind === 'keys-saved' && (action === 'accept' || action === 'refuse')) {
    return { state: { ...current, message: null } };
  }
  const base: MirrorState = current.message ? { ...current, message: null } : current;
  const browse = base.browse;
  const outfit = currentOutfit(base);
  if (!browse || !outfit) return { state: base };
  const select = (selection: Selection): Transition => {
    // Rien ne change à l'écran : une courte phrase dit pourquoi (l'appui ou le geste a été reçu).
    if (sameSelection(selection, base.selection)) {
      const hint = noEffectHint(browse, base.selection, action);
      return { state: hint ? withHint(base, hint) : base };
    }
    const next: MirrorState = { ...base, selection };
    // Seule la pièce cachée a changé (le haut sous la veste) : sa ligne s'éclaire un instant.
    return { state: changesOnlyHidden(browse, base.selection, selection) ? withFlash(next, 'noteLit') : next };
  };

  switch (action) {
    case 'next':
      return select(moveTop(browse, base.selection, 1));
    case 'previous':
      return select(moveTop(browse, base.selection, -1));
    case 'bottomNext':
      return select(moveBottom(browse, base.selection, 1));
    case 'bottomPrevious':
      return select(moveBottom(browse, base.selection, -1));
    case 'jacket':
      return select(cycleJacket(browse, base.selection));
    case 'accept': {
      const payload = base.payload!;
      const date = payload.targetDate;
      const text = payload.isTomorrow ? ACCEPT_MESSAGES.tomorrow : ACCEPT_MESSAGES.today;
      // La table suit ce qui est affiché maintenant : l'envoi peut partir après minuit (file d'attente).
      const target = payload.isTomorrow ? 'plan' : 'history';
      // Pour demain, c'est désormais la tenue prévue (« Prévue ») ; la file la rejoue à chaque
      // lecture tant que le serveur ne l'a pas (pendingPayload). L'empreinte suit : le serveur
      // renverra celle-là une fois le choix reçu, sans qu'il faille tout relire. Pour aujourd'hui,
      // c'est la tenue portée (« Choisie »), rejouée de même ; elle n'entre pas dans l'empreinte.
      const accepted: MirrorState =
        target === 'plan'
          ? {
              ...base,
              payload: { ...payload, plan: { date, item_ids: outfit.item_ids, confirmed: true } },
              version: withPlanVersion(base.version, { date, item_ids: outfit.item_ids }),
            }
          : {
              ...base,
              payload: {
                ...payload,
                history: withHistoryEntry(payload.history, { date, item_ids: outfit.item_ids, title: outfit.title }),
              },
            };
      return {
        // La tenue reste affichée, le message prend la place de sa légende.
        state: withMessage(accepted, text, 'accepted'),
        post: {
          endpoint: '/api/miroir/accepter',
          body: { date, item_ids: outfit.item_ids, title: outfit.title, target },
          // Une seule tenue par table et par date : la dernière acceptée l'emporte.
          dedupeKey: `accepter:${target}:${date}`,
        },
      };
    }
    case 'refuse': {
      // « Non » vaut pour ce qu'on voit (docs/conception.md §6), puis on montre autre chose (afterRefusal).
      const ids = sortedIds(outfit.drawn_ids);
      if (ids.length === 0) return { state: base };
      const alreadyKnown = base.localRefusals.some((refusal) => sameIds(refusal.item_ids, ids));
      // « écartée » remplace un instant « non » dans la légende : un refus ne change souvent qu'un
      // vêtement, comme un appui sur →.
      return {
        state: withFlash(
          {
            ...base,
            selection: afterRefusal(browse, base.selection),
            localRefusals: alreadyKnown ? base.localRefusals : [...base.localRefusals, { item_ids: ids }],
          },
          'refusedFlash',
        ),
        post: { endpoint: '/api/miroir/refuser', body: { item_ids: ids }, dedupeKey: `refuser:${ids.join('+')}` },
      };
    }
  }
}
