import { describe, expect, it } from 'vitest';
import { buildBrowse, composedIds } from './browse';
import {
  ACCEPT_MESSAGES,
  KEYS_SAVED_MESSAGE,
  NO_EFFECT_HINTS,
  OUTFIT_MARKS,
  RESTART_MESSAGES,
  applyAction,
  clearFlash,
  clearMessage,
  currentMark,
  currentOutfit,
  dismissRestartMessage,
  fallAsleep,
  initialMirrorState,
  isCurrentChosen,
  isCurrentRefused,
  isMirrorPayload,
  keyTestKey,
  loadFailed,
  loaded,
  messageDuration,
  messageHidesOutfit,
  openKeyTest,
  pendingPayload,
  problemForStatus,
  restartedPayload,
  unmappedKey,
  wake,
  withBrowse,
  withDeviceDay,
  withNetwork,
  type MirrorState,
} from './state';
import { acceptsGestures } from './gestures';
import { pendingChoices } from './queue';
import { MESSAGE_MS, RESTART_DONE_MS } from './timing';
import { ITEMS, mirrorItem, payload } from './test-fixtures';
import { mirrorVersion, withPlanVersion } from './version';
import type { DayWeather } from '@/lib/types';

const RAIN: DayWeather = { date: '2026-10-24', tempMin: 9, tempMax: 14, temp: 14, code: 61, rain: true, label: 'Pluie' };

const NOW = 1_000_000;

const VERSION_PROFILE = { city: 'Paris', lat: 48.8566, lon: 2.3522, timezone: 'Europe/Paris', evening_hour: 18 };

function ready(overrides: Parameters<typeof payload>[0] = {}): MirrorState {
  const data = payload(overrides);
  return loaded(initialMirrorState, data, buildBrowse(data, []), NOW, null);
}

/** Les pièces affichées, triées (l'ordre des listes dépend de la graine du jour). */
function shown(state: MirrorState): string[] {
  return [...(currentOutfit(state)?.item_ids ?? [])].sort();
}

