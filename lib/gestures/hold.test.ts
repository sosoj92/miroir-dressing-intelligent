import { describe, expect, it } from 'vitest';
import { HOLD_MS, HOLD_PAUSE_MS } from './constants';
import { createGestureState, disarm, stepGestures } from './tracker';
import { PLACES, STANDING, Script, actionsOf, frameOf, play, raiseBothLate, type Place, type Played } from './test-poses';

const { restRight, chestLeft, chestRight, sideRight, shoulderRight } = PLACES;

/** Lève la main droite (devant la poitrine par défaut) et l'y laisse. */
const raiseRight = (script: Script, place: Place = chestRight) => script.stay(300).move(350, { right: place }).stay(200);

/** Première image où le Gesture Recognizer a vu ce geste tenu. */
function holdStart(played: Played): number {
  return played.outputs.find(({ output }) => output.hold !== null)!.t;
}

describe('gestes tenus 1 s', () => {
  it('pouce levé tenu 1 s : oui, une fois, au bout d’1 s', () => {
    const played = play(raiseRight(new Script()).stay(1_400, { gesture: { right: 'Thumb_Up' } }).stay(400, { gesture: {} }));
    expect(played.actions.map((a) => a.action)).toEqual(['accept']);
    const start = holdStart(played);
    const at = played.actions[0].t;
    expect(at - start).toBeGreaterThanOrEqual(HOLD_MS);
    expect(at - start).toBeLessThan(HOLD_MS + 40);
  });

  it('l’anneau se remplit pendant la seconde (≈ 0,5 à 0,5 s), puis disparaît une fois validé', () => {
    const played = play(raiseRight(new Script()).stay(1_400, { gesture: { right: 'Thumb_Up' } }));
    const start = holdStart(played);
    const half = played.outputs.find(({ t }) => t >= start + 500)!;
    expect(half.output.hold).toMatchObject({ action: 'accept', side: 'right' });
    expect(half.output.hold!.progress).toBeGreaterThan(0.45);
    expect(half.output.hold!.progress).toBeLessThan(0.56);
    const progress = played.outputs.filter(({ output }) => output.hold).map(({ output }) => output.hold!.progress);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    const accepted = played.actions[0].t;
    expect(played.outputs.find(({ t }) => t === accepted)!.output.hold).toBeNull();
  });

  it('poing fermé tenu 1 s : non', () => {
    const played = play(raiseRight(new Script()).stay(1_300, { gesture: { right: 'Closed_Fist' } }));
    expect(actionsOf(played)).toEqual(['refuse']);
  });

  it('signe V tenu 1 s : veste suivante', () => {
    const played = play(raiseRight(new Script()).stay(1_300, { gesture: { right: 'Victory' } }));
    expect(actionsOf(played)).toEqual(['jacket']);
  });

  it('avec la main gauche aussi, et à côté de l’épaule (hors de la poitrine)', () => {
    const left = play(
      new Script().stay(300).move(350, { left: chestLeft }).stay(200).stay(1_300, { gesture: { left: 'Thumb_Up' } }),
    );
    expect(actionsOf(left)).toEqual(['accept']);
    const side = play(raiseRight(new Script(), shoulderRight).stay(1_300, { gesture: { right: 'Thumb_Up' } }));
    expect(actionsOf(side)).toEqual(['accept']);
  });

  it('pouce tenu 4 s : un seul oui (il faut le relâcher pour recommencer)', () => {
    const played = play(raiseRight(new Script()).stay(4_000, { gesture: { right: 'Thumb_Up' } }));
    expect(actionsOf(played)).toEqual(['accept']);
  });

  it('pouce interrompu à 0,6 s : rien ; repris, il faut une seconde entière', () => {
    const interrupted = play(
      raiseRight(new Script()).stay(600, { gesture: { right: 'Thumb_Up' } }).stay(500, { gesture: { right: 'None' } }),
    );
    expect(actionsOf(interrupted)).toEqual([]);
    const resumed = play(
      raiseRight(new Script())
        .stay(600, { gesture: { right: 'Thumb_Up' } })
        .stay(500, { gesture: { right: 'None' } })
        .stay(1_300, { gesture: { right: 'Thumb_Up' } }),
    );
    expect(actionsOf(resumed)).toEqual(['accept']);
    expect(resumed.actions[0].t).toBeGreaterThanOrEqual(850 + 600 + 500 + HOLD_MS);
  });

  it.each([750, 900, 970, 1_000])(
    'pouce relâché à %i ms (main ouverte ensuite) : pas de oui, même pendant le délai de grâce',
    (heldMs) => {
      const played = play(
        raiseRight(new Script())
          .stay(heldMs, { gesture: { right: 'Thumb_Up' } })
          .stay(800, { gesture: { right: 'Open_Palm' } }),
      );
      expect(actionsOf(played)).toEqual([]);
      // L'anneau s'arrête peu après le relâchement, sans se remplir, puis s'efface.
      const start = holdStart(played);
      const shown = played.outputs.filter(({ output }) => output.hold).map(({ t, output }) => ({ t, p: output.hold!.progress }));
      expect(Math.max(...shown.map(({ p }) => p))).toBeLessThan(1);
      expect(shown.at(-1)!.t).toBeLessThanOrEqual(start + heldMs + 300 + 100);
      expect(played.outputs.at(-1)!.output.hold).toBeNull();
    },
  );

  it('pouce tenu 1 s avec une image hésitante juste avant la fin : oui, à l’image suivante qui le voit', () => {
    const played = play(
      raiseRight(new Script())
        .stay(950, { gesture: { right: 'Thumb_Up' } })
        .stay(100, { gesture: { right: 'None' } })
        .stay(400, { gesture: { right: 'Thumb_Up' } }),
    );
    expect(actionsOf(played)).toEqual(['accept']);
    const start = holdStart(played);
    expect(played.actions[0].t - start).toBeGreaterThanOrEqual(HOLD_MS);
    expect(played.actions[0].t - start).toBeLessThan(HOLD_MS + 150);
  });

  it('une image hésitante du Gesture Recognizer ne rompt pas le maintien', () => {
    const played = play(
      raiseRight(new Script())
        .stay(500, { gesture: { right: 'Thumb_Up' } })
        .stay(120, { gesture: { right: 'None' } })
        .stay(700, { gesture: { right: 'Thumb_Up' } }),
    );
    expect(actionsOf(played)).toEqual(['accept']);
    expect(played.actions[0].t - holdStart(played)).toBeLessThan(HOLD_MS + 40);
  });

  it('une image où le corps est mal vu ne rompt pas le maintien', () => {
    const played = play(
      raiseRight(new Script())
        .stay(500, { gesture: { right: 'Thumb_Up' } })
        .stay(34, { person: 'hipsPoor' })
        .stay(900, { person: 'present' }),
    );
    expect(actionsOf(played)).toEqual(['accept']);
    expect(played.actions[0].t - holdStart(played)).toBeLessThan(HOLD_MS + 40);
  });

  it('une image sans personne ne rompt pas le maintien (pouce à côté de l’épaule)', () => {
    const played = play(
      raiseRight(new Script(), shoulderRight)
        .stay(900, { gesture: { right: 'Thumb_Up' } })
        .stay(34, { person: 'absent' })
        .stay(600, { person: 'present' }),
    );
    expect(actionsOf(played)).toEqual(['accept']);
    expect(played.actions[0].t - holdStart(played)).toBeLessThan(HOLD_MS + 40);
  });

  it('corps mal vu plus de 300 ms pendant le maintien : il est rompu', () => {
    const played = play(
      raiseRight(new Script())
        .stay(500, { gesture: { right: 'Thumb_Up' } })
        .stay(400, { person: 'hipsPoor' })
        .stay(900, { person: 'present' }),
    );
    expect(actionsOf(played)).toEqual([]);
  });

  it('corps mal vu plus de 300 ms : rompu, même si le Gesture Recognizer voit le pouce à chaque image', () => {
    let state = createGestureState();
    const actions: string[] = [];
    for (let t = 0; t <= 1_800; t += 33) {
      const person = t >= 500 && t < 900 ? 'hipsPoor' : 'present';
      const shot = { ...STANDING, right: chestRight, gesture: { right: 'Thumb_Up' }, person } as const;
      const step = stepGestures(state, frameOf(t, shot, true));
      state = step.state;
      actions.push(...step.output.actions);
    }
    expect(actions).toEqual([]);
  });

  it('pouce interrompu par la main qui redescend sous la taille : rien', () => {
    const played = play(
      raiseRight(new Script())
        .stay(600, { gesture: { right: 'Thumb_Up' } })
        .move(300, { right: restRight, gesture: { right: 'Thumb_Up' } })
        .stay(800),
    );
    expect(actionsOf(played)).toEqual([]);
  });

  it('main qui bouge pendant le maintien : il repart de zéro', () => {
    const played = play(
      raiseRight(new Script())
        .stay(700, { gesture: { right: 'Thumb_Up' } })
        .move(150, { right: { u: -0.5, v: 0.1 }, gesture: { right: 'Thumb_Up' } })
        .stay(600, { gesture: { right: 'Thumb_Up' } }),
    );
    expect(actionsOf(played)).toEqual([]);
  });

  it('score trop faible, ou autre catégorie (main ouverte, index levé, None) : rien', () => {
    for (const gesture of [{ category: 'Thumb_Up', score: 0.4 }, 'Open_Palm', 'Pointing_Up', 'Thumb_Down', 'ILoveYou', 'None']) {
      const played = play(raiseRight(new Script()).stay(2_000, { gesture: { right: gesture } }));
      expect(actionsOf(played)).toEqual([]);
    }
  });

  it('poing d’une main au repos le long du corps : rien (le Gesture Recognizer ne tourne même pas)', () => {
    const played = play(new Script().stay(3_000, { gesture: { left: 'Closed_Fist', right: 'Closed_Fist' } }));
    expect(actionsOf(played)).toEqual([]);
    expect(played.recognizerAt).toEqual([]);
  });

  it('sans présence ou corps mal vu : aucun geste tenu', () => {
    for (const person of ['hipsPoor', 'shouldersPoor'] as const) {
      const played = play(
        new Script({ ...STANDING, person }).stay(300).move(350, { right: chestRight }).stay(1_500, { gesture: { right: 'Thumb_Up' } }),
      );
      expect(actionsOf(played)).toEqual([]);
    }
    // Le Gesture Recognizer aurait tourné quand même : sans PoseLandmarker, rien.
    let state = createGestureState();
    for (let t = 0; t <= 2_000; t += 100) {
      const step = stepGestures(state, {
        t,
        aspect: 9 / 16,
        pose: null,
        hands: [{ category: 'Thumb_Up', score: 0.95, x: 0.5, y: 0.4 }],
      });
      state = step.state;
      expect(step.output.actions).toEqual([]);
    }
  });
});

