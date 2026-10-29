import { describe, expect, it } from 'vitest';
import * as C from './constants';
import { DEFAULT_GESTURE_SETTINGS } from './settings';
import { createGestureState } from './tracker';

describe('constantes', () => {
  it('méthode des zones : les valeurs de l’essai de calibration, à l’identique', () => {
    // Réglages de l'essai de calibration.
    expect({
      CENTER_IN: C.CENTER_IN,
      SIDE_OUT: C.SIDE_OUT,
      ARM_FRAMES: C.ARM_FRAMES,
      EXIT_FRAMES: C.EXIT_FRAMES,
      GESTURE_COOLDOWN_MS: C.GESTURE_COOLDOWN_MS,
      BODY_VISIBILITY: C.BODY_VISIBILITY,
      WAIST: C.WAIST,
      BAND_TOP: C.BAND_TOP,
      HORIZONTAL: C.HORIZONTAL,
      UP_LINE: C.UP_LINE,
      DOWN_LINE: C.DOWN_LINE,
      THIGH_FRONT: C.THIGH_FRONT,
      MIN_VISIBILITY: C.MIN_VISIBILITY,
      ZONE_SMOOTHING: C.ZONE_SMOOTHING,
    }).toEqual({
      CENTER_IN: 0.8,
      SIDE_OUT: 1.3,
      ARM_FRAMES: 1,
      EXIT_FRAMES: 2,
      GESTURE_COOLDOWN_MS: 500,
      BODY_VISIBILITY: 0.6,
      WAIST: 0.62,
      BAND_TOP: 1.2,
      HORIZONTAL: 1.2,
      UP_LINE: 0.65,
      DOWN_LINE: 0.2,
      THIGH_FRONT: 1.6,
      MIN_VISIBILITY: 0.5,
      ZONE_SMOOTHING: 0.75,
    });
  });

  it('repères de PoseLandmarker', () => {
    expect(C.POSE_LANDMARKS).toEqual({
      leftShoulder: 11,
      rightShoulder: 12,
      leftElbow: 13,
      rightElbow: 14,
      leftWrist: 15,
      rightWrist: 16,
      leftIndex: 19,
      rightIndex: 20,
      leftHip: 23,
      rightHip: 24,
      leftKnee: 25,
      rightKnee: 26,
    });
  });

  it('gestes tenus : 1 s, 1,5 s de pause, lus par categoryName ; pas de geste pour Recommencer', () => {
    expect(C.HOLD_MS).toBe(1_000);
    expect(C.HOLD_PAUSE_MS).toBe(1_500);
    expect(C.HOLD_GESTURES).toEqual({ Thumb_Up: 'accept', Closed_Fist: 'refuse', Victory: 'jacket' });
  });

  it('ajoutés après l’essai : main armée 1 s au plus hors de la poitrine, trou de 300 ms au plus sans personne', () => {
    expect(C.ARM_TIMEOUT_MS).toBe(1_000);
    expect(C.POSE_GAP_MS).toBe(300);
    // Le départ d'une personne (800 ms dans les tests) dépasse le trou toléré.
    expect(C.POSE_GAP_MS).toBeLessThan(800);
  });

  it('ajouté après l’essai sur vidéo : de profil, demi-largeur d’épaules sous 0,2 longueur de buste', () => {
    // De face : 0,30 à 0,35 (1 % des images sous 0,23) ; les faux défilements de profil : 0,16 et 0,18.
    expect(C.MIN_SHOULDER_RATIO).toBe(0.2);
  });

  it('économie : 5 images/s sans personne, 30 avec, Gesture Recognizer à 10 au plus', () => {
    expect(C.POSE_FPS_IDLE).toBe(5);
    expect(C.POSE_FPS_PRESENT).toBe(30);
    expect(C.RECOGNIZER_FPS_MAX).toBe(10);
  });

  it('les réglages par défaut sont les constantes ; on peut en changer certains à la création', () => {
    expect(createGestureState().settings).toEqual(DEFAULT_GESTURE_SETTINGS);
    const state = createGestureState({ sideOut: 1.5 });
    expect(state.settings.sideOut).toBe(1.5);
    expect(state.settings.centerIn).toBe(C.CENTER_IN);
    expect(Object.isFrozen(DEFAULT_GESTURE_SETTINGS)).toBe(true);
  });
});
