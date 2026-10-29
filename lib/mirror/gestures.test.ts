import { describe, expect, it } from 'vitest';
import {
  cameraPacing,
  createGestureState,
  disarm,
  stepGestures,
  type GestureOutput,
  type HoldView,
} from '@/lib/gestures';
import { PLACES, Script, frameOf, type Place } from '@/lib/gestures/test-poses';
import type { KeyAction } from '@/lib/types';
import { buildBrowse } from './browse';
import {
  PRESENCE_ACTIVITY_MS,
  acceptsGestures,
  actionLabel,
  confirmWaits,
  debugDrawing,
  disabledHolds,
  framesPerSecond,
  gestureEffect,
  handsLabel,
  presenceLabel,
  recentTimes,
  recognizedLabel,
  sameHold,
  type GestureEffect,
} from './gestures';
import {
  ACCEPT_MESSAGES,
  applyAction,
  currentOutfit,
  fallAsleep,
  initialMirrorState,
  loadFailed,
  loaded,
  openKeyTest,
  wake,
  type MirrorState,
} from './state';
import { payload } from './test-fixtures';

const NOW = 1_000_000;
const { chestRight, sideRight, sideLeft } = PLACES;

function ready(): MirrorState {
  const data = payload();
  return loaded(initialMirrorState, data, buildBrowse(data, []), NOW, null);
}

/** Une image de la machine, réduite à ce que lit le miroir. */
function output(partial: Partial<GestureOutput> = {}): GestureOutput {
  return {
    actions: [],
    present: true,
    body: true,
    turned: false,
    hold: null,
    hands: { left: null, right: null },
    zones: null,
    recognized: null,
    ...partial,
  };
}

/**
 * Le miroir et la caméra ensemble, comme components/mirror/mirror.tsx et gestures/camera.ts : une
 * horloge d'écran à 60 Hz, cameraPacing, stepGestures (avec les gestes tenus que l'écran ne peut
 * pas faire), puis gestureEffect ; le réveil et les écrans qui n'acceptent pas de geste oublient les
 * gestes commencés (disarm) ; les actions passent par les garde-fous de perform puis applyAction,
 * comme leurs touches. `shown` : la silhouette de la légende est-elle dessinée à cet instant ?
 */
function simulate(script: Script, start: MirrorState, options: { shown?: (t: number) => boolean } = {}) {
  let gestures = createGestureState();
  let mirror = start;
  const applied: KeyAction[] = [];
  const effects: Array<GestureEffect & { t: number }> = [];
  let wakes = 0;
  const tick = 1000 / 60;
  for (let i = 0; i * tick <= script.duration; i++) {
    const t = i * tick;
    const pacing = cameraPacing(gestures, t);
    if (!pacing.runPose) continue;
    const shown = () => options.shown?.(t) ?? true;
    const frame = frameOf(t, script.shotAt(t), pacing.runRecognizer);
    const step = stepGestures(gestures, { ...frame, disabledHolds: disabledHolds(mirror, shown) });
    gestures = step.state;
    const effect = gestureEffect(mirror, step.output);
    effects.push({ ...effect, t });
    if (effect.disarm) gestures = disarm(gestures);
    if (effect.wake) {
      mirror = wake(mirror);
      gestures = disarm(gestures);
      wakes += 1;
      continue;
    }
    for (const action of effect.actions) {
      // perform : « oui » et « non » ne font rien tant que la silhouette de la légende n'est pas là.
      if ((action === 'accept' || action === 'refuse') && confirmWaits(mirror, shown)) continue;
      applied.push(action);
      mirror = applyAction(mirror, action).state;
    }
  }
  return { mirror, applied, effects, wakes };
}

/** Main droite devant la poitrine, puis sortie à sa droite : haut suivant. */
const sweep = (script: Script, to: Place = sideRight) =>
  script.move(350, { right: chestRight }).stay(150).move(200, { right: to }).stay(300);

/** Main droite levée devant la poitrine, pouce levé (ou autre geste) tenu. */
const hold = (script: Script, gesture: string, ms = 1_400) =>
  script.move(350, { right: chestRight }).stay(200).stay(ms, { gesture: { right: gesture } });