describe('gestes tenus et défilements ne se mélangent pas', () => {
  it('pouce levé devant la poitrine puis main qui repart vers le côté : oui seulement', () => {
    const played = play(
      raiseRight(new Script())
        .stay(1_300, { gesture: { right: 'Thumb_Up' } })
        .move(250, { right: sideRight, gesture: {} })
        .stay(300)
        .move(400, { right: restRight })
        .stay(300),
    );
    expect(actionsOf(played)).toEqual(['accept']);
  });

  it('pouce gardé devant la poitrine après le oui, puis sortie sur le côté : rien de plus', () => {
    const played = play(
      raiseRight(new Script())
        .stay(1_200, { gesture: { right: 'Thumb_Up' } })
        .stay(1_200, { gesture: { right: 'None' } })
        .move(250, { right: sideRight })
        .stay(300),
    );
    expect(actionsOf(played)).toEqual(['accept']);
    const accepted = played.actions[0].t;
    const after = played.outputs.filter(({ t }) => t > accepted && t < accepted + 1_000);
    expect(after.every(({ output }) => output.hands.right?.state === 'locked')).toBe(true);
  });

  it('une fois sortie de la poitrine, la main se réarme normalement', () => {
    const played = play(
      raiseRight(new Script())
        .stay(1_200, { gesture: { right: 'Thumb_Up' } })
        .move(400, { right: restRight, gesture: {} })
        .stay(400)
        .move(350, { right: chestRight })
        .stay(150)
        .move(200, { right: sideRight })
        .stay(300),
    );
    expect(actionsOf(played)).toEqual(['accept', 'next']);
  });

  it('un défilement ne déclenche jamais un geste tenu : poing pendant le balayage et gardé sur le côté', () => {
    const played = play(
      new Script()
        .stay(300)
        .move(350, { right: chestRight, gesture: { right: 'Closed_Fist' } })
        .stay(150)
        .move(200, { right: sideRight })
        .stay(3_000),
    );
    expect(actionsOf(played)).toEqual(['next']);
  });

  it.each(['Closed_Fist', 'Thumb_Up', 'Victory'])(
    '%s levé tout droit au-dessus de la tête depuis la poitrine, et gardé 3 s : bas suivant seulement',
    (category) => {
      // Au milieu, la main est encore dans la zone de la poitrine de l'essai (qui monte au-dessus de
      // la ligne du haut) : ce n'est pas un retour devant la poitrine.
      const played = play(
        new Script()
          .stay(300)
          .move(350, { right: chestRight })
          .stay(150)
          .move(300, { right: PLACES.straightUp, gesture: { right: category } })
          .stay(3_000)
          .move(500, { right: restRight, gesture: {} })
          .stay(500),
      );
      expect(actionsOf(played)).toEqual(['bottomNext']);
    },
  );

  it('poing fermé sur les cheveux au-dessus de la tête (chignon), gardé 2,5 s : bas suivant seulement', () => {
    const played = play(
      new Script()
        .stay(300)
        .move(600, { right: PLACES.headTop })
        .move(300, { right: { u: 0.2, v: -0.75 }, gesture: { right: 'Closed_Fist' } })
        .stay(2_500)
        .move(600, { right: restRight, gesture: {} }),
    );
    expect(actionsOf(played)).toEqual(['bottomNext']);
  });

  it.each([0, 100, 300])(
    'deux poings levés tout droit ensemble (la droite %i ms après la gauche) et gardés : bas suivant seulement',
    (lag) => {
      const fists = { left: 'Closed_Fist', right: 'Closed_Fist' };
      const played = play(raiseBothLate(lag, { u: -0.3, v: -0.95 }, PLACES.straightUp, fists).stay(3_000));
      expect(actionsOf(played)).toEqual(['bottomNext']);
    },
  );

  it('l’autre main restée devant la poitrine pendant le bas suivant : son pouce compte ensuite', () => {
    const played = play(
      new Script()
        .stay(300)
        .move(350, { left: chestLeft, right: chestRight })
        .stay(200)
        .move(300, { right: PLACES.straightUp })
        .stay(300)
        .stay(1_500, { gesture: { left: 'Thumb_Up' } }),
    );
    expect(actionsOf(played)).toEqual(['bottomNext', 'accept']);
  });

  it('la main qui a fait bas suivant, redescendue devant la poitrine : son pouce compte', () => {
    const played = play(
      raiseRight(new Script())
        .move(300, { right: PLACES.straightUp })
        .stay(300)
        .move(300, { right: chestRight })
        .stay(1_500, { gesture: { right: 'Thumb_Up' } }),
    );
    expect(actionsOf(played)).toEqual(['bottomNext', 'accept']);
  });

  it('un défilement annule le maintien en cours de l’autre main', () => {
    const played = play(
      new Script()
        .stay(300)
        .move(350, { left: chestLeft, right: chestRight, gesture: { left: 'Thumb_Up' } })
        .stay(500)
        .move(200, { right: sideRight })
        .stay(400),
    );
    expect(actionsOf(played)).toEqual(['next']);
    // Le pouce encore tenu repart de zéro, et pas avant les 500 ms du défilement.
    const longer = play(
      new Script()
        .stay(300)
        .move(350, { left: chestLeft, right: chestRight, gesture: { left: 'Thumb_Up' } })
        .stay(500)
        .move(200, { right: sideRight })
        .stay(2_000),
    );
    expect(actionsOf(longer)).toEqual(['next', 'accept']);
    const [scroll, accept] = longer.actions;
    expect(accept.t - scroll.t).toBeGreaterThan(500 + HOLD_MS);
  });

  it('après un geste tenu, 1,5 s sans geste tenu', () => {
    const played = play(
      raiseRight(new Script())
        .stay(1_100, { gesture: { right: 'Thumb_Up' } })
        .stay(200, { gesture: { right: 'None' } })
        .stay(3_000, { gesture: { right: 'Closed_Fist' } }),
    );
    expect(actionsOf(played)).toEqual(['accept', 'refuse']);
    const [accept, refuse] = played.actions;
    expect(refuse.t - accept.t).toBeGreaterThanOrEqual(HOLD_PAUSE_MS + HOLD_MS);
    expect(refuse.t - accept.t).toBeLessThan(HOLD_PAUSE_MS + HOLD_MS + 150);
  });

  it('au plus une action par image', () => {
    const played = play(
      new Script()
        .stay(300)
        .move(350, { left: chestLeft, right: chestRight, gesture: { left: 'Thumb_Up', right: 'Victory' } })
        .stay(1_200)
        .move(200, { left: PLACES.sideLeft, right: sideRight })
        .stay(500),
    );
    expect(played.outputs.every(({ output }) => output.actions.length <= 1)).toBe(true);
  });
});

