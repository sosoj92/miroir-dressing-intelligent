import { describe, expect, it } from 'vitest';
import { GESTURE_COOLDOWN_MS } from './constants';
import { createGestureState, disarm, stepGestures, type GestureState } from './tracker';
import {
  LANDSCAPE,
  PLACES,
  PORTRAIT,
  STANDING,
  Script,
  actionsOf,
  frameOf,
  play,
  raiseBothLate,
  type Shot,
} from './test-poses';
import type { GestureAction, GestureOutput } from './types';

const { restLeft, restRight, chestLeft, chestRight, sideLeft, sideRight, overheadRight, overheadLeft, thighs } = PLACES;

/** Images une à une (30 images/s), pour compter exactement. */
function run(shots: Array<[number, Shot]>, state: GestureState = createGestureState()) {
  const outputs: Array<{ t: number; output: GestureOutput }> = [];
  for (const [t, shot] of shots) {
    const step = stepGestures(state, frameOf(t, shot, false));
    state = step.state;
    outputs.push({ t, output: step.output });
  }
  const actions = outputs.flatMap(({ t, output }) => output.actions.map((action) => ({ t, action })));
  return { state, outputs, actions };
}

/** `count` images à 33 ms d'intervalle à partir de `t0`, toutes dans ce plan. */
function frames(t0: number, count: number, shot: Shot): Array<[number, Shot]> {
  return Array.from({ length: count }, (_, i) => [t0 + i * 33, shot] as [number, Shot]);
}

const swipeRight = (script: Script) =>
  script.move(350, { right: chestRight }).stay(150).move(200, { right: sideRight }).stay(250);