describe('chargement', () => {
  it('passe à « ready » avec les listes à parcourir, du point de départ', () => {
    const state = ready();
    expect(state.status).toBe('ready');
    expect(state.loadedAt).toBe(NOW);
    expect(state.keyTest).toBeNull();
    const browse = state.browse!;
    // Les hauts, puis la robe ; ni chaussures ni accessoires (la silhouette ne les dessine pas).
    expect([...browse.tops.slice(0, 2).map((item) => item.id)].sort()).toEqual(['h1', 'h2']);
    expect(browse.tops[2].id).toBe('r1');
    expect(browse.bottoms.map((item) => item.id).sort()).toEqual(['b1', 'b2']);
    expect(browse.jackets.map((item) => item.id)).toEqual(['v1']);
    expect(state.selection).toEqual(browse.start);
    expect(currentOutfit(state)).not.toBeNull();
  });

  it('key_map vide ou incomplet : jamais de test des touches de lui-même (une tablette neuve y resterait bloquée)', () => {
    // Plus de manette : on commande le miroir avec les bras, les touches de PC restent en secours.
    const empty = ready({ keyMap: {} });
    expect(empty.keyTest).toBeNull();
    expect(empty.keyMap).toEqual({});
    expect(currentOutfit(empty)).not.toBeNull();
    // Correspondance d'avant la composition libre : ni bas ni veste.
    const fiveKeys = {
      next: { code: 'KeyD', key: 'd' },
      previous: { code: 'KeyA', key: 'a' },
      accept: { code: 'KeyJ', key: 'j' },
      refuse: { code: 'KeyK', key: 'k' },
      restart: { code: 'KeyL', key: 'l' },
    };
    expect(ready({ keyMap: fiveKeys }).keyTest).toBeNull();
    // Endormi, il le reste : une relecture ne rallume pas l'écran pour un key_map incomplet.
    const asleep = fallAsleep(empty);
    const data = payload({ keyMap: {} });
    const reloaded = loaded(asleep, data, buildBrowse(data, []), NOW + 1, null);
    expect(reloaded.sleeping).toBe(true);
    expect(reloaded.keyTest).toBeNull();
  });

  it('des touches encore dans la file d’envoi priment et n’ouvrent pas le test', () => {
    const pending = { next: { code: 'KeyX', key: 'x' } };
    const data = payload({ keyMap: {} });
    const state = loaded(initialMirrorState, data, buildBrowse(data, []), NOW, pending);
    expect(state.keyTest).toBeNull();
    expect(state.keyMap).toEqual(pending);
    expect(state.payload?.keyMap).toEqual(pending);
  });

  it('au rechargement, garde la composition affichée si ses pièces sont toujours là', () => {
    let state = applyAction(ready(), 'next').state;
    state = applyAction(state, 'jacket').state;
    const before = shown(state);
    const data = payload();
    const reloaded = loaded(state, data, buildBrowse(data, []), NOW + 1, null);
    expect(shown(reloaded)).toEqual(before);
  });

  it('au rechargement, une pièce affichée qui a disparu (au sale) est remplacée par le départ', () => {
    const state = ready();
    const top = state.browse!.tops[state.selection.top].id;
    const data = payload({ items: ITEMS.filter((item) => item.id !== top) });
    const reloaded = loaded(state, data, buildBrowse(data, []), NOW + 1, null);
    expect(shown(reloaded)).not.toContain(top);
    expect(reloaded.selection.top).toBe(reloaded.browse!.start.top);
  });

  it('jour visé changé (heure du soir, minuit) : repart du point de départ, pas de la tenue d’avant', () => {
    // Le matin : on a parcouru, puis l'écran est resté là. À 18 h, les données passent à demain.
    const morning = applyAction(applyAction(ready(), 'next').state, 'bottomNext').state;
    const evening = payload({ isTomorrow: true, targetDate: '2026-10-25', weather: { ...RAIN, date: '2026-10-25' } });
    const eveningBrowse = buildBrowse(evening, []);
    const atSix = loaded(morning, evening, eveningBrowse, NOW + 1, null);
    expect(atSix.selection).toEqual(eveningBrowse.start);
    // Pluie demain : le point de départ a une veste.
    expect(shown(atSix)).toContain('v1');

    // Le soir : on parcourt encore ; à minuit, même jour visé mais nouveau « aujourd'hui ».
    const browsing = applyAction(atSix, 'jacket').state;
    const midnight = payload({ today: '2026-10-25', targetDate: '2026-10-25', weather: { ...RAIN, date: '2026-10-25' } });
    const midnightBrowse = buildBrowse(midnight, []);
    expect(loaded(browsing, midnight, midnightBrowse, NOW + 2, null).selection).toEqual(midnightBrowse.start);
  });

  it('à 4 h (météo du matin relue) : repart du point de départ ; au réveil de 7 h, garde ce qu’on parcourt', () => {
    const at = (iso: string) => Date.parse(iso);
    // Minuit et demi : temps doux, point de départ sans veste.
    const night = payload({ weather: { ...RAIN, rain: false, code: 3, tempMin: 15, tempMax: 20, temp: 18, label: 'Nuageux' } });
    const midnight = loaded(initialMirrorState, night, buildBrowse(night, []), at('2026-10-24T00:30:00+02:00'), null);
    expect(shown(midnight)).not.toContain('v1');
    // 4 h : même date, même jour visé, mais la pluie est annoncée : le départ a une veste.
    const morning = payload({ weather: RAIN });
    const morningBrowse = buildBrowse(morning, []);
    const atFour = loaded(midnight, morning, morningBrowse, at('2026-10-24T04:30:00+02:00'), null);
    expect(atFour.selection).toEqual(morningBrowse.start);
    expect(shown(atFour)).toContain('v1');
    // 7 h : on parcourt, puis une relecture (réveil) garde ce qu'on regarde.
    const browsing = applyAction(atFour, 'next').state;
    const atSeven = loaded(browsing, morning, buildBrowse(morning, []), at('2026-10-24T07:00:00+02:00'), null);
    expect(atSeven.selection).toEqual(browsing.selection);
  });

  it('tenue prévue apparue (choisie sur le téléphone) : repart d’elle, « Prévue »', () => {
    const base = ready();
    const robe = base.browse!.tops.findIndex((item) => item.category === 'robe');
    const onRobe: MirrorState = { ...base, selection: { top: robe, bottom: 0, jacket: 0 } };
    const data = payload({ plan: { date: '2026-10-24', item_ids: ['h2', 'b2', 'c1'], confirmed: true } });
    const reloaded = loaded(onRobe, data, buildBrowse(data, []), NOW + 1, null);
    expect(shown(reloaded)).toEqual(['b2', 'h2']);
    expect(currentOutfit(reloaded)!.planned).toBe(true);
  });

  it('veste affichée passée au sale : la veste du point de départ, pas « sans veste »', () => {
    const items = [...ITEMS, mirrorItem('v2', 'veste')];
    const state = ready({ items, weather: RAIN });
    const jacket = state.browse!.jackets[state.selection.jacket - 1].id;
    const data = payload({ items: items.filter((item) => item.id !== jacket), weather: RAIN });
    const reloaded = loaded(state, data, buildBrowse(data, []), NOW + 1, null);
    expect(reloaded.selection.jacket).toBeGreaterThan(0);
    expect(shown(reloaded)).not.toContain(jacket);
  });

  it('garde les refus locaux tant que le serveur ne les renvoie pas', () => {
    const refused = applyAction(ready(), 'refuse').state;
    expect(refused.localRefusals).toHaveLength(1);
    const ids = refused.localRefusals[0].item_ids;
    const data = payload();
    expect(loaded(refused, data, buildBrowse(data, []), NOW + 1, null).localRefusals).toHaveLength(1);
    const known = payload({ refusals: [{ item_ids: ids }] });
    expect(loaded(refused, known, buildBrowse(known, []), NOW + 2, null).localRefusals).toEqual([]);
  });

  it('nouvelle empreinte (changement sur le téléphone) : relecture qui garde la composition', () => {
    let state = applyAction(ready(), 'next').state;
    state = applyAction(state, 'bottomNext').state;
    const before = shown(state);
    expect(state.version).toBeNull();
    const data = payload({ items: [...ITEMS, mirrorItem('h3', 'haut')] });
    const reloaded = loaded(state, data, buildBrowse(data, []), NOW + 1, null, [], 'v1-0000000000000002');
    expect(reloaded.version).toBe('v1-0000000000000002');
    expect(shown(reloaded)).toEqual(before);
  });

  it('tenue gardée sur Demain depuis le téléphone : le miroir repart d’elle, « Prévue »', () => {
    const evening = applyAction(ready({ isTomorrow: true, targetDate: '2026-10-25' }), 'next').state;
    const plan = { date: '2026-10-25', item_ids: ['h2', 'b1'], confirmed: true };
    const data = payload({ isTomorrow: true, targetDate: '2026-10-25', plan });
    const reloaded = loaded(evening, data, buildBrowse(data, []), NOW + 1, null, [], 'v1-0000000000000003');
    expect(shown(reloaded)).toEqual(['b1', 'h2']);
    expect(currentOutfit(reloaded)!.planned).toBe(true);
  });

  it('« Tout est lavé » sur le téléphone : « Aucune tenue disponible » s’en va à la relecture', () => {
    const empty = ready({ items: ITEMS.filter((item) => item.category !== 'bas' && item.category !== 'robe') });
    expect(currentOutfit(empty)).toBeNull();
    const data = payload();
    expect(currentOutfit(loaded(empty, data, buildBrowse(data, []), NOW + 1, null))).not.toBeNull();
  });

  it('hors ligne : vrai après un appel en échec, faux à la première réponse', () => {
    const state = ready();
    expect(state.offline).toBe(false);
    expect(withNetwork(state, false)).toBe(state);
    const offline = withNetwork(state, true);
    expect(offline.offline).toBe(true);
    expect(withNetwork(offline, true)).toBe(offline);
    expect(withNetwork(offline, false).offline).toBe(false);
  });

  it('minuit sans réseau : plus « Demain », et « oui » compte pour aujourd’hui (tenue portée)', () => {
    const at = (iso: string) => Date.parse(iso);
    const evening = ready({ isTomorrow: true, targetDate: '2026-10-25' });
    // 23 h 59 à Paris : rien ne change.
    expect(withDeviceDay(evening, at('2026-10-24T23:59:00+02:00'))).toBe(evening);
    // 7 h le lendemain, sans relecture réussie : le jour visé est le même, aujourd'hui a changé.
    const morning = withDeviceDay(evening, at('2026-10-25T07:00:00+02:00'));
    expect(morning.payload).toMatchObject({ today: '2026-10-25', targetDate: '2026-10-25', isTomorrow: false });
    expect(morning.selection).toEqual(evening.selection);
    expect(withDeviceDay(morning, at('2026-10-25T07:01:00+02:00'))).toBe(morning);
    const { state, post } = applyAction(morning, 'accept');
    expect(state.message?.text).toBe(ACCEPT_MESSAGES.today);
    expect(post?.body).toMatchObject({ date: '2026-10-25', target: 'history' });
    // Coupure dès l'après-midi : à 19 h les données sont encore celles d'aujourd'hui (autre jour
    // visé) ; on attend la relecture.
    const afternoon = ready();
    expect(withDeviceDay(afternoon, at('2026-10-24T19:00:00+02:00'))).toBe(afternoon);
  });

  it('un échec sans données s’affiche, un échec avec données ne change rien', () => {
    expect(loadFailed(initialMirrorState, 'unauthenticated').status).toBe('unauthenticated');
    const state = ready();
    expect(loadFailed(state, 'unreachable')).toBe(state);
  });

  it('traduit les statuts HTTP', () => {
    expect(problemForStatus(401)).toBe('unauthenticated');
    expect(problemForStatus(403)).toBe('forbidden');
    expect(problemForStatus(503)).toBe('unconfigured');
    expect(problemForStatus(500)).toBe('unreachable');
  });

  it('vérifie la forme de la réponse', () => {
    expect(isMirrorPayload(payload())).toBe(true);
    expect(isMirrorPayload({ error: 'Connexion requise.' })).toBe(false);
    expect(isMirrorPayload(null)).toBe(false);
  });
});