describe('gestes sur le miroir : exactement ce que font les touches', () => {
  it('main sortie à sa droite : haut suivant, comme →', () => {
    const start = ready();
    const { applied, mirror } = simulate(sweep(new Script().stay(300)), start);
    expect(applied).toEqual(['next']);
    expect(mirror.selection).toEqual(applyAction(start, 'next').state.selection);
  });

  it('main sortie à sa gauche : haut précédent, comme ←', () => {
    const start = ready();
    const { applied, mirror } = simulate(sweep(new Script().stay(300), sideLeft), start);
    expect(applied).toEqual(['previous']);
    expect(mirror.selection).toEqual(applyAction(start, 'previous').state.selection);
  });

  it('pouce levé tenu 1 s : « oui », comme Entrée ; l’anneau se remplit avant', () => {
    const { applied, mirror, effects } = simulate(hold(new Script().stay(300), 'Thumb_Up'), ready());
    expect(applied).toEqual(['accept']);
    expect(mirror.message?.text).toBe(ACCEPT_MESSAGES.today);
    const rings = effects.map((effect) => effect.hold).filter((ring): ring is HoldView => ring !== null);
    expect(rings.length).toBeGreaterThan(10);
    expect(rings.every((ring) => ring.action === 'accept')).toBe(true);
  });

  it('poing fermé tenu 1 s : « non » ; signe V tenu 1 s : veste suivante', () => {
    expect(simulate(hold(new Script().stay(300), 'Closed_Fist'), ready()).applied).toEqual(['refuse']);
    const start = ready();
    const jacket = simulate(hold(new Script().stay(300), 'Victory'), start);
    expect(jacket.applied).toEqual(['jacket']);
    expect(jacket.mirror.selection).toEqual(applyAction(start, 'jacket').state.selection);
  });

  it('debout, bras le long du corps, 10 s : rien, mais la présence tient l’écran éveillé', () => {
    const { applied, effects } = simulate(new Script().stay(10_000), ready());
    expect(applied).toEqual([]);
    expect(effects.every((effect) => effect.activity)).toBe(true);
  });
});

describe('veille et présence', () => {
  it('endormi : quelqu’un qui arrive réveille l’écran, et rien d’autre', () => {
    const asleep = fallAsleep(ready());
    const script = new Script().stay(1_000, { person: 'absent' }).stay(600, { person: 'present' });
    const { applied, wakes, mirror } = simulate(script, asleep);
    expect(wakes).toBe(1);
    expect(applied).toEqual([]);
    expect(mirror.sleeping).toBe(false);
    expect(currentOutfit(mirror)?.key).toBe(currentOutfit(asleep)?.key);
  });

  it('arrivée pouce déjà levé et le garde 2 s : rien ; baissé puis relevé 1,2 s : « oui »', () => {
    const asleep = fallAsleep(ready());
    const arrive = () =>
      new Script()
        .stay(1_000, { person: 'absent' })
        .stay(2_000, { person: 'present', right: chestRight, gesture: { right: 'Thumb_Up' } });
    const kept = simulate(arrive(), asleep);
    expect(kept.wakes).toBe(1);
    expect(kept.applied).toEqual([]);
    expect(kept.effects.every((effect) => effect.hold === null)).toBe(true);
    const again = arrive().stay(400, { gesture: { right: 'None' } }).stay(1_200, { gesture: { right: 'Thumb_Up' } });
    expect(simulate(again, asleep).applied).toEqual(['accept']);
  });

  it('arrivée le poing ou le V déjà faits : rien', () => {
    for (const gesture of ['Closed_Fist', 'Victory']) {
      const arrive = new Script()
        .stay(1_000, { person: 'absent' })
        .stay(2_000, { person: 'present', right: chestRight, gesture: { right: gesture } });
      expect(simulate(arrive, fallAsleep(ready())).applied).toEqual([]);
    }
  });

  it('arrivée la main déjà devant la poitrine, puis la sort sur le côté : rien', () => {
    const arrive = () =>
      new Script()
        .stay(1_000, { person: 'absent' })
        .stay(300, { person: 'present', right: chestRight })
        .move(200, { right: sideRight })
        .stay(300);
    expect(simulate(arrive(), fallAsleep(ready())).applied).toEqual([]);
    // Revenue devant la poitrine, puis sortie : haut suivant.
    expect(simulate(sweep(arrive()), fallAsleep(ready())).applied).toEqual(['next']);
  });

  it('arrivée bras le long du corps : le premier geste compte, sans rien relâcher', () => {
    const arrive = () => new Script().stay(1_000, { person: 'absent' }).stay(400, { person: 'present' });
    expect(simulate(sweep(arrive()), fallAsleep(ready())).applied).toEqual(['next']);
    expect(simulate(hold(arrive(), 'Thumb_Up'), fallAsleep(ready())).applied).toEqual(['accept']);
  });

  it('personne devant le miroir endormi : rien ne se déclenche, il dort', () => {
    const asleep = fallAsleep(ready());
    const { applied, wakes, mirror } = simulate(new Script().stay(5_000, { person: 'absent' }), asleep);
    expect(wakes).toBe(0);
    expect(applied).toEqual([]);
    expect(mirror.sleeping).toBe(true);
  });

  it('une image endormie ne fait jamais d’action, même si la machine en donne une', () => {
    const effect = gestureEffect(fallAsleep(ready()), output({ actions: ['next'] }));
    expect(effect).toEqual({ wake: true, activity: true, actions: [], disarm: true, hold: null });
    const nobody = gestureEffect(fallAsleep(ready()), output({ present: false, actions: ['next'] }));
    expect(nobody).toEqual({ wake: false, activity: false, actions: [], disarm: true, hold: null });
  });

  it('écran éveillé : la présence repousse la veille, l’absence non', () => {
    expect(gestureEffect(ready(), output()).activity).toBe(true);
    expect(gestureEffect(ready(), output({ present: false })).activity).toBe(false);
    expect(PRESENCE_ACTIVITY_MS).toBe(1_000);
  });
});