describe('disarm et gestes tenus', () => {
  it('un geste tenu au moment de disarm ne compte pas, même gardé 2 s ; relâché puis refait, il compte', () => {
    const before = play(raiseRight(new Script()).stay(500, { gesture: { right: 'Thumb_Up' } }));
    expect(before.outputs.at(-1)!.output.hold).toMatchObject({ action: 'accept' });
    const calm = disarm(before.state);
    const start = before.state.lastPoseAt + 33;
    const held = () => new Script({ ...STANDING, right: chestRight, gesture: { right: 'Thumb_Up' } }).stay(2_000);
    expect(actionsOf(play(held(), { state: calm, start }))).toEqual([]);
    const again = held().stay(400, { gesture: { right: 'None' } }).stay(1_300, { gesture: { right: 'Thumb_Up' } });
    expect(actionsOf(play(again, { state: calm, start }))).toEqual(['accept']);
  });

  it('un pouce déjà levé que le Gesture Recognizer n’a pas encore vu ne compte pas non plus', () => {
    // disarm avant la première image (réveil) : le Gesture Recognizer ne tourne qu'une fois la main
    // vue levée, il n'y a donc encore aucun maintien à neutraliser.
    const calm = disarm(createGestureState());
    const held = () =>
      new Script({ ...STANDING, right: chestRight, gesture: { right: 'Thumb_Up' } }).stay(2_000);
    const kept = play(held(), { state: calm });
    expect(actionsOf(kept)).toEqual([]);
    expect(kept.outputs.every(({ output }) => output.hold === null)).toBe(true);
    // Relâché (main ouverte), puis refait : il compte.
    const again = held().stay(400, { gesture: { right: 'Open_Palm' } }).stay(1_300, { gesture: { right: 'Thumb_Up' } });
    expect(actionsOf(play(again, { state: calm }))).toEqual(['accept']);
  });

  it('après disarm, bras le long du corps : le pouce levé ensuite compte, sans rien relâcher', () => {
    const calm = disarm(createGestureState());
    const later = raiseRight(new Script()).stay(1_300, { gesture: { right: 'Thumb_Up' } });
    expect(actionsOf(play(later, { state: calm }))).toEqual(['accept']);
  });

  it('une image où le corps est mal vu ne vaut pas relâchement', () => {
    const calm = disarm(createGestureState());
    const shot = { ...STANDING, right: chestRight, gesture: { right: 'Thumb_Up' } };
    const script = new Script(shot).stay(300).stay(100, { person: 'hipsPoor' }).stay(1_500, { person: 'present' });
    expect(actionsOf(play(script, { state: calm }))).toEqual([]);
  });
});