describe('composer', () => {
  /** Un haut (pas la robe), le premier bas, sans veste. */
  function onTop(): MirrorState {
    const state = ready();
    return { ...state, selection: { top: 0, bottom: 0, jacket: 0 } };
  }

  it('← → change le haut, en boucle (hauts puis robe)', () => {
    let state = onTop();
    const tops = state.browse!.tops.length;
    state = applyAction(state, 'previous').state;
    expect(state.selection.top).toBe(tops - 1);
    state = applyAction(state, 'next').state;
    expect(state.selection.top).toBe(0);
    state = applyAction(state, 'next').state;
    expect(state.selection.top).toBe(1);
  });

  it('↑ ↓ change le bas, en boucle, sans toucher au haut', () => {
    let state = onTop();
    state = applyAction(state, 'bottomNext').state;
    expect(state.selection).toMatchObject({ top: 0, bottom: 1 });
    state = applyAction(state, 'bottomNext').state;
    expect(state.selection.bottom).toBe(0);
    state = applyAction(state, 'bottomPrevious').state;
    expect(state.selection.bottom).toBe(1);
  });

  it('la touche veste fait défiler : sans veste, chaque veste, de nouveau sans veste', () => {
    let state = onTop();
    expect(shown(state)).not.toContain('v1');
    state = applyAction(state, 'jacket').state;
    expect(currentOutfit(state)!.item_ids[0]).toBe('v1');
    state = applyAction(state, 'jacket').state;
    expect(shown(state)).not.toContain('v1');
  });

  it('tenue composée : veste, haut, bas ; ce que montre la silhouette = veste et bas', () => {
    const state = applyAction(onTop(), 'jacket').state;
    const outfit = currentOutfit(state)!;
    const browse = state.browse!;
    expect(outfit.item_ids).toEqual(['v1', browse.tops[0].id, browse.bottoms[0].id]);
    expect(outfit.drawn_ids).toEqual(['v1', browse.bottoms[0].id].sort());
    expect(outfit.core_ids).toEqual([...outfit.item_ids].sort());
    expect(outfit.title).not.toBe('');
  });

  it('avec la robe, ↑ ↓ ne fait rien et la robe se montre seule', () => {
    const base = ready();
    const robe = base.browse!.tops.findIndex((item) => item.category === 'robe');
    const state: MirrorState = { ...base, selection: { top: robe, bottom: 0, jacket: 0 } };
    expect(currentOutfit(state)!.item_ids).toEqual(['r1']);
    expect(applyAction(state, 'bottomNext').state.selection).toEqual(state.selection);
    expect(currentOutfit(applyAction(state, 'jacket').state)!.drawn_ids).toEqual(['r1']);
  });

  it('sans données, les touches ne font rien', () => {
    expect(applyAction(initialMirrorState, 'next')).toEqual({ state: initialMirrorState });
    const empty = payload({ items: [mirrorItem('c1', 'chaussures')] });
    const state = loaded(initialMirrorState, empty, buildBrowse(empty, []), NOW, null);
    expect(applyAction(state, 'next')).toEqual({ state });
    expect(applyAction(state, 'accept').post).toBeUndefined();
  });

  it('« Prévue » quand la composition affichée est la tenue prévue', () => {
    const state = ready({ plan: { date: '2026-10-24', item_ids: ['h2', 'b2', 'c1'], confirmed: true } });
    expect(shown(state)).toEqual(['b2', 'h2']);
    expect(currentOutfit(state)!.planned).toBe(true);
    expect(currentOutfit(applyAction(state, 'bottomNext').state)!.planned).toBe(false);
  });
});