describe('écrans qui n’acceptent pas de geste', () => {
  const ring: HoldView = { action: 'accept', side: 'right', progress: 0.5 };

  it('pendant « Chargement… » : rien, pas même la présence', () => {
    expect(gestureEffect(initialMirrorState, output({ actions: ['next'], hold: ring }))).toEqual({
      wake: false,
      activity: false,
      actions: [],
      disarm: true,
      hold: null,
    });
  });

  it('écran de problème : la présence le tient éveillé et le réveille, les gestes ne font rien', () => {
    const problem = loadFailed(initialMirrorState, 'unreachable');
    expect(acceptsGestures(problem)).toBe(false);
    expect(gestureEffect(problem, output({ actions: ['next'], hold: ring }))).toEqual({
      wake: false,
      activity: true,
      actions: [],
      disarm: true,
      hold: null,
    });
    expect(gestureEffect(fallAsleep(problem), output()).wake).toBe(true);
  });

  it('test des touches (?touches=test) : les gestes sont oubliés, rien ne part à sa fermeture', () => {
    const testing = openKeyTest(ready());
    expect(acceptsGestures(testing)).toBe(false);
    const { applied, effects } = simulate(sweep(new Script().stay(300)), testing);
    expect(applied).toEqual([]);
    expect(effects.every((effect) => effect.disarm && effect.hold === null)).toBe(true);
  });

  it('la composition éveillée accepte les gestes et montre l’anneau', () => {
    const state = ready();
    expect(acceptsGestures(state)).toBe(true);
    expect(gestureEffect(state, output({ hold: ring, actions: ['refuse'] }))).toEqual({
      wake: false,
      activity: true,
      actions: ['refuse'],
      disarm: false,
      hold: ring,
    });
  });
});

