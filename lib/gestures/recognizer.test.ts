import { describe, expect, it } from 'vitest';
import { recognizedHands } from './recognizer';

describe('recognizedHands', () => {
  it('une main par entrée : catégorie la plus probable par son nom, score, centre des repères', () => {
    const hands = recognizedHands({
      gestures: [
        [
          { categoryName: 'Thumb_Up', score: 0.91 },
          { categoryName: 'None', score: 0.05 },
        ],
        [{ categoryName: 'Closed_Fist', score: 0.7 }],
      ],
      landmarks: [
        [
          { x: 0.4, y: 0.3 },
          { x: 0.6, y: 0.5 },
        ],
        [{ x: 0.2, y: 0.8 }],
      ],
      handedness: [[{ categoryName: 'Left' }], [{ categoryName: 'Right' }]],
    });
    expect(hands).toHaveLength(2);
    expect(hands[0]).toMatchObject({ category: 'Thumb_Up', score: 0.91, handedness: 'Left' });
    expect(hands[0].x).toBeCloseTo(0.5, 9);
    expect(hands[0].y).toBeCloseTo(0.4, 9);
    expect(hands[1]).toEqual({ category: 'Closed_Fist', score: 0.7, x: 0.2, y: 0.8, handedness: 'Right' });
  });

  it('sans catégorie : « None », score 0 ; sans repères : ignorée', () => {
    const hands = recognizedHands({
      gestures: [[], [{ categoryName: 'Victory', score: 0.8 }]],
      landmarks: [[{ x: 0.5, y: 0.5 }], []],
    });
    expect(hands).toEqual([{ category: 'None', score: 0, x: 0.5, y: 0.5 }]);
  });

  it('aucune main vue : liste vide (le Gesture Recognizer a tourné)', () => {
    expect(recognizedHands({ gestures: [], landmarks: [], handedness: [] })).toEqual([]);
  });
});