describe('accepter', () => {
  it('aujourd’hui : « Bonne journée » et POST accepter avec ce qui est affiché', () => {
    const state = ready();
    const outfit = currentOutfit(state)!;
    const { state: after, post } = applyAction(state, 'accept');
    expect(after.message?.text).toBe(ACCEPT_MESSAGES.today);
    expect(post).toEqual({
      endpoint: '/api/miroir/accepter',
      body: { date: '2026-10-24', item_ids: outfit.item_ids, title: outfit.title, target: 'history' },
      dedupeKey: 'accepter:history:2026-10-24',
    });
  });

  it('le soir : « Prête pour demain », la date de demain et la cible plan (l’envoi peut partir après minuit)', () => {
    const evening = ready({ isTomorrow: true, targetDate: '2026-10-25' });
    const { state, post } = applyAction(evening, 'accept');
    expect(state.message?.text).toBe(ACCEPT_MESSAGES.tomorrow);
    expect(post?.body).toMatchObject({ date: '2026-10-25', target: 'plan' });
    expect(post?.dedupeKey).toBe('accepter:plan:2026-10-25');
  });

  it('« oui » pour demain et « Recommencer » : l’empreinte suit ces choix, sans tout relire pour eux', () => {
    const version = mirrorVersion({ items: [], plan: null, profile: VERSION_PROFILE });
    const data = payload({ isTomorrow: true, targetDate: '2026-10-25' });
    const evening = loaded(initialMirrorState, data, buildBrowse(data, []), NOW, null, [], version);
    const ids = currentOutfit(evening)!.item_ids;
    const accepted = applyAction(evening, 'accept').state;
    expect(accepted.version).toBe(withPlanVersion(version, { date: '2026-10-25', item_ids: ids }));
    const restarted = applyAction(applyAction(accepted, 'restart').state, 'restart').state;
    expect(restarted.version).toBe(withPlanVersion(version, null));
    // « Oui » pour aujourd'hui (tenue portée) : l'empreinte ne la contient pas.
    const morning = payload();
    const today = loaded(initialMirrorState, morning, buildBrowse(morning, []), NOW, null, [], version);
    expect(applyAction(today, 'accept').state.version).toBe(version);
  });

  it('pour demain : la tenue acceptée devient « Prévue » aussitôt, l’ancienne ne l’est plus', () => {
    const plan = { date: '2026-10-25', item_ids: ['h2', 'b2', 'c1'], confirmed: true };
    const evening = ready({ isTomorrow: true, targetDate: '2026-10-25', plan });
    expect(currentOutfit(evening)!.planned).toBe(true);
    const other = applyAction(evening, 'bottomNext').state;
    expect(currentOutfit(other)!.planned).toBe(false);
    const accepted = applyAction(other, 'accept').state;
    expect(currentOutfit(accepted)!.planned).toBe(true);
    // L'ancienne tenue prévue ne l'est plus.
    const old = applyAction(accepted, 'bottomPrevious').state;
    expect(shown(old)).toEqual(shown(evening));
    expect(currentOutfit(old)!.planned).toBe(false);
  });

  it('relecture avec ce « oui » encore dans la file : la composition et « Prévue » restent', () => {
    const plan = { date: '2026-10-25', item_ids: ['h2', 'b2', 'c1'], confirmed: true };
    const evening = ready({ isTomorrow: true, targetDate: '2026-10-25', plan });
    const other = applyAction(evening, 'bottomNext').state;
    const accepted = applyAction(other, 'accept');
    // Le serveur n'a pas encore reçu le « oui » : il renvoie l'ancienne tenue prévue.
    const server = payload({ isTomorrow: true, targetDate: '2026-10-25', plan });
    const jobs = [{ ...accepted.post!, id: 'j1', attempts: 0 }];
    const data = pendingPayload(server, pendingChoices(jobs));
    const reloaded = loaded(accepted.state, data, buildBrowse(data, []), NOW + 1, null);
    expect(shown(reloaded)).toEqual(shown(other));
    expect(currentOutfit(reloaded)!.planned).toBe(true);
    // Une fois reçu, le serveur renvoie la même tenue prévue : rien ne bouge.
    const saved = payload({ isTomorrow: true, targetDate: '2026-10-25', plan: { ...data.plan! } });
    expect(shown(loaded(reloaded, saved, buildBrowse(saved, []), NOW + 2, null))).toEqual(shown(other));

    // On continue de parcourir après « oui » : la relecture garde ce qu'on regarde (pas le départ).
    const browsing = applyAction(accepted.state, 'next').state;
    const kept = loaded(browsing, data, buildBrowse(data, []), NOW + 3, null);
    expect(shown(kept)).toEqual(shown(browsing));
    expect(shown(kept)).not.toEqual(shown(other));
    expect(currentOutfit(kept)!.planned).toBe(false);
    const back = applyAction(kept, 'previous').state;
    expect(shown(back)).toEqual(shown(other));
    expect(currentOutfit(back)!.planned).toBe(true);
    expect(shown(loaded(browsing, saved, buildBrowse(saved, []), NOW + 4, null))).toEqual(shown(browsing));
  });

  it('une pièce de la tenue prévue passée au sale : le départ la complète et reste « Prévue »', () => {
    // h2 est au sale : le serveur ne l'envoie plus.
    const items = ITEMS.filter((item) => item.id !== 'h2');
    const plan = { date: '2026-10-25', item_ids: ['h2', 'b2'], confirmed: true };
    const evening = ready({ isTomorrow: true, targetDate: '2026-10-25', plan, items });
    expect(shown(evening)).toContain('b2');
    expect(currentOutfit(evening)!.planned).toBe(true);
    // Une autre tenue acceptée devient la tenue prévue ; le départ ne l'est plus.
    const accepted = applyAction(applyAction(evening, 'next').state, 'accept').state;
    expect(currentOutfit(accepted)!.planned).toBe(true);
    const back = applyAction(accepted, 'previous').state;
    expect(shown(back)).toEqual(shown(evening));
    expect(currentOutfit(back)!.planned).toBe(false);
  });

  it('pendingPayload applique les choix dans l’ordre, et seulement pour le jour visé', () => {
    const data = payload({ isTomorrow: true, targetDate: '2026-10-25' });
    const plan = { kind: 'plan' as const, date: '2026-10-25', item_ids: ['h1', 'b1'] };
    const restart = { kind: 'restart' as const, date: '2026-10-25', today: '2026-10-24', refused: [] };
    expect(pendingPayload(data, [plan]).plan).toEqual({ date: '2026-10-25', item_ids: ['h1', 'b1'], confirmed: true });
    expect(pendingPayload(data, [plan, restart]).plan).toBeNull();
    expect(pendingPayload(data, [restart, plan]).plan?.item_ids).toEqual(['h1', 'b1']);
    expect(pendingPayload(data, [{ ...plan, date: '2026-10-24' }]).plan).toBeNull();
  });

  it('le message s’efface après son délai, sauf s’il a été remplacé', () => {
    const first = applyAction(ready(), 'accept').state;
    const id = first.message!.id;
    expect(clearMessage(first, id).message).toBeNull();
    const second = applyAction(first, 'accept').state;
    expect(clearMessage(second, id).message).not.toBeNull();
  });

  it('une touche pendant le message l’efface et agit', () => {
    const accepted = applyAction(ready(), 'accept').state;
    const { state } = applyAction(accepted, 'next');
    expect(state.message).toBeNull();
    expect(state.selection.top).not.toBe(accepted.selection.top);
  });
});