describe('au repos, rien', () => {
  it('debout bras le long du corps pendant 10 s : aucune action', () => {
    const played = play(new Script().stay(10_000));
    expect(actionsOf(played)).toEqual([]);
    const last = played.outputs.at(-1)!.output;
    expect(last.present).toBe(true);
    expect(last.body).toBe(true);
    expect(last.hands.left?.state).toBe('rest');
    expect(last.hands.right?.state).toBe('rest');
  });

  it('bras qui se balancent le long du corps : aucune action', () => {
    const script = new Script();
    for (let i = 0; i < 6; i++) {
      script
        .move(400, { left: { u: -1.6, v: 1.0 }, right: { u: 1.2, v: 1.25 } })
        .move(400, { left: { u: -1.2, v: 1.25 }, right: { u: 1.6, v: 1.0 } });
    }
    expect(actionsOf(play(script))).toEqual([]);
  });

  it('les bras qui retombent sur les côtés depuis la poitrine ne comptent pas', () => {
    const played = play(
      new Script()
        .stay(300)
        .move(400, { left: chestLeft, right: chestRight })
        .stay(300)
        .move(450, { left: restLeft, right: restRight })
        .stay(500),
    );
    expect(actionsOf(played)).toEqual([]);
    // Elles étaient bien armées devant la poitrine.
    expect(played.outputs.some(({ output }) => output.hands.left?.state === 'armed')).toBe(true);
    expect(played.outputs.some(({ output }) => output.hands.right?.state === 'armed')).toBe(true);
  });

  /** Mains devant la poitrine, puis bras qui retombent le long du corps (au repos vers 1 450 ms). */
  const dropArms = () =>
    new Script()
      .stay(300)
      .move(400, { left: chestLeft, right: chestRight })
      .stay(300)
      .move(450, { left: restLeft, right: restRight });

  it('bras retombés depuis la poitrine : les mains reviennent au repos dès qu’elles sont le long du corps', () => {
    const played = play(dropArms().stay(8_000));
    expect(actionsOf(played)).toEqual([]);
    // Sans attendre la limite de temps (dernière image à la poitrine vers 1 150 ms).
    const down = played.outputs.find(({ t }) => t >= 1_450)!.output;
    expect(down.hands.left?.state).toBe('rest');
    expect(down.hands.right?.state).toBe('rest');
    const last = played.outputs.at(-1)!.output;
    expect(last.hands.left?.state).toBe('rest');
    expect(last.hands.right?.state).toBe('rest');
  });

  it.each([300, 8_000])('bras retombés, puis levé sur le côté %i ms plus tard (pour voir une manche) : rien', (wait) => {
    const played = play(dropArms().stay(wait).move(600, { right: sideRight }).stay(500));
    expect(actionsOf(played)).toEqual([]);
  });

  it('bras retombés, puis main montée par le côté au-dessus de la tête (se recoiffer) : rien', () => {
    const played = play(
      dropArms()
        .stay(5_000)
        .move(700, { right: { u: 1.6, v: 0.2 } })
        .move(400, { right: overheadRight })
        .stay(500),
    );
    expect(actionsOf(played)).toEqual([]);
  });

  it('main armée restée plus d’1 s hors de la poitrine sans défiler : sa sortie ne compte plus', () => {
    const halfway = { u: 1.0, v: 0.4 };
    const swipeAfter = (wait: number) =>
      new Script()
        .stay(300)
        .move(350, { right: chestRight })
        .stay(150)
        .move(150, { right: halfway })
        .stay(wait)
        .move(150, { right: sideRight })
        .stay(300);
    expect(actionsOf(play(swipeAfter(1_200)))).toEqual([]);
    // Moins d'une seconde : le défilement part.
    expect(actionsOf(play(swipeAfter(400)))).toEqual(['next']);
  });

  it('plus d’1 s entre deux images : la main armée revient au repos', () => {
    const { actions } = run([
      ...frames(0, 6, { ...STANDING, right: chestRight }),
      ...frames(1_400, 4, { ...STANDING, right: sideRight }),
    ]);
    expect(actions).toEqual([]);
  });

  it('une main levée sur le côté sans être passée devant la poitrine : rien', () => {
    const played = play(new Script().stay(300).move(400, { right: sideRight }).stay(800).move(400, { right: restRight }));
    expect(actionsOf(played)).toEqual([]);
  });

  it('mains le long du corps, juste au-dessus ou au-dessous de la ligne du bas (v 1,15 et 1,25) : rien', () => {
    const high = { left: PLACES.restHighLeft, right: PLACES.restHighRight };
    const played = play(new Script(STANDING).stay(1_000).move(600, high).stay(1_000).move(600, { left: restLeft, right: restRight }));
    expect(actionsOf(played)).toEqual([]);
    // Bras retombés depuis la poitrine sur l'une ou l'autre hauteur.
    for (const rest of [high, { left: restLeft, right: restRight }]) {
      const dropped = play(
        new Script().stay(300).move(400, { left: chestLeft, right: chestRight }).stay(300).move(450, rest).stay(1_000),
      );
      expect(actionsOf(dropped)).toEqual([]);
    }
  });

  it('bras qui retombe en arc, d’abord devant le corps puis sur le côté : bas précédent part (risque à mesurer)', () => {
    // Avec la méthode validée, une main qui descend devant les cuisses EST le geste « bas
    // précédent » : rien ne distingue un bras qui retombe d'abord devant soi. Elle passe sous la
    // ligne du bas (1,2) en arrivant à 1,24, près du milieu des hanches, par un mouvement vertical.
    const played = play(
      new Script()
        .stay(300)
        .move(400, { right: chestRight })
        .stay(300)
        .move(350, { right: { u: 0.45, v: 1.24 } })
        .move(300, { right: restRight })
        .stay(500),
    );
    expect(actionsOf(played)).toEqual(['bottomPrevious']);
    // Le même bras qui s'écarte dès le début de sa chute (sortie sur le côté avant la ligne du bas) : rien.
    const wide = play(
      new Script()
        .stay(300)
        .move(400, { right: chestRight })
        .stay(300)
        .move(300, { right: { u: 1.0, v: 0.95 } })
        .move(300, { right: restRight })
        .stay(500),
    );
    expect(actionsOf(wide)).toEqual([]);
  });
});

describe('sortie sur le côté sous la taille', () => {
  it('main armée à hauteur du nombril, sortie sur le côté en passant sous la taille : haut suivant', () => {
    // La taille est à 0,62 : la main part juste au-dessus et finit dessous, à 0,75 (l'essai le
    // faisait partir ; seul un bras qui retombe revient au repos).
    const played = play(
      new Script().stay(300).move(400, { right: { u: 0.3, v: 0.55 } }).stay(200).move(250, { right: { u: 2.0, v: 0.75 } }).stay(300),
    );
    expect(actionsOf(played)).toEqual(['next']);
    const at = played.actions[0].t;
    expect(played.outputs.find(({ t }) => t === at)!.output.hands.right!.y).toBeGreaterThan(
      PORTRAIT.shoulderY + 0.62 * PORTRAIT.torso,
    );
  });
});