describe('gestes tenus que l’écran ne peut pas faire (oui et non sans la silhouette de la légende)', () => {
  const both = ['accept', 'refuse'] as const;

  it('pouce tenu pendant que « oui » attend : ni anneau ni oui ; il compte 1 s après, sans le relâcher', () => {
    const script = raiseRight(new Script()).stay(3_000, { gesture: { right: 'Thumb_Up' } });
    // « Oui » attend jusqu'à 2 s (silhouette pas encore dessinée).
    const until = 2_000;
    const played = play(script, { disabledHolds: (local) => (local < until ? both : []) });
    expect(played.outputs.filter(({ t }) => t < until).every(({ output }) => output.hold === null)).toBe(true);
    expect(actionsOf(played)).toEqual(['accept']);
    expect(played.actions[0].t - until).toBeGreaterThanOrEqual(HOLD_MS);
    expect(played.actions[0].t - until).toBeLessThan(HOLD_MS + 150);
  });

  it('un maintien en cours s’arrête si « oui » se met à attendre, et repart de zéro', () => {
    const script = raiseRight(new Script()).stay(3_000, { gesture: { right: 'Thumb_Up' } });
    // Le pouce est vu dès ≈ 550 ms ; à 1 200 ms, une nouvelle silhouette se prépare 400 ms.
    const played = play(script, { disabledHolds: (local) => (local >= 1_200 && local < 1_600 ? both : []) });
    const during = played.outputs.filter(({ t }) => t >= 1_200 && t < 1_600);
    expect(during.every(({ output }) => output.hold === null)).toBe(true);
    expect(actionsOf(played)).toEqual(['accept']);
    expect(played.actions[0].t).toBeGreaterThanOrEqual(1_600 + HOLD_MS);
  });

  it('le V reste libre pendant que « oui » et « non » attendent', () => {
    const script = raiseRight(new Script()).stay(1_400, { gesture: { right: 'Victory' } });
    expect(actionsOf(play(script, { disabledHolds: () => both }))).toEqual(['jacket']);
  });

  it('un « non » validé puis gardé ne revient pas quand « non » attend la nouvelle silhouette', () => {
    // Le « non » change la tenue : sa silhouette se prépare 600 ms, le poing est toujours tenu.
    const script = raiseRight(new Script()).stay(4_000, { gesture: { right: 'Closed_Fist' } });
    const refusedAt = play(script).actions[0].t;
    const played = play(script, { disabledHolds: (local) => (local > refusedAt && local < refusedAt + 600 ? both : []) });
    expect(actionsOf(played)).toEqual(['refuse']);
  });
});

describe('ce qu’a vu le Gesture Recognizer (debug)', () => {
  it('catégorie, score et main', () => {
    const played = play(raiseRight(new Script()).stay(300, { gesture: { right: { category: 'Open_Palm', score: 0.83 } } }));
    const seen = played.outputs.filter(({ output }) => output.recognized).at(-1)!.output.recognized;
    expect(seen).toEqual({ category: 'Open_Palm', score: 0.83, side: 'right' });
  });

  it('une main loin des mains du corps n’est rattachée à aucune', () => {
    let state = createGestureState();
    let last = null;
    for (let t = 0; t <= 300; t += 33) {
      const frame = frameOf(t, { ...STANDING, right: chestRight }, true);
      const step = stepGestures(state, { ...frame, hands: [{ category: 'Thumb_Up', score: 0.9, x: 0.95, y: 0.05 }] });
      state = step.state;
      last = step.output;
    }
    expect(last!.recognized).toEqual({ category: 'Thumb_Up', score: 0.9, side: null });
    expect(last!.hold).toBeNull();
  });
});