describe('refuser', () => {
  it('avec une veste : envoie veste et bas, triés, puis passe au bas suivant (la veste cache le haut)', () => {
    const state = applyAction({ ...ready(), selection: { top: 0, bottom: 0, jacket: 0 } }, 'jacket').state;
    const ids = [...currentOutfit(state)!.drawn_ids];
    const result = applyAction(state, 'refuse');
    expect(result.post).toEqual({
      endpoint: '/api/miroir/refuser',
      body: { item_ids: ids },
      dedupeKey: `refuser:${ids.join('+')}`,
    });
    expect(result.state.selection).toEqual({ top: 0, bottom: 1, jacket: 1 });
    expect(result.state.localRefusals).toEqual([{ item_ids: ids }]);
    // L'image a changé : la nouvelle combinaison n'est pas « Écartée ».
    expect(isCurrentRefused(result.state)).toBe(false);
  });

  it('sans veste : passe au haut suivant', () => {
    const state: MirrorState = { ...ready(), selection: { top: 0, bottom: 0, jacket: 0 } };
    expect(applyAction(state, 'refuse').state.selection).toEqual({ top: 1, bottom: 0, jacket: 0 });
  });

  it('une combinaison refusée reste visible en parcourant, avec « Écartée »', () => {
    const start = ready();
    expect(isCurrentRefused(start)).toBe(false);
    const refused = applyAction(start, 'refuse').state;
    const back = applyAction(refused, 'previous').state;
    expect(composedIds(back.browse!, back.selection)).toEqual(composedIds(start.browse!, start.selection));
    expect(isCurrentRefused(back)).toBe(true);
    // Refusée deux fois : un seul refus local.
    expect(applyAction(back, 'refuse').state.localRefusals).toHaveLength(1);
  });

  it('un refus de l’ancien format (pièces principales + veste) rend aussi la combinaison « Écartée »', () => {
    const state = applyAction({ ...ready(), selection: { top: 0, bottom: 0, jacket: 0 } }, 'jacket').state;
    const core = currentOutfit(state)!.core_ids;
    const old = { ...state, payload: { ...state.payload!, refusals: [{ item_ids: core }] } };
    expect(isCurrentRefused(old)).toBe(true);
  });
});

describe('veille', () => {
  it('s’endort, puis la touche qui réveille ne fait rien d’autre', () => {
    const moved = applyAction(ready(), 'next').state;
    const asleep = fallAsleep(moved);
    expect(asleep.sleeping).toBe(true);
    expect(applyAction(asleep, 'next')).toEqual({ state: asleep });
    const awake = wake(asleep);
    expect(awake.sleeping).toBe(false);
    expect(awake.selection).toEqual(moved.selection);
  });

  it('ne s’endort pas pendant « Chargement… »', () => {
    expect(fallAsleep(initialMirrorState)).toBe(initialMirrorState);
  });

  it('s’endort aussi pendant le test des touches, qui garde son étape et les touches choisies', () => {
    // Un test demandé le soir et jamais fait ne doit plus éclairer la chambre.
    let testing = openKeyTest(ready({ keyMap: {} }));
    testing = keyTestKey(testing, { code: 'KeyD', key: 'd' }).state;
    const asleep = fallAsleep(testing);
    expect(asleep.sleeping).toBe(true);
    expect(asleep.keyTest).toBe(testing.keyTest);
    // Une relecture pendant la veille (4 h, changement sur le téléphone) ne rallume pas l'écran.
    const data = payload({ keyMap: {} });
    const reloaded = loaded(asleep, data, buildBrowse(data, []), NOW + 1, null);
    expect(reloaded.sleeping).toBe(true);
    expect(reloaded.keyTest).toBe(testing.keyTest);
    // La touche qui réveille ne fait rien d'autre (gérée avant le test) : on reprend où on en était.
    expect(wake(reloaded).keyTest?.step).toBe(1);
  });

  it('test des touches laissé en plan, en veille : fermé sans rien enregistrer à la relecture de 4 h (ou 18 h, minuit)', () => {
    // Clavier débranché en cours de test : sans cela, gestes morts et téléphone ignoré pour toujours.
    let testing = openKeyTest(ready({ keyMap: {} }));
    testing = keyTestKey(testing, { code: 'KeyD', key: 'd' }).state;
    const asleep = fallAsleep(testing);
    const data = payload({ keyMap: {} });
    // NOW tombe vers 1 h 17 à Paris : 3 h plus tard, la relecture de 4 h.
    const later = NOW + 3 * 60 * 60_000;
    const closed = loaded(asleep, data, buildBrowse(data, []), later, null);
    expect(closed.keyTest).toBeNull();
    expect(closed.sleeping).toBe(true);
    expect(closed.keyMap).toEqual(testing.keyMap);
    expect(acceptsGestures(wake(closed))).toBe(true);
    // Éveillé (quelqu'un le fait), il reste ouvert à la même relecture.
    const awake = loaded(testing, data, buildBrowse(data, []), later, null);
    expect(awake.keyTest).toBe(testing.keyTest);
  });

  it('s’endort aussi sur un écran de problème, qui garde son message', () => {
    const unreachable = loadFailed(initialMirrorState, 'unreachable');
    const asleep = fallAsleep(unreachable);
    expect(asleep.sleeping).toBe(true);
    expect(asleep.status).toBe('unreachable');
    expect(wake(asleep)).toEqual(unreachable);
    // Le nouvel essai réussit pendant la veille : les données arrivent, l'écran reste en veille.
    const data = payload();
    expect(loaded(asleep, data, buildBrowse(data, []), NOW, null).sleeping).toBe(true);
  });
});