describe('haut suivant, haut précédent', () => {
  it('main droite devant la poitrine puis sortie à sa droite : haut suivant', () => {
    const played = play(swipeRight(new Script().stay(300)).move(400, { right: restRight }).stay(300));
    expect(actionsOf(played)).toEqual(['next']);
  });

  it('main gauche devant la poitrine puis sortie à sa gauche : haut précédent', () => {
    const played = play(
      new Script()
        .stay(300)
        .move(350, { left: chestLeft })
        .stay(150)
        .move(200, { left: sideLeft })
        .stay(250)
        .move(400, { left: restLeft }),
    );
    expect(actionsOf(played)).toEqual(['previous']);
  });

  it('c’est la direction qui compte : la main droite qui sort à sa gauche donne haut précédent', () => {
    const played = play(
      new Script().stay(300).move(350, { right: chestRight }).stay(150).move(250, { right: sideLeft }).stay(250),
    );
    expect(actionsOf(played)).toEqual(['previous']);
  });

  it('directions vues de la personne : à sa droite, l’image brute de la caméra a des x plus petits', () => {
    const played = play(swipeRight(new Script().stay(300)));
    const out = played.outputs.find(({ output }) => (output.hands.right?.u ?? 0) > 1.3)!.output;
    expect(out.hands.right!.x).toBeLessThan(PORTRAIT.centerX);
  });

  it('revenir au buste ne déclenche rien, ça réarme ; une nouvelle sortie redéfile', () => {
    const played = play(
      swipeRight(new Script().stay(300))
        .move(300, { right: chestRight })
        .stay(300)
        .move(200, { right: sideRight })
        .stay(300),
    );
    expect(played.actions.map((a) => a.action)).toEqual(['next', 'next']);
    // Juste après un défilement, la main est au repos ; de retour devant la poitrine, armée.
    const firstAt = played.actions[0].t;
    const after = played.outputs.find(({ t }) => t > firstAt)!.output;
    expect(after.hands.right?.state).toBe('rest');
  });

  it('balayage rapide : une seule image devant la poitrine suffit (ARM_FRAMES = 1)', () => {
    const { actions, outputs } = run([
      ...frames(0, 10, STANDING),
      [330, { ...STANDING, right: chestRight }],
      ...frames(363, 4, { ...STANDING, right: sideRight }),
    ]);
    expect(outputs[10].output.hands.right?.state).toBe('armed');
    expect(actions.map((a) => a.action)).toEqual(['next']);
    // Il faut deux images de suite sur le côté (EXIT_FRAMES = 2).
    expect(actions[0].t).toBe(396);
  });

  it('balayage rapide à travers la poitrine, sans s’y arrêter : haut suivant', () => {
    const played = play(
      new Script()
        .stay(300)
        .move(500, { right: { u: -1.0, v: 0.4 } })
        .stay(300)
        .move(180, { right: sideRight })
        .stay(300),
    );
    expect(actionsOf(played)).toEqual(['next']);
  });
});

