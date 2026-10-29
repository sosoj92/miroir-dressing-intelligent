import type { RecognizedHand } from './types';

// Résultat du Gesture Recognizer → mains de stepGestures. Fonction pure : la forme du résultat est
// reprise ici, sans importer MediaPipe (un GestureRecognizerResult convient tel quel).

export type RecognizerResultLike = {
  /** Par main, les catégories de la plus probable à la moins probable. */
  gestures: ReadonlyArray<ReadonlyArray<{ categoryName: string; score: number }>>;
  /** Par main, ses 21 repères normalisés. */
  landmarks: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
  handedness?: ReadonlyArray<ReadonlyArray<{ categoryName: string }>>;
};

/** Une main par entrée : sa catégorie la plus probable (lue par son nom), son score et son centre. */
export function recognizedHands(result: RecognizerResultLike): RecognizedHand[] {
  const out: RecognizedHand[] = [];
  result.landmarks.forEach((points, i) => {
    if (points.length === 0) return;
    const top = result.gestures[i]?.[0];
    const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    const handedness = result.handedness?.[i]?.[0]?.categoryName;
    out.push({
      category: top?.categoryName || 'None',
      score: top?.score ?? 0,
      x,
      y,
      ...(handedness ? { handedness } : {}),
    });
  });
  return out;
}