describe('« oui » et « non » attendent la silhouette de la légende', () => {
  it('pouce tenu pendant que la silhouette se prépare : ni anneau, ni « oui » perdu ; il part 1 s après', () => {
    // La silhouette de la légende n'est dessinée qu'à 1,5 s (pouce levé dès ≈ 0,9 s).
    const drawnAt = 1_500;
    const { applied, effects } = simulate(hold(new Script().stay(300), 'Thumb_Up', 2_400), ready(), {
      shown: (t) => t >= drawnAt,
    });
    expect(effects.filter(({ t }) => t < drawnAt).every((effect) => effect.hold === null)).toBe(true);
    expect(effects.some((effect) => effect.hold?.action === 'accept')).toBe(true);
    expect(applied).toEqual(['accept']);
    const accepted = effects.find((effect) => effect.actions.includes('accept'))!;
    expect(accepted.t - drawnAt).toBeGreaterThanOrEqual(1_000);
  });

  it('poing tenu pendant l’attente : « non » seulement une fois la silhouette dessinée', () => {
    // Sans attente, le « non » partirait vers 1,85 s : la silhouette n'est dessinée qu'à 2 s.
    const { applied } = simulate(hold(new Script().stay(300), 'Closed_Fist', 2_400), ready(), {
      shown: (t) => t >= 2_000,
    });
    expect(applied).toEqual(['refuse']);
  });

  it('le V reste libre pendant l’attente', () => {
    const { applied } = simulate(hold(new Script().stay(300), 'Victory'), ready(), { shown: () => false });
    expect(applied).toEqual(['jacket']);
  });

  it('pendant un message qui cache la tenue (et la légende avec son anneau) : aucun geste tenu ne commence', () => {
    const prompting = applyAction(ready(), 'restart').state;
    expect(prompting.message).not.toBeNull();
    // Les touches Entrée et Retour arrière n'attendent pas : elles effacent le message.
    expect(confirmWaits(prompting, () => false)).toBe(false);
    // Mais un pouce, un poing ou un V tenus rempliraient un anneau invisible : ils ne commencent pas.
    expect(disabledHolds(prompting, () => true)).toEqual(['accept', 'refuse', 'jacket']);
    expect(confirmWaits(ready(), () => false)).toBe(true);
    expect(disabledHolds(ready(), () => false)).toEqual(['accept', 'refuse']);
    expect(disabledHolds(ready(), () => true)).toEqual([]);
    // Écran qui n'accepte pas de geste : rien à désactiver (tout y est oublié de toute façon).
    expect(disabledHolds(fallAsleep(ready()), () => false)).toEqual([]);
  });

  it('« Appuie encore pour recommencer » : un pouce tenu ne fait rien ni ne remplit d’anneau ; un défilement efface le message', () => {
    const prompting = applyAction(ready(), 'restart').state;
    const held = simulate(hold(new Script().stay(300), 'Thumb_Up', 2_000), prompting);
    expect(held.applied).toEqual([]);
    expect(held.effects.every(({ hold: ring }) => ring === null)).toBe(true);
    expect(held.mirror.message).toEqual(prompting.message);
    const swept = simulate(sweep(new Script().stay(300)), prompting);
    expect(swept.applied).toEqual(['next']);
    expect(swept.mirror.message).toBeNull();
    // La tenue n'a pas changé : le défilement a seulement effacé le message.
    expect(currentOutfit(swept.mirror)?.key).toBe(currentOutfit(prompting)?.key);
  });
});

describe('anneau et mesures', () => {
  it('même anneau à 1 % près : pas de nouveau dessin', () => {
    const ring: HoldView = { action: 'accept', side: 'right', progress: 0.5 };
    expect(sameHold(ring, { ...ring, progress: 0.505 })).toBe(true);
    expect(sameHold(ring, { ...ring, progress: 0.52 })).toBe(false);
    expect(sameHold(ring, { ...ring, action: 'refuse' })).toBe(false);
    expect(sameHold(ring, { ...ring, side: 'left' })).toBe(false);
    expect(sameHold(null, null)).toBe(true);
    expect(sameHold(ring, null)).toBe(false);
  });

  it('images/s : les instants de la dernière seconde', () => {
    expect(recentTimes([0, 100, 950, 1_000, 1_900, 2_000], 2_000)).toEqual([1_900, 2_000]);
    expect(recentTimes([0, 500], 999)).toEqual([0, 500]);
    expect(recentTimes([], 10)).toEqual([]);
  });

  it('images/s d’après l’intervalle moyen : 30 et 10, pas 31 et 11 (essai sur vidéo)', () => {
    // PoseLandmarker à 30 images/s, à quelques ms près (cameraPacing tolère 4 ms) : 31 images dans
    // la dernière seconde.
    const pose = Array.from({ length: 31 }, (_, i) => 10_000 + i * 33 + (i % 3 === 0 ? 0 : 1));
    const now = pose.at(-1)!;
    expect(recentTimes(pose, now)).toHaveLength(31);
    expect(framesPerSecond(pose, now)).toBe(30);
    // Gesture Recognizer : 96 à 104 ms entre deux images, 11 dans la dernière seconde.
    const recognizer = Array.from({ length: 11 }, (_, i) => 20_000 + i * 96);
    expect(recentTimes(recognizer, recognizer.at(-1)!)).toHaveLength(11);
    expect(framesPerSecond(recognizer, recognizer.at(-1)!)).toBe(10);
    // Personne : 5 images/s.
    const idle = Array.from({ length: 5 }, (_, i) => 30_000 + i * 200);
    expect(framesPerSecond(idle, idle.at(-1)!)).toBe(5);
    // Le Gesture Recognizer s'est arrêté il y a 600 ms : le compte baisse.
    expect(framesPerSecond(recognizer, recognizer.at(-1)! + 600)).toBe(4);
    expect(framesPerSecond([], 10)).toBe(0);
    expect(framesPerSecond([10], 10)).toBe(1);
  });
});