describe('bas suivant, bas précédent', () => {
  it('main au-dessus de la tête, depuis la poitrine : bas suivant', () => {
    const played = play(
      new Script().stay(300).move(350, { right: chestRight }).stay(150).move(300, { right: overheadRight }).stay(300),
    );
    expect(actionsOf(played)).toEqual(['bottomNext']);
  });

  it('avec la main gauche aussi', () => {
    const played = play(
      new Script().stay(300).move(350, { left: chestLeft }).stay(150).move(300, { left: overheadLeft }).stay(300),
    );
    expect(actionsOf(played)).toEqual(['bottomNext']);
  });

  it('main vers le bas devant les cuisses, depuis la poitrine : bas précédent', () => {
    const played = play(
      new Script().stay(300).move(350, { right: chestRight }).stay(150).move(300, { right: thighs }).stay(300),
    );
    expect(actionsOf(played)).toEqual(['bottomPrevious']);
  });

  it('main levée tout droit au milieu, depuis la poitrine : bas suivant (l’essai l’y réarmait, rien ne partait)', () => {
    const played = play(
      new Script().stay(300).move(350, { right: chestRight }).stay(150).move(300, { right: PLACES.straightUp }).stay(500),
    );
    expect(actionsOf(played)).toEqual(['bottomNext']);
    // Au-dessus de la ligne du haut, dans la zone de la poitrine de l'essai (|u| < 0,8).
    const at = played.actions[0].t;
    const hand = played.outputs.find(({ t }) => t === at)!.output.hands.right!;
    expect(Math.abs(hand.u)).toBeLessThan(0.8);
    expect(hand.y).toBeLessThan(PORTRAIT.shoulderY - 0.65 * PORTRAIT.torso);
  });

  it('main qui monte et redescend devant la poitrine : un bas suivant à chaque montée', () => {
    const pump = (script: Script) =>
      script.move(300, { right: PLACES.straightUp }).stay(200).move(300, { right: chestRight }).stay(200);
    const played = play(pump(pump(new Script().stay(300).move(350, { right: chestRight }).stay(150))));
    expect(actionsOf(played)).toEqual(['bottomNext', 'bottomNext']);
  });

  it('main qui flotte autour de la ligne du haut : un seul bas suivant, puis il faut repasser devant la poitrine', () => {
    const script = new Script().stay(300).move(350, { right: chestRight }).stay(150).move(300, { right: { u: 0.2, v: -0.7 } });
    for (let i = 0; i < 6; i++) script.move(250, { right: { u: 0.25, v: -0.6 } }).move(250, { right: { u: 0.2, v: -0.7 } });
    expect(actionsOf(play(script))).toEqual(['bottomNext']);
    // Redescendue devant la poitrine, puis remontée : un autre.
    script.move(300, { right: chestRight }).stay(200).move(300, { right: PLACES.straightUp }).stay(300);
    expect(actionsOf(play(script))).toEqual(['bottomNext', 'bottomNext']);
  });

  it('main armée devant le visage seulement (au-dessus des épaules), puis levée : rien', () => {
    // Montée par le côté, ramenée devant le visage sans descendre sous les épaules, puis levée.
    const played = play(
      new Script()
        .stay(300)
        .move(500, { right: { u: 1.6, v: 0.1 } })
        .move(300, { right: { u: 0.3, v: -0.3 } })
        .stay(200)
        .move(300, { right: PLACES.straightUp })
        .stay(400),
    );
    expect(actionsOf(played)).toEqual([]);
  });

  it('devant les cuisses, pas assez bas (v 1,18, au-dessus de la ligne du bas) : rien', () => {
    const played = play(
      new Script().stay(300).move(350, { right: chestRight }).stay(150).move(300, { right: { u: 0.1, v: 1.18 } }).stay(300),
    );
    expect(actionsOf(played)).toEqual([]);
  });
});

describe('se recoiffer (risque de bas suivant, à mesurer derrière le miroir)', () => {
  it('main montée devant le visage jusqu’au haut de la tête, puis redescendue : rien', () => {
    const played = play(
      new Script()
        .stay(300)
        .move(600, { right: PLACES.headTop })
        .move(400, { right: { u: 0.35, v: -0.5 } })
        .move(400, { right: PLACES.headTop })
        .stay(500)
        .move(600, { right: restRight })
        .stay(300),
    );
    expect(actionsOf(played)).toEqual([]);
    // Elle était bien armée devant la poitrine en montant.
    expect(played.outputs.some(({ output }) => output.hands.right?.state === 'armed')).toBe(true);
  });

  it('main montée par le côté au-dessus de la tête, puis redescendue devant le visage : rien', () => {
    const played = play(
      new Script()
        .stay(300)
        .move(500, { right: { u: 1.6, v: 0.2 } })
        .move(400, { right: overheadRight })
        .move(300, { right: PLACES.straightUp })
        .stay(300)
        .move(500, { right: { u: 0.2, v: -0.3 } })
        .move(300, { right: chestRight })
        .move(500, { right: restRight })
        .stay(300),
    );
    expect(actionsOf(played)).toEqual([]);
  });

  it('main passée devant la poitrine, puis au-dessus du haut de la tête (chignon) : bas suivant', () => {
    // Le cas à régler derrière le miroir : au-dessus de la ligne du haut (0,65), c'est le geste.
    const played = play(
      new Script()
        .stay(300)
        .move(600, { right: PLACES.headTop })
        .move(300, { right: { u: 0.2, v: -0.75 } })
        .stay(800)
        .move(600, { right: restRight }),
    );
    expect(actionsOf(played)).toEqual(['bottomNext']);
  });
});