describe('test des touches', () => {
  it('s’ouvre par ?touches=test (openKeyTest), même en veille, et une seule fois', () => {
    const asleep = fallAsleep(ready());
    const opened = openKeyTest(asleep);
    expect(opened.keyTest).not.toBeNull();
    expect(opened.sleeping).toBe(false);
    // Déjà ouvert : il reste où il en est.
    const started = keyTestKey(opened, { code: 'KeyD', key: 'd' }).state;
    expect(openKeyTest(started)).toBe(started);
    // Pas avant les données.
    expect(openKeyTest(initialMirrorState)).toBe(initialMirrorState);
  });

  it('à la fin des 8 touches : POST touches, « Touches enregistrées », nouvelle correspondance utilisée', () => {
    let state = openKeyTest(ready({ keyMap: {} }));
    const keys = ['KeyW', 'KeyQ', 'KeyE', 'KeyS', 'KeyF', 'KeyG', 'KeyR'].map((code) => ({ code, key: code.slice(3).toLowerCase() }));
    for (const input of keys) {
      const result = keyTestKey(state, input);
      expect(result.post).toBeUndefined();
      state = result.state;
    }
    const last = keyTestKey(state, { code: 'KeyT', key: 't' });
    expect(last.state.keyTest).toBeNull();
    expect(last.state.message?.text).toBe(KEYS_SAVED_MESSAGE);
    expect(last.state.keyMap.bottomNext).toEqual({ code: 'KeyE', key: 'e' });
    expect(last.state.keyMap.jacket).toEqual({ code: 'KeyF', key: 'f' });
    expect(last.state.keyMap.restart).toEqual({ code: 'KeyT', key: 't' });
    expect(last.state.payload?.keyMap).toEqual(last.state.keyMap);
    expect(last.post).toEqual({
      endpoint: '/api/miroir/touches',
      body: { keyMap: last.state.keyMap },
      dedupeKey: 'touches',
    });
  });

  it('pendant « Touches enregistrées » (tenue pas encore vue), « oui » et « non » effacent seulement le message', () => {
    let state = openKeyTest(ready({ keyMap: {} }));
    for (const code of ['KeyW', 'KeyQ', 'KeyE', 'KeyS', 'KeyF', 'KeyG', 'KeyR', 'KeyT']) {
      state = keyTestKey(state, { code, key: code.slice(3).toLowerCase() }).state;
    }
    expect(state.message).toMatchObject({ text: KEYS_SAVED_MESSAGE, kind: 'keys-saved' });
    for (const action of ['accept', 'refuse'] as const) {
      const result = applyAction(state, action);
      expect(result.post).toBeUndefined();
      expect(result.state.message).toBeNull();
      expect(result.state.selection).toBe(state.selection);
      expect(result.state.localRefusals).toEqual([]);
    }
    // Les flèches effacent le message et changent la tenue.
    const moved = applyAction(state, 'next').state;
    expect(moved.message).toBeNull();
    expect(moved.selection.top).not.toBe(state.selection.top);
  });
});

describe('recommencer', () => {
  const refusalToday = { item_ids: ['b1', 'h1'], day: '2026-10-24' };
  const refusalBefore = { item_ids: ['b2', 'v1'] };
  const worn = { date: '2026-10-24', item_ids: ['h2', 'b2'], title: null };
  const older = { date: '2026-10-22', item_ids: ['h1', 'b2'], title: null };

  function withChoice(): MirrorState {
    return ready({
      plan: { date: '2026-10-24', item_ids: ['h1', 'b1'], confirmed: true },
      history: [worn, older],
      refusals: [refusalToday, refusalBefore],
    });
  }

  it('premier appui : demande confirmation, sans rien envoyer ni changer', () => {
    const state = withChoice();
    const first = applyAction(state, 'restart');
    expect(first.post).toBeUndefined();
    expect(first.rebuild).toBeUndefined();
    expect(first.state.message).toMatchObject({ text: RESTART_MESSAGES.confirm, kind: 'restart-confirm' });
    expect(first.state.selection).toBe(state.selection);
    expect(first.state.payload).toBe(state.payload);
  });

  it('second appui : efface le choix et les refus du jour, puis revient au point de départ', () => {
    let state = applyAction(withChoice(), 'next').state;
    state = applyAction(state, 'refuse').state;
    const local = state.localRefusals[0].item_ids;

    state = applyAction(state, 'restart').state;
    const done = applyAction(state, 'restart');
    expect(done.rebuild).toBe(true);
    expect(done.state.message).toMatchObject({ text: RESTART_MESSAGES.done, kind: 'restart-done' });
    expect(done.state.browse).toBeNull();
    expect(done.state.localRefusals).toEqual([]);
    expect(done.state.payload?.plan).toBeNull();
    expect(done.state.payload?.refusals).toEqual([refusalBefore]);
    expect(done.state.payload?.history).toEqual([older]);
    // Le refus fait ici est nommé : s'il attend encore dans la file, le serveur l'efface quand même.
    expect(done.post).toEqual({
      endpoint: '/api/miroir/recommencer',
      body: { date: '2026-10-24', today: '2026-10-24', refused: [local] },
      dedupeKey: 'recommencer:2026-10-24',
    });
    // Le composant recalcule les listes : on repart de leur point de départ.
    const rebuilt = buildBrowse(done.state.payload!, done.state.localRefusals);
    expect(withBrowse(done.state, rebuilt).selection).toEqual(rebuilt.start);
  });

  it('une autre touche pendant la confirmation l’annule seulement : rien n’est accepté, refusé ni changé', () => {
    const armed = applyAction(withChoice(), 'restart').state;
    for (const action of ['next', 'previous', 'bottomNext', 'bottomPrevious', 'jacket', 'accept', 'refuse'] as const) {
      const result = applyAction(armed, action);
      expect(result.post).toBeUndefined();
      expect(result.state.message).toBeNull();
      expect(result.state.selection).toBe(armed.selection);
      expect(result.state.localRefusals).toBe(armed.localRefusals);
    }
    const cancelled = applyAction(armed, 'next').state;
    const again = applyAction(cancelled, 'restart');
    expect(again.post).toBeUndefined();
    expect(again.state.message?.kind).toBe('restart-confirm');
  });

  it('pendant « On recommence » (tenue cachée), une touche efface seulement le message', () => {
    let state = applyAction(withChoice(), 'restart').state;
    state = applyAction(state, 'restart').state;
    state = withBrowse(state, buildBrowse(state.payload!, []));
    for (const action of ['next', 'bottomNext', 'jacket', 'accept', 'refuse'] as const) {
      const result = applyAction(state, action);
      expect(result.post).toBeUndefined();
      expect(result.state.message).toBeNull();
      expect(result.state.selection).toBe(state.selection);
    }
    expect(dismissRestartMessage(state).message).toBeNull();
    const plain = applyAction(withChoice(), 'accept').state;
    expect(dismissRestartMessage(plain)).toBe(plain);
  });

  it('n’envoie que les 30 derniers refus faits ici', () => {
    const many = Array.from({ length: 35 }, (_, i) => ({ item_ids: [`x${String(i).padStart(2, '0')}`] }));
    let state: MirrorState = { ...withChoice(), localRefusals: many };
    state = applyAction(state, 'restart').state;
    const body = applyAction(state, 'restart').post?.body as { refused: string[][] };
    expect(body.refused).toHaveLength(30);
    expect(body.refused[0]).toEqual(['x05']);
  });

  it('confirmation effacée au bout de 3 s : il faut rappuyer deux fois', () => {
    let state = applyAction(withChoice(), 'restart').state;
    state = clearMessage(state, state.message!.id);
    expect(applyAction(state, 'restart').post).toBeUndefined();
  });

  it('un autre message (« Bonne journée ») ne vaut pas confirmation', () => {
    const accepted = applyAction(withChoice(), 'accept').state;
    expect(accepted.message?.text).toBe(ACCEPT_MESSAGES.today);
    expect(applyAction(accepted, 'restart').post).toBeUndefined();
  });

  it('pour demain : la tenue portée et les refus du matin restent, seuls ceux du soir partent', () => {
    const evening = { item_ids: ['b2', 'h2'], day: '2026-10-25' };
    const tomorrow = payload({
      targetDate: '2026-10-25',
      isTomorrow: true,
      plan: { date: '2026-10-25', item_ids: ['h1', 'b1'], confirmed: true },
      history: [worn, older],
      refusals: [refusalToday, refusalBefore, evening],
    });
    const restarted = restartedPayload(tomorrow);
    expect(restarted.plan).toBeNull();
    expect(restarted.history).toEqual([worn, older]);
    expect(restarted.refusals).toEqual([refusalToday, refusalBefore]);
    expect(restartedPayload(restarted)).toEqual(restarted);
  });

  it('« recommencer » du jour encore en file à 18 h : la tenue prévue pour demain reste', () => {
    const evening = payload({
      targetDate: '2026-10-25',
      isTomorrow: true,
      plan: { date: '2026-10-25', item_ids: ['h1', 'b1'], confirmed: true },
      history: [worn, older],
      refusals: [refusalToday, refusalBefore],
    });
    const restarted = restartedPayload(evening, { date: '2026-10-24', today: '2026-10-24', refused: [['b2', 'v1']] });
    expect(restarted.plan).toEqual(evening.plan);
    expect(restarted.history).toEqual([older]);
    expect(restarted.refusals).toEqual([]);
  });

  it('au rechargement, un refus local déjà reçu que le serveur ne renvoie plus est oublié', () => {
    const refused = applyAction(ready(), 'refuse').state;
    const ids = refused.localRefusals[0].item_ids;
    const data = payload();
    // Le serveur l'avait reçu, puis « Recommencer » sur le téléphone l'a effacé.
    expect(loaded(refused, data, buildBrowse(data, []), NOW + 1, null, [{ item_ids: ids }]).localRefusals).toEqual([]);
    // Encore dans la file (pas reçu) : il reste.
    expect(loaded(refused, data, buildBrowse(data, []), NOW + 1, null).localRefusals).toHaveLength(1);
  });

  it('écran endormi : la touche ne fait que réveiller (géré avant), rien ici', () => {
    const asleep = fallAsleep(withChoice());
    expect(applyAction(asleep, 'restart')).toEqual({ state: asleep });
  });
});

