import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AssemblyPhoto } from '@/lib/types';
import { ASSEMBLY_MARGIN, FEATHER, LONG_SPLIT, alignLower, centerAt, planSplit } from './plan';

// Valeurs de référence calculées par scripts/assemblage/ref_fixture.py sur un jeu de photos portées
// (repères seulement, aucune image) : la version TypeScript doit donner exactement les mêmes coupes.
// fixtures/reference.json est généré en local et jamais commité (repères tirés de photos
// personnelles) ; sans lui, les tests qui le lisent sont sautés.

type Case = { top: string; bottom: string; split: number; stretch: [number, number] | null; dx: number; dy: number };
type Reference = {
  margin: number;
  photos: Record<string, AssemblyPhoto>;
  items: Record<string, { photo: string; category: string }>;
  cases: Case[];
};

const FIXTURE = new URL('./fixtures/reference.json', import.meta.url);
const reference = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Reference) : null;
const photos = reference?.photos ?? {};
const items = reference?.items ?? {};
const cases = reference?.cases ?? [];

function photoOf(id: string): AssemblyPhoto {
  return photos[items[id].photo];
}

function base(overrides: Partial<AssemblyPhoto>): AssemblyPhoto {
  return {
    key: 'X',
    size: [1200, 1600],
    eye: [600, 400],
    centers: [
      [400, 630],
      [500, 640],
      [600, 650],
    ],
    topLow: 480,
    bottomHigh: 520,
    onePiece: false,
    tucked: false,
    ...overrides,
  };
}

describe('lib/assembly/plan', () => {
  it.skipIf(!reference)('reprend la marge de la préparation', () => {
    expect(ASSEMBLY_MARGIN).toBe(reference!.margin);
  });

  it.skipIf(!reference)(`donne les mêmes coupes et alignements que la préparation sur ${cases.length} paires de référence`, () => {
    // Le jeu de référence dépend des photos de chacun : au moins une paire, pas un nombre fixe.
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const upper = photoOf(c.top);
      const lower = photoOf(c.bottom);
      const plan = planSplit(upper, lower);
      expect(plan, `${c.top}+${c.bottom}`).toEqual({ split: c.split, stretch: c.stretch });
      const { dx, dy } = alignLower(upper, lower, plan.split);
      expect(dx, `${c.top}+${c.bottom} dx`).toBeCloseTo(c.dx, 1);
      expect(dy, `${c.top}+${c.bottom} dy`).toBeCloseTo(c.dy, 1);
    }
  });

  it('coupe sous le haut le plus bas des deux photos', () => {
    expect(planSplit(base({ topLow: 480 }), base({ topLow: 450 }))).toEqual({ split: 486, stretch: null });
    expect(planSplit(base({ topLow: 480 }), base({ topLow: 500 }))).toEqual({ split: 506, stretch: null });
  });

  it('coupe à la ceinture pour un haut rentré', () => {
    expect(planSplit(base({ tucked: true, topLow: 530, bottomHigh: 510 }), base({ topLow: 450 }))).toEqual({
      split: 516,
      stretch: null,
    });
  });

  it('ne garde que les jambes du bas sous un haut plus long que la zone mesurée', () => {
    expect(planSplit(base({ topLow: null, bottomHigh: null }), base({}))).toEqual({ split: LONG_SPLIT, stretch: null });
  });

  it('haut long porté seul (rien que les jambes sous l’ourlet) : le fondu reste dans le vêtement', () => {
    const tee = base({ topLow: 805, bottomHigh: null });
    expect(planSplit(tee, base({ topLow: 525 }))).toEqual({ split: 805 - 2 * FEATHER, stretch: null });
    // La photo du bas doit montrer son bas partout où elle compte dans le fondu.
    expect(planSplit(base({ topLow: 530, bottomHigh: null }), base({ topLow: 520 }))).toEqual({
      split: 520 + ASSEMBLY_MARGIN + FEATHER,
      stretch: null,
    });
  });

  it('étire le ventre quand le haut du bas descend sous la ceinture de la photo du haut', () => {
    // Ventre de 486 à 517 étiré jusqu'à 536 : rapport 1,6.
    expect(planSplit(base({ topLow: 480, bottomHigh: 520 }), base({ topLow: 530 }))).toEqual({
      split: 536,
      stretch: [486, 517],
    });
  });

  it("coupe à la ceinture du haut si l'étirement serait trop fort", () => {
    // Ventre de 486 à 492 (6 px) étiré jusqu'à 556 : rapport 11.
    expect(planSplit(base({ topLow: 480, bottomHigh: 495 }), base({ topLow: 550 }))).toEqual({
      split: 495,
      stretch: null,
    });
  });

  it('interpole le milieu de la silhouette et le borne aux lignes mesurées', () => {
    const photo = base({});
    expect(centerAt(photo, 450)).toBe(635);
    expect(centerAt(photo, 300)).toBe(630);
    expect(centerAt(photo, 900)).toBe(650);
    expect(centerAt(base({ centers: [] }), 500)).toBe(600);
  });

  it("aligne au plus haut sur la ligne de coupe, et aligne les yeux à la verticale", () => {
    const upper = base({ eye: [600, 400], centers: [[400, 600], [500, 700]] });
    const lower = base({ eye: [580, 390], centers: [[400, 650], [500, 650]] });
    expect(alignLower(upper, lower, 450)).toEqual({ dx: 0, dy: 10 });
    expect(alignLower(upper, lower, 700)).toEqual({ dx: 50, dy: 10 });
  });
});