describe('délai entre défilements (500 ms)', () => {
  it('défilements répétés sous 500 ms : le second attend, la main revenue au buste avant est ignorée', () => {
    // Main droite : défile à 396 ms. Main gauche armée, elle sort à sa gauche aussitôt, puis revient.
    const armedBoth = { left: chestLeft, right: chestRight };
    const { actions } = run([
      ...frames(0, 10, { ...STANDING, ...armedBoth }),
      ...frames(363, 2, { ...STANDING, ...armedBoth, right: sideRight }),
      ...frames(429, 4, { ...STANDING, left: sideLeft, right: sideRight }),
      ...frames(561, 6, { ...STANDING, left: chestLeft, right: sideRight }),
    ]);
    expect(actions.map((a) => a.action)).toEqual(['next']);
  });

  it('une main restée sur le côté défile dès que les 500 ms sont passées (strictement)', () => {
    const settings = { zoneSmoothing: 1 };
    const armed = run(frames(0, 3, { ...STANDING, left: chestLeft, right: chestRight }), createGestureState(settings));
    const first = run(
      [
        [100, { ...STANDING, left: chestLeft, right: sideRight }],
        [133, { ...STANDING, left: chestLeft, right: sideRight }],
      ],
      armed.state,
    );
    expect(first.actions).toEqual([{ t: 133, action: 'next' }]);
    const second = run(
      [
        [400, { ...STANDING, left: sideLeft, right: sideRight }],
        [500, { ...STANDING, left: sideLeft, right: sideRight }],
        [133 + GESTURE_COOLDOWN_MS, { ...STANDING, left: sideLeft, right: sideRight }],
        [133 + GESTURE_COOLDOWN_MS + 1, { ...STANDING, left: sideLeft, right: sideRight }],
      ],
      first.state,
    );
    expect(second.actions).toEqual([{ t: 634, action: 'previous' }]);
  });

  it('deux mains qui sortent à la même image : une seule action, même bras gardés ouverts 1 s (main gauche d’abord, comme l’essai)', () => {
    const settings = { zoneSmoothing: 1 };
    const { actions } = run(
      [
        ...frames(0, 3, { ...STANDING, left: chestLeft, right: chestRight }),
        ...frames(100, 31, { ...STANDING, left: sideLeft, right: sideRight }),
      ],
      createGestureState(settings),
    );
    expect(actions.map((a) => a.action)).toEqual(['previous']);
  });

  it.each([
    ['tout droit', { u: -0.3, v: -0.95 }, PLACES.straightUp],
    ['un peu écartées', overheadLeft, overheadRight],
  ] as const)(
    'deux mains levées %s au-dessus de la tête, la droite 100 ms après la gauche : un seul bas suivant',
    (_name, upLeft, upRight) => {
      const played = play(raiseBothLate(100, upLeft, upRight).stay(1_500));
      expect(actionsOf(played)).toEqual(['bottomNext']);
    },
  );

  it('deux bras ouverts en grand depuis la poitrine (« ta-da ») : un seul défilement', () => {
    const played = play(
      new Script()
        .stay(300)
        .move(350, { left: chestLeft, right: chestRight })
        .stay(200)
        .move(200, { left: sideLeft, right: sideRight })
        .stay(1_000),
    );
    expect(actionsOf(played)).toHaveLength(1);
  });
});

