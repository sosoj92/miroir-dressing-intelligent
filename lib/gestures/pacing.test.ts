import { describe, expect, it } from 'vitest';
import { cameraPacing } from './pacing';
import { createGestureState, stepGestures } from './tracker';
import { PLACES, STANDING, Script, frameOf, play } from './test-poses';

const { chestRight } = PLACES;

/** Images par seconde mesurées entre deux instants. */
function rate(times: number[], from: number, to: number): number {
  return times.filter((t) => t >= from && t < to).length / ((to - from) / 1000);
}

describe('rythme de PoseLandmarker', () => {
  it('5 images/s quand personne', () => {
    const played = play(new Script({ ...STANDING, person: 'absent' }).stay(4_000));
    expect(rate(played.poseAt, 0, 4_000)).toBeCloseTo(5, 0);
    expect(cameraPacing(played.state, 4_000).poseIntervalMs).toBe(200);
  });

  it('30 images/s dès que quelqu’un est là, sur une horloge d’écran à 60 Hz', () => {
    const played = play(new Script().stay(4_000));
    expect(rate(played.poseAt, 1_000, 4_000)).toBeGreaterThan(29);
    expect(rate(played.poseAt, 1_000, 4_000)).toBeLessThanOrEqual(30.5);
    expect(cameraPacing(played.state, 4_000).poseIntervalMs).toBeCloseTo(1000 / 30, 6);
  });

  it('une personne qui arrive est vue en 200 ms au plus, puis tout passe à 30 images/s', () => {
    const played = play(new Script({ ...STANDING, person: 'absent' }).stay(1_100).stay(2_000, { person: 'present' }));
    const firstSeen = played.outputs.find(({ output }) => output.present)!.t;
    expect(firstSeen - 1_100).toBeLessThanOrEqual(200);
    expect(rate(played.poseAt, firstSeen + 100, 3_000)).toBeGreaterThan(29);
  });

  it('après son départ, encore 1 s à 30 images/s, puis 5', () => {
    const played = play(new Script().stay(1_000).stay(3_000, { person: 'absent' }));
    expect(rate(played.poseAt, 1_100, 1_900)).toBeGreaterThan(28);
    expect(rate(played.poseAt, 2_200, 4_000)).toBeLessThanOrEqual(6);
  });
});

describe('rythme du Gesture Recognizer', () => {
  it('jamais quand les mains sont au repos', () => {
    const played = play(new Script().stay(3_000));
    expect(played.recognizerAt).toEqual([]);
  });

  it('seulement quand une main est levée au-dessus de la taille, à 10 images/s au plus', () => {
    const played = play(new Script().stay(1_000).move(350, { right: chestRight }).stay(2_000).move(350, { right: PLACES.restRight }).stay(1_000));
    expect(played.recognizerAt.length).toBeGreaterThan(0);
    const gaps = played.recognizerAt.slice(1).map((t, i) => t - played.recognizerAt[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(96);
    expect(rate(played.recognizerAt, 1_500, 3_300)).toBeGreaterThan(9);
    expect(rate(played.recognizerAt, 1_500, 3_300)).toBeLessThanOrEqual(10.6);
    // Main redescendue : il s'arrête.
    expect(played.recognizerAt.every((t) => t < 3_800)).toBe(true);
    // Toujours sur une image où PoseLandmarker tourne.
    expect(played.recognizerAt.every((t) => played.poseAt.includes(t))).toBe(true);
  });

  it('pas quand le corps est mal vu, même main levée', () => {
    const played = play(new Script({ ...STANDING, person: 'hipsPoor' }).stay(300).move(350, { right: chestRight }).stay(2_000));
    expect(played.recognizerAt).toEqual([]);
  });

  it('pas avant la première image : il faut une pose pour savoir qu’une main est levée', () => {
    expect(cameraPacing(createGestureState(), 0)).toEqual({ runPose: true, runRecognizer: false, poseIntervalMs: 200 });
  });

  it('la tolérance évite de tomber à 24 images/s quand l’écran est un peu en avance', () => {
    const { state } = stepGestures(createGestureState(), frameOf(0, STANDING, false));
    expect(cameraPacing(state, 31).runPose).toBe(true);
    expect(cameraPacing(state, 20).runPose).toBe(false);
  });
});