describe('?gestures=debug', () => {
  it('zones et mains retournées comme un miroir : sa main droite à droite de l’écran', () => {
    // Main droite levée sur le côté : dans l'image brute, à gauche (petits x).
    const shot = { left: PLACES.restLeft, right: sideRight };
    const frame = frameOf(0, shot, false);
    const { output: seen } = stepGestures(createGestureState(), frame);
    const drawing = debugDrawing(seen, frame.aspect);
    expect(drawing.width).toBeCloseTo(frame.aspect);
    const right = drawing.hands.find((hand) => hand.side === 'right')!;
    const left = drawing.hands.find((hand) => hand.side === 'left')!;
    expect(seen.hands.right!.x).toBeLessThan(0.5);
    expect(right.x).toBeGreaterThan(drawing.width / 2);
    expect(left.x).toBeLessThan(drawing.width / 2);
    expect(right.x).toBeCloseTo((1 - seen.hands.right!.x) * frame.aspect);
    // La poitrine : un rectangle centré sur le buste, de la zone au-dessus des épaules à la taille.
    const chest = drawing.rects.find((rect) => rect.id === 'chest')!;
    const zones = seen.zones!;
    expect(chest.x).toBeCloseTo((1 - zones.chest.x1) * frame.aspect);
    expect(chest.width).toBeCloseTo((zones.chest.x1 - zones.chest.x0) * frame.aspect);
    expect(chest.y).toBe(zones.chest.y0);
    expect(chest.height).toBeCloseTo(zones.chest.y1 - zones.chest.y0);
    // Ligne du côté droit (à sa droite) : à droite de l'écran, entre les lignes du haut et du bas.
    const sideLine = drawing.lines.find((line) => line.id === 'side-right')!;
    expect(sideLine.x1).toBeGreaterThan(chest.x + chest.width);
    expect([sideLine.y1, sideLine.y2]).toEqual([zones.upY, zones.downY]);
    expect(drawing.lines.map((line) => line.id).sort()).toEqual(['down', 'side-left', 'side-right', 'up', 'waist']);
    // Les cuisses : jusqu'au bas de l'image.
    const thighs = drawing.rects.find((rect) => rect.id === 'thighs')!;
    expect(thighs.y + thighs.height).toBeCloseTo(1);
  });

  it('corps mal vu : ni zones ni mains', () => {
    expect(debugDrawing(output({ body: false }), 0.75)).toEqual({ width: 0.75, rects: [], lines: [], hands: [] });
  });

  it('en mots : présence, geste reconnu et score, dernier geste', () => {
    expect(presenceLabel({ present: false, body: false, turned: false })).toBe('Personne');
    expect(presenceLabel({ present: true, body: false, turned: false })).toBe('Recule : épaules et hanches mal vues');
    expect(presenceLabel({ present: true, body: false, turned: true })).toBe('De profil : épaules confondues');
    expect(presenceLabel({ present: true, body: true, turned: false })).toBe('Présente');
    expect(handsLabel({ left: null, right: null })).toBe('Gauche : — · Droite : —');
    expect(
      handsLabel({ left: { state: 'rest', armMinU: null }, right: { state: 'armed', armMinU: 0.1749 } }),
    ).toBe('Gauche : au repos · Droite : armée (0,17)');
    expect(handsLabel({ left: { state: 'rest', armMinU: 0.78 }, right: { state: 'locked', armMinU: null } })).toBe(
      'Gauche : au repos (0,78) · Droite : bloquée',
    );
    expect(recognizedLabel({ category: 'Thumb_Up', score: 0.8712 })).toBe('Thumb_Up 0,87');
    expect(actionLabel('next')).toBe('haut suivant');
    expect(actionLabel('accept')).toBe('accepter');
  });
});