describe('présence et corps bien vu', () => {
  it('une personne qui arrive est présente ; qui s’en va, ne l’est plus', () => {
    const played = play(
      new Script({ ...STANDING, person: 'absent' }).stay(1_000).stay(1_000, { person: 'present' }).stay(1_000, { person: 'absent' }),
    );
    const at = (t: number) => played.outputs.filter((o) => o.t <= t).at(-1)!.output;
    expect(at(900).present).toBe(false);
    expect(at(1_900).present).toBe(true);
    expect(at(2_900).present).toBe(false);
    expect(actionsOf(played)).toEqual([]);
  });

  it('personne qui s’en va main armée : à son retour, la main sur le côté ne déclenche rien', () => {
    const played = play(
      new Script()
        .stay(300)
        .move(350, { right: chestRight })
        .stay(200)
        .stay(800, { person: 'absent' })
        .stay(600, { person: 'present', right: sideRight }),
    );
    expect(actionsOf(played)).toEqual([]);
  });

  it('trois images sans personne pendant une sortie sur le côté : le défilement part quand même (l’essai les ignorait)', () => {
    const { actions, outputs } = run([
      ...frames(0, 8, { ...STANDING, right: chestRight }),
      [264, { ...STANDING, right: { u: 1.2, v: 0.4 } }],
      ...frames(297, 3, { ...STANDING, person: 'absent' }),
      ...frames(396, 6, { ...STANDING, right: sideRight }),
    ]);
    expect(outputs[9].output.present).toBe(false);
    expect(actions.map((a) => a.action)).toEqual(['next']);
  });

  it('plus de 300 ms sans personne : les mains armées reviennent au repos', () => {
    const { actions } = run([
      ...frames(0, 8, { ...STANDING, right: chestRight }),
      ...frames(264, 11, { ...STANDING, person: 'absent' }),
      ...frames(627, 6, { ...STANDING, right: sideRight }),
    ]);
    expect(actions).toEqual([]);
  });

  it('épaules mal vues : ni présence ni geste', () => {
    const played = play(swipeRight(new Script({ ...STANDING, person: 'shouldersPoor' }).stay(300)));
    expect(actionsOf(played)).toEqual([]);
    expect(played.outputs.every(({ output }) => !output.present && !output.body)).toBe(true);
  });

  it('hanches mal vues : présente, mais aucun geste (et pas de zones)', () => {
    const played = play(swipeRight(new Script({ ...STANDING, person: 'hipsPoor' }).stay(300)));
    expect(actionsOf(played)).toEqual([]);
    const last = played.outputs.at(-1)!.output;
    expect(last.present).toBe(true);
    expect(last.body).toBe(false);
    expect(last.zones).toBeNull();
    expect(last.hands).toEqual({ left: null, right: null });
  });

  describe('de profil (essai sur vidéo)', () => {
    /** La personne se tourne : épaules confondues dans l'image (demi-largeur 0,06 longueur de buste au lieu de 0,4). */
    const TURNED = { ...PORTRAIT, half: 0.012 };
    /** La même main, à `offset` (hauteurs d'image) du milieu du buste, en unités du corps tourné. */
    const near = (offset: number, v: number) => ({ u: offset / TURNED.half, v });

    /** Main armée devant la poitrine, puis la personne se tourne ; la main bouge à peine. */
    const turnAround = () =>
      new Script()
        .stay(300)
        .move(350, { right: chestRight })
        .stay(150)
        .stay(34, { body: TURNED, right: near(0.02, 0.35) })
        .move(200, { right: near(0.05, 0.4) })
        .stay(400);

    it('main armée, puis la personne se tourne : la main près du corps a un |u| énorme, mais rien ne part', () => {
      const played = play(turnAround());
      expect(actionsOf(played)).toEqual([]);
      const turned = played.outputs.at(-1)!.output;
      expect(turned).toMatchObject({ present: true, body: false, turned: true, zones: null });
      expect(turned.hands).toEqual({ left: null, right: null });
      // Sans la garde, la même scène défilait (le faux défilement de l'essai) : à 5 cm du milieu du
      // buste, la main est à |u| 4.
      const unguarded = play(turnAround(), { state: createGestureState({ minShoulderRatio: 0 }) });
      expect(actionsOf(unguarded)).toEqual(['next']);
    });

    it('de nouveau de face, la main sur le côté : rien ; elle doit repasser devant la poitrine', () => {
      const back = new Script()
        .stay(300)
        .move(350, { right: chestRight })
        .stay(150)
        .stay(300, { body: TURNED, right: near(0.05, 0.4) })
        .stay(300, { body: PORTRAIT, right: sideRight });
      const played = play(back);
      expect(actionsOf(played)).toEqual([]);
      expect(played.outputs.at(-1)!.output.hands.right?.state).toBe('rest');
      expect(actionsOf(play(swipeRight(back)))).toEqual(['next']);
    });

    it('de face, épaules étroites dans l’image (0,24 longueur de buste, le plus bas vu de face) : le défilement part', () => {
      const narrow = { ...PORTRAIT, half: 0.048 };
      const played = play(swipeRight(new Script({ ...STANDING, body: narrow }).stay(300)));
      expect(actionsOf(played)).toEqual(['next']);
      expect(played.outputs.every(({ output }) => !output.turned)).toBe(true);
    });
  });

  it('une main armée qui devient mal vue revient au repos', () => {
    const { outputs, actions } = run([
      ...frames(0, 6, { ...STANDING, right: chestRight }),
      ...frames(200, 2, { ...STANDING, right: null }),
      ...frames(266, 4, { ...STANDING, right: sideRight }),
    ]);
    expect(outputs[5].output.hands.right?.state).toBe('armed');
    expect(actions).toEqual([]);
  });
});