describe('retours en texte', () => {
  /** Un haut (pas la robe), le premier bas, sans veste. */
  function onTop(overrides: Parameters<typeof payload>[0] = {}): MirrorState {
    const state = ready(overrides);
    return { ...state, selection: { top: 0, bottom: 0, jacket: 0 } };
  }

  /** La robe, sans veste. */
  function onDress(): MirrorState {
    const base = ready();
    const robe = base.browse!.tops.findIndex((item) => item.category === 'robe');
    return { ...base, selection: { top: robe, bottom: 0, jacket: 0 } };
  }

  it('une touche sans effet le dit 1,5 s, sans toucher à la tenue ; la touche suivante l’efface', () => {
    const dress = onDress();
    const { state, post } = applyAction(dress, 'bottomNext');
    expect(state.selection).toEqual(dress.selection);
    expect(state.hint?.text).toBe(NO_EFFECT_HINTS.dress);
    expect(post).toBeUndefined();
    expect(state.message).toBeNull();
    // Effacée à son délai (sauf si une autre l'a remplacée), ou par la touche suivante.
    expect(clearFlash(state, 'hint', state.hint!.id).hint).toBeNull();
    const again = applyAction(state, 'bottomPrevious').state;
    expect(again.hint?.text).toBe(NO_EFFECT_HINTS.dress);
    expect(clearFlash(again, 'hint', state.hint!.id).hint).not.toBeNull();
    expect(applyAction(state, 'next').state.hint).toBeNull();
    // Une touche sans action l'efface aussi.
    expect(unmappedKey(state).hint).toBeNull();
  });

  it('sans veste propre, avec un seul haut, un seul bas ou une seule robe : la phrase qui dit pourquoi', () => {
    const noJacket = onTop({ items: ITEMS.filter((item) => item.category !== 'veste') });
    expect(applyAction(noJacket, 'jacket').state.hint?.text).toBe(NO_EFFECT_HINTS.noJacket);
    const oneTop = onTop({ items: ITEMS.filter((item) => item.id !== 'h2' && item.id !== 'r1') });
    expect(oneTop.browse!.tops).toHaveLength(1);
    expect(applyAction(oneTop, 'next').state.hint?.text).toBe(NO_EFFECT_HINTS.oneTop);
    expect(applyAction(oneTop, 'previous').state.selection).toEqual(oneTop.selection);
    const oneBottom = onTop({ items: ITEMS.filter((item) => item.id !== 'b2') });
    expect(applyAction(oneBottom, 'bottomNext').state.hint?.text).toBe(NO_EFFECT_HINTS.oneBottom);
    const oneDress = ready({ items: ITEMS.filter((item) => item.category === 'robe') });
    expect(applyAction(oneDress, 'next').state.hint?.text).toBe(NO_EFFECT_HINTS.oneDress);
    // Une touche qui change la tenue ne dit rien.
    expect(applyAction(onTop(), 'next').state.hint).toBeNull();
    expect(applyAction(onTop(), 'jacket').state.hint).toBeNull();
  });

  it('← → sous une veste : seule la note « Sous la veste » change, et elle s’éclaire 1 s', () => {
    const withJacket = applyAction(onTop(), 'jacket').state;
    expect(withJacket.noteLit).toBeNull();
    const next = applyAction(withJacket, 'next').state;
    expect(next.selection.top).not.toBe(withJacket.selection.top);
    expect(currentOutfit(next)!.drawn_ids).toEqual(currentOutfit(withJacket)!.drawn_ids);
    expect(next.noteLit).not.toBeNull();
    expect(clearFlash(next, 'noteLit', next.noteLit!.id).noteLit).toBeNull();
    // Sans veste, le haut se voit : rien à éclairer. La touche suivante l'éteint.
    expect(applyAction(onTop(), 'next').state.noteLit).toBeNull();
    expect(applyAction(next, 'bottomNext').state.noteLit).toBeNull();
  });

  it('« oui » le matin : la tenue reste affichée, puis « Choisie » ; une autre tenue ne l’est pas', () => {
    const state = applyAction(ready(), 'bottomNext').state;
    const { state: accepted, post } = applyAction(state, 'accept');
    expect(accepted.message).toMatchObject({ text: ACCEPT_MESSAGES.today, kind: 'accepted' });
    expect(messageHidesOutfit(accepted.message)).toBe(false);
    expect(post?.body).toMatchObject({ target: 'history' });
    // La tenue portée est corrigée tout de suite, sans attendre la relecture.
    const after = clearMessage(accepted, accepted.message!.id);
    const outfit = currentOutfit(state)!;
    expect(after.payload!.history).toEqual([{ date: '2026-10-24', item_ids: outfit.item_ids, title: outfit.title }]);
    expect(isCurrentChosen(after)).toBe(true);
    expect(currentMark(after)).toBe(OUTFIT_MARKS.chosen);
    const other = applyAction(after, 'bottomNext').state;
    expect(currentMark(other)).toBeNull();
    // Un second « oui » sur une autre tenue la remplace : une seule tenue portée par jour.
    const changed = applyAction(other, 'accept').state;
    expect(changed.payload!.history).toHaveLength(1);
    expect(isCurrentChosen(changed)).toBe(true);
    expect(isCurrentChosen(applyAction(changed, 'bottomPrevious').state)).toBe(false);
  });

  it('« Choisie » passe avant « Prévue », « Prévue » avant « Écartée »', () => {
    const plan = { date: '2026-10-24', item_ids: ['h2', 'b2', 'c1'], confirmed: true };
    const planned = ready({ plan });
    expect(currentMark(planned)).toBe(OUTFIT_MARKS.planned);
    // Une tenue portée enregistrée ailleurs, avec ses chaussures : comparée sans elles.
    const worn = ready({ plan, history: [{ date: '2026-10-24', item_ids: ['h2', 'b2', 'c1'], title: null }] });
    expect(currentMark(worn)).toBe(OUTFIT_MARKS.chosen);
    // Prévue et refusée : « Prévue ».
    const refusedPlan = { ...planned, payload: { ...planned.payload!, refusals: [{ item_ids: ['b2', 'h2'] }] } };
    expect(isCurrentRefused(refusedPlan)).toBe(true);
    expect(currentMark(refusedPlan)).toBe(OUTFIT_MARKS.planned);
    const start = ready();
    const back = applyAction(applyAction(start, 'refuse').state, 'previous').state;
    expect(currentMark(back)).toBe(OUTFIT_MARKS.refused);
    // Une tenue portée hier n'est pas « Choisie » aujourd'hui.
    const yesterday = ready({ history: [{ date: '2026-10-23', item_ids: currentOutfit(start)!.item_ids, title: null }] });
    expect(isCurrentChosen(yesterday)).toBe(false);
  });

  it('« Choisie » tient à la relecture tant que le « oui » est en file, et part avec « Recommencer »', () => {
    const accepted = applyAction(ready(), 'accept');
    const choices = pendingChoices([{ ...accepted.post!, id: 'j1', attempts: 0 }]);
    expect(choices.map((choice) => choice.kind)).toEqual(['history']);
    const data = pendingPayload(payload(), choices);
    const reloaded = loaded(accepted.state, data, buildBrowse(data, []), NOW + 1, null);
    expect(isCurrentChosen(reloaded)).toBe(true);
    // « Recommencer » efface la tenue portée du jour : plus « Choisie ».
    const restarted = applyAction(applyAction(reloaded, 'restart').state, 'restart');
    expect(restarted.state.payload!.history).toEqual([]);
    const both = [...choices, ...pendingChoices([{ ...restarted.post!, id: 'r', attempts: 0 }])];
    expect(pendingPayload(payload(), both).history).toEqual([]);
  });

  it('« Prête pour demain » garde aussi la tenue affichée ; « On recommence » dure 1,5 s et la cache', () => {
    const evening = ready({ isTomorrow: true, targetDate: '2026-10-25' });
    const accepted = applyAction(evening, 'accept').state;
    expect(accepted.message).toMatchObject({ text: ACCEPT_MESSAGES.tomorrow, kind: 'accepted' });
    expect(messageHidesOutfit(accepted.message)).toBe(false);
    expect(messageDuration(accepted.message!)).toBe(MESSAGE_MS);
    expect(currentMark(clearMessage(accepted, accepted.message!.id))).toBe(OUTFIT_MARKS.planned);
    const confirm = applyAction(evening, 'restart').state;
    expect(messageHidesOutfit(confirm.message)).toBe(true);
    expect(messageDuration(confirm.message!)).toBe(MESSAGE_MS);
    const done = applyAction(confirm, 'restart').state;
    expect(done.message?.kind).toBe('restart-done');
    expect(messageHidesOutfit(done.message)).toBe(true);
    expect(messageDuration(done.message!)).toBe(RESTART_DONE_MS);
  });

  it('« non » : « écartée » à la place de « non » dans la légende, effacé à son délai ou par la touche suivante', () => {
    const refused = applyAction(ready(), 'refuse').state;
    expect(refused.refusedFlash).not.toBeNull();
    expect(clearFlash(refused, 'refusedFlash', refused.refusedFlash!.id).refusedFlash).toBeNull();
    expect(applyAction(refused, 'next').state.refusedFlash).toBeNull();
    // Un « non » qui ne fait qu'effacer « Touches enregistrées » ne l'affiche pas.
    const saved: MirrorState = { ...ready(), message: { id: 99, text: KEYS_SAVED_MESSAGE, kind: 'keys-saved' } };
    expect(applyAction(saved, 'refuse').state.refusedFlash).toBeNull();
  });

  it('la veille efface les retours en texte', () => {
    const hinted = applyAction(onDress(), 'bottomNext').state;
    const refused = applyAction(ready(), 'refuse').state;
    for (const state of [hinted, refused]) {
      const asleep = fallAsleep(state);
      expect([asleep.hint, asleep.noteLit, asleep.refusedFlash]).toEqual([null, null, null]);
    }
  });
});