describe('format de l’image', () => {
  const scenes: Array<[string, (body: typeof PORTRAIT) => Script, GestureAction[]]> = [
    ['côté droit', (body) => swipeRight(new Script({ ...STANDING, body }).stay(300)), ['next']],
    [
      'au-dessus de la tête',
      (body) => new Script({ ...STANDING, body }).stay(300).move(350, { right: chestRight }).stay(150).move(300, { right: overheadRight }).stay(300),
      ['bottomNext'],
    ],
    [
      'devant les cuisses',
      (body) => new Script({ ...STANDING, body }).stay(300).move(350, { right: chestRight }).stay(150).move(300, { right: thighs }).stay(300),
      ['bottomPrevious'],
    ],
    [
      'bras qui retombent',
      (body) =>
        new Script({ ...STANDING, body }).stay(300).move(400, { left: chestLeft, right: chestRight }).stay(300).move(450, { left: restLeft, right: restRight }),
      [],
    ],
  ];

  it.each(scenes)('%s : même résultat en portrait et en paysage', (_name, scene, expected) => {
    expect(actionsOf(play(scene(PORTRAIT)))).toEqual(expected);
    expect(actionsOf(play(scene(LANDSCAPE)))).toEqual(expected);
  });

  it('u ne dépend pas du format', () => {
    const portrait = run(frames(0, 5, { ...STANDING, right: sideRight })).outputs.at(-1)!.output;
    const landscape = run(frames(0, 5, { ...STANDING, right: sideRight, body: LANDSCAPE })).outputs.at(-1)!.output;
    expect(portrait.hands.right!.u).toBeCloseTo(sideRight.u, 6);
    expect(landscape.hands.right!.u).toBeCloseTo(sideRight.u, 6);
  });
});

describe('debug', () => {
  it('zones en coordonnées normalisées de l’image, mains avec leur état', () => {
    const { outputs } = run(frames(0, 8, { ...STANDING, right: chestRight }));
    const { zones, hands } = outputs.at(-1)!.output;
    expect(zones).not.toBeNull();
    const z = zones!;
    const halfX = PORTRAIT.half / PORTRAIT.aspect;
    expect(z.chest.x0).toBeCloseTo(PORTRAIT.centerX - 0.8 * halfX, 6);
    expect(z.chest.x1).toBeCloseTo(PORTRAIT.centerX + 0.8 * halfX, 6);
    expect(z.sides.x0).toBeCloseTo(PORTRAIT.centerX - 1.3 * halfX, 6);
    expect(z.chest.y0).toBeCloseTo(PORTRAIT.shoulderY - 1.2 * PORTRAIT.torso, 6);
    expect(z.chest.y1).toBeCloseTo(PORTRAIT.shoulderY + 0.62 * PORTRAIT.torso, 6);
    expect(z.waistY).toBe(z.chest.y1);
    expect(z.upY).toBeCloseTo(PORTRAIT.shoulderY - 0.65 * PORTRAIT.torso, 6);
    expect(z.downY).toBeCloseTo(PORTRAIT.shoulderY + 1.2 * PORTRAIT.torso, 6);
    expect(z.thighs.x1 - z.thighs.x0).toBeCloseTo((2 * 1.6 * PORTRAIT.hipsHalf) / PORTRAIT.aspect, 6);
    expect(hands.right).toMatchObject({ state: 'armed', raised: true });
    expect(hands.right!.u).toBeCloseTo(chestRight.u, 3);
    expect(hands.left).toMatchObject({ state: 'rest', raised: false, armMinU: null });
  });

  it('le |u| le plus petit de chaque armement : armée de justesse ou bien au centre', () => {
    const exact = createGestureState({ zoneSmoothing: 1 });
    const { outputs } = run(
      [
        ...frames(0, 2, { ...STANDING, right: { u: 0.75, v: 0.35 } }),
        ...frames(66, 2, { ...STANDING, right: { u: 0.3, v: 0.35 } }),
        ...frames(132, 2, { ...STANDING, right: { u: 0.6, v: 0.35 } }),
        ...frames(198, 3, { ...STANDING, right: sideRight }),
        // Deuxième armement, de justesse.
        ...frames(900, 2, { ...STANDING, right: { u: 0.78, v: 0.35 } }),
      ],
      exact,
    );
    const right = (i: number) => outputs[i].output.hands.right!;
    expect(right(1).armMinU).toBeCloseTo(0.75, 6);
    expect(right(3).armMinU).toBeCloseTo(0.3, 6);
    expect(right(5).armMinU).toBeCloseTo(0.3, 6);
    // Gardé après le défilement, pour le lire.
    expect(right(7)).toMatchObject({ state: 'rest' });
    expect(right(7).armMinU).toBeCloseTo(0.3, 6);
    expect(right(9)).toMatchObject({ state: 'armed' });
    expect(right(9).armMinU).toBeCloseTo(0.78, 6);
  });
});

describe('disarm', () => {
  it('oublie une main armée : sa sortie ne déclenche plus rien', () => {
    const armed = run(frames(0, 6, { ...STANDING, right: chestRight }));
    expect(armed.outputs.at(-1)!.output.hands.right?.state).toBe('armed');
    const calm = disarm(armed.state);
    expect(calm.hands.right.state).toBe('locked');
    const after = run(frames(200, 6, { ...STANDING, right: sideRight }), calm);
    expect(after.actions).toEqual([]);
  });

  it('une main restée devant la poitrine ne se réarme pas : il faut la sortir, puis revenir', () => {
    const armed = run(frames(0, 6, { ...STANDING, right: chestRight }));
    const calm = disarm(armed.state);
    // Toujours devant la poitrine : bloquée, puis la sortie sur le côté ne fait rien.
    const stay = run(frames(200, 10, { ...STANDING, right: chestRight }), calm);
    expect(stay.outputs.every(({ output }) => output.hands.right?.state === 'locked')).toBe(true);
    const out = play(new Script({ ...STANDING, right: chestRight }).move(200, { right: sideRight }).stay(300), {
      state: stay.state,
      start: 600,
    });
    expect(actionsOf(out)).toEqual([]);
    expect(out.outputs.at(-1)!.output.hands.right?.state).toBe('rest');
    // Revenue devant la poitrine, puis sortie : haut suivant, comme d'habitude.
    const again = play(swipeRight(new Script({ ...STANDING, right: sideRight })), { state: out.state, start: 1_200 });
    expect(actionsOf(again)).toEqual(['next']);
  });

  it('une main ailleurs que devant la poitrine se débloque à l’image suivante', () => {
    const calm = disarm(createGestureState());
    expect(calm.hands.left.state).toBe('locked');
    const next = run(frames(0, 1, STANDING), calm);
    expect(next.outputs[0].output.hands.left?.state).toBe('rest');
    expect(next.outputs[0].output.hands.right?.state).toBe('rest');
    expect(actionsOf(play(swipeRight(new Script().stay(300)), { state: next.state, start: 33 }))).toEqual(['next']);
  });
});
