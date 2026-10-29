import type { AssemblyArms, AssemblyPhoto } from '@/lib/types';
// Imports relatifs (pas d'alias « @/ ») pour tout ce qui sert à l'exécution, comme render.ts.
import { FEATHER, alignLower, planSplit } from './plan';
import {
  STAGE_HEIGHT,
  STAGE_WIDTH,
  planRender,
  roundHalfEven,
  stageOffset,
  type DrawStep,
  type RenderPlan,
  type SilhouetteSource,
} from './render';

// Plan de dessin d'une silhouette avec les « bras pliés » (docs/conception.md §7), calculé sans canvas.
// C'est la traduction de scripts/assemblage/bras_plan.py draw_plan, qui reste la RÉFÉRENCE :
// mêmes opérations dans le même ordre, mêmes arrondis (à 1e-6, vérifié contre
// fixtures/arms-reference.json, générée en local par scripts/assemblage/ref_fixture.py, hors dépôt).
//
// Deux modes :
//   'actuel'  rendu sans bras pliés, version 1 (render.ts planRender, dessiné par drawSilhouette tel quel) :
//             une des deux photos sans données de bras, robe seule, haut plus long que la zone
//             mesurée (coupe 866), haut long (coupe ≥ LONG_ARMS, ou poignet du bas au-dessus de la
//             jonction), aucun bras à plier, ou une précondition du dessin non tenue ;
//   'plies'   sous la coupe, les bras de la photo du bas, décalés ligne par ligne pour rejoindre
//             ceux du haut à la jonction (bandes d'une ligne), sur le corps sans bras du bas.
// Le repli « bras du haut » des hauts longs (mode 'haut' de bras_plan.py) a été écarté : il n'est
// pas traduit ici.
//
// Repère : la scène de render.ts (STAGE_WIDTH × STAGE_HEIGHT), la photo du haut A translatée de
// `offset`, la photo du bas B de (offset + dx, offset + dy). Lignes et colonnes des bandes : celles
// de la photo du haut. Portabilité : int() d'un positif = Math.floor, round() de Python =
// roundHalfEven, moyenne = somme de gauche à droite puis division, médiane = tri puis milieu.

/** Réglages des bras pliés (= bras_plan.py, `constants` de fixtures/arms-reference.json). */
export const ARMS_CONSTANTS = {
  /** Marge horizontale des bandes (px). */
  MX: 8,
  /** Longueur du pli (jonction → poignet), bornée. */
  L_MIN: 120,
  L_MAX: 250,
  /** Coupe à partir de laquelle un haut est « long » (mains à la coupe) : rendu actuel. */
  LONG_ARMS: 680,
  /** Lignes de manche sondées sous la coupe (toutes les 5 px), par les deux côtés… */
  SLEEVE_PROBE: 10,
  /** … au moins 12 sur 20 : haut à manches longues. */
  SLEEVE_MIN: 12,
  /** Main figée à partir de 40 px au-dessus du bas de manche. */
  CUFF_HAND: 40,
  /** Demi-fenêtres du lissage du décalage et de l'échelle (manches longues). */
  SMOOTH_D: 15,
  SMOOTH_S: 5,
} as const;

const { MX, L_MIN, L_MAX, LONG_ARMS, SLEEVE_PROBE, SLEEVE_MIN, CUFF_HAND, SMOOTH_D, SMOOTH_S } = ARMS_CONSTANTS;

/** Toiles de la taille de la scène : la silhouette, une toile de calque, la couche des bras. */
export type CanvasName = 'main' | 'tmp' | 'arms';
export const PLAN_CANVASES: readonly CanvasName[] = ['main', 'tmp', 'arms'];

/** Images d'une tenue, par rôle : A = photo du haut, B = photo du bas. */
export type ImageRole =
  | 'A.cutout'
  | 'B.cutout'
  | 'A.itemSleeves'
  | 'A.arms'
  | 'A.body'
  | 'A.sleeves'
  | 'B.arms'
  | 'B.body'
  | 'B.sleeves';
export type ImageLayer = 'cutout' | 'itemSleeves' | 'arms' | 'body' | 'sleeves';
/** Une image du plan : sa photo, sa couche, son URL et sa boîte [x, y, w, h] dans la photo. */
export type PlanImage = { photo: string; layer: ImageLayer; url: string; box: [number, number, number, number] };

export type Side = 'L' | 'R';
export type Quad = [number, number, number, number];

/**
 * Opérations canvas 2D, en px de la scène :
 * - clear : clearRect de toute la toile ;
 * - draw : drawImage(src, ...s, ...d), src étant une image (rôle) ou une autre toile ;
 * - fade : dégradé vertical d'alpha (points en centres de pixels), en destination-in ;
 * - composite : drawImage(toile, 0, 0), en source-over ou lighter.
 */
export type PlanOp =
  | { op: 'clear'; dst: CanvasName }
  | { op: 'draw'; dst: CanvasName; src: ImageRole | CanvasName; s: Quad; d: Quad; kind?: 'strip' | 'rest'; side?: Side }
  | { op: 'fade'; dst: CanvasName; stops: Array<[number, number]> }
  | { op: 'composite'; dst: CanvasName; src: CanvasName; mode: 'source-over' | 'lighter' };

/** Bande d'une ligne : [ligne, bords source lo, hi, bords de destination lo, hi] (photo du haut). */
export type Strip = [number, number, number, number, number];
/** Un côté : ses bandes, le décalage figé sous la dernière bande, et la fin du pli (ou null). */
export type ArmSidePlan = { strips: Strip[]; rigid: number; yEnd: number | null };

export type ArmsGeometry = {
  /** Coupe (px sous les yeux du haut) et bande de ventre étirée. */
  s: number;
  band: [number, number] | null;
  /** Décalage de la photo du bas (alignLower), non arrondi. */
  dx: number;
  dy: number;
  /** Translation entière de la photo du haut sur la scène. */
  offset: [number, number];
  /** Ligne de coupe dans la photo du haut. */
  ys: number;
  /** Jonction des bras (la coupe, ou le début de la bande de ventre). */
  yj?: number;
  /** Haut à manches longues sous la coupe. */
  sleeved?: boolean;
  sides?: Record<Side, ArmSidePlan>;
  longTop?: boolean;
  /** Fin du pli le plus long (bras nus) ; null avec des manches longues. */
  ye?: number | null;
};

/** Préconditions du rendu « bras pliés » : une seule fausse, et c'est le rendu actuel. */
export type PlanCheck = 'stripSides' | 'kPositive' | 'fade4' | 'stretchBox';

export type SilhouettePlan = {
  mode: 'actuel' | 'plies';
  /** Pourquoi le rendu actuel (null en bras pliés). */
  reason: string | null;
  /** null pour une robe seule. */
  geometry: ArmsGeometry | null;
  checks: Partial<Record<PlanCheck, boolean>>;
  width: number;
  height: number;
  canvases: readonly CanvasName[];
  /** Images que les opérations dessinent, et seulement celles-là. */
  images: Partial<Record<ImageRole, PlanImage>>;
  ops: PlanOp[];
  /** Mode 'actuel' : le plan de render.ts, que drawSilhouette dessine tel quel ; null sinon. */
  current: RenderPlan | null;
};

type SpanKey = 'L' | 'R' | 'sleeveL' | 'sleeveR';
type Span = [number, number];
type ImageMap = Partial<Record<ImageRole, PlanImage>>;

// ---------------------------------------------------------------- lecture des données de bras

/** Bords [lo, hi] interpolés entre deux échantillons, `rel` px sous les yeux ; null sans bras. */
export function spanAt(d: AssemblyArms, key: SpanKey, rel: number): Span | null {
  const i = (rel - d.from) / d.step;
  const i0 = Math.floor(i);
  const t = i - i0;
  const rows = d[key];
  if (i0 < 0 || i0 + 1 >= rows.length) return null;
  const a0 = rows[i0];
  const a1 = rows[i0 + 1];
  if (a0 === null && a1 === null) return null;
  if (a0 === null) return a1;
  if (a1 === null) return a0;
  return [a0[0] * (1 - t) + a1[0] * t, a0[1] * (1 - t) + a1[1] * t];
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const half = Math.floor(n / 2);
  return n % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

function spanMedian(d: AssemblyArms, key: SpanKey, rel: number, k = 2): Span | null {
  const values: Span[] = [];
  for (let j = -k; j <= k; j += 1) {
    const span = spanAt(d, key, rel + j * d.step);
    if (span !== null) values.push(span);
  }
  if (values.length === 0) return null;
  return [median(values.map((v) => v[0])), median(values.map((v) => v[1]))];
}

function cosDecay(value: number): number {
  const t = Math.min(Math.max(value, 0), 1);
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

/** Moyenne : somme de gauche à droite, puis division (comme mean_seq de bras_plan.py). */
function meanSeq(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/** Premier indice où rows[i] ≥ y (= np.searchsorted, côté gauche). */
function searchLeft(rows: readonly number[], y: number): number {
  let i = 0;
  while (i < rows.length && rows[i] < y) i += 1;
  return i;
}

// ---------------------------------------------------------------- géométrie des bras pliés

type Geometry = { ys: number; yj: number; sleeved: boolean; sides: Record<Side, ArmSidePlan> };

/** Manches longues : bras du bas glissés sous les manches du haut, à leur largeur, main figée. */
function sleevedSide(dA: AssemblyArms, dB: AssemblyArms, side: Side, eyeY: number, ys: number, dx: number): ArmSidePlan {
  const strips: Strip[] = [];
  const cuff = dA.cuff[side];
  if (cuff === null) return { strips, rigid: 0, yEnd: null };
  const yc = roundHalfEven(eyeY + cuff);
  const yh = yc - CUFF_HAND; // sous yh : décalage figé (main rigide)
  const rows: number[] = [];
  const D: number[] = [];
  const S: number[] = [];
  const spans: Span[] = [];
  let last: Span | null = null;
  for (let y = ys - 2 * FEATHER; y < yc + 1; y += 1) {
    const rel = y - eyeY;
    const sb = spanAt(dB, side, rel);
    let sa = spanAt(dA, side === 'L' ? 'sleeveL' : 'sleeveR', rel);
    if (sb === null) continue;
    const blo = sb[0] + dx;
    const bhi = sb[1] + dx;
    if (sa === null) sa = last;
    if (sa === null) continue;
    last = sa;
    rows.push(y);
    spans.push([blo, bhi]);
    D.push((sa[0] + sa[1]) / 2 - (blo + bhi) / 2);
    S.push(Math.min(1, (sa[1] - sa[0] - 8) / Math.max(1, bhi - blo)));
  }
  if (rows.length === 0) return { strips, rigid: 0, yEnd: null };
  const n = D.length;
  const Ds = D.map((_, i) => meanSeq(D.slice(Math.max(0, i - SMOOTH_D), i + SMOOTH_D + 1)));
  const Ss = S.map((_, i) => Math.min(...S.slice(Math.max(0, i - SMOOTH_S), i + SMOOTH_S + 1)));
  const ih = Math.min(Math.max(searchLeft(rows, yh), 0), n - 1);
  const Dh = Ds[ih];
  rows.forEach((y, i) => {
    let shift: number;
    let scale: number;
    if (y >= yh) {
      const t = Math.min(1, (y - yh) / 40);
      shift = Dh;
      scale = Ss[ih] * (1 - t) + 1 * t;
    } else {
      shift = Ds[i];
      scale = Ss[i];
    }
    const [blo, bhi] = spans[i];
    const c = (blo + bhi) / 2 + shift;
    const w = (bhi - blo) * scale;
    strips.push([y, blo, bhi, c - w / 2, c + w / 2]);
  });
  return { strips, rigid: Dh, yEnd: rows[rows.length - 1] + 1 };
}

/** Bras nus : décalage qui rejoint le haut à la jonction, puis décroît en cosinus jusqu'au poignet. */
function bareSide(dA: AssemblyArms, dB: AssemblyArms, side: Side, eyeY: number, yj: number, dx: number): ArmSidePlan {
  const strips: Strip[] = [];
  const relJ = yj - eyeY;
  const sa = spanMedian(dA, side, relJ);
  const sb = spanMedian(dB, side, relJ);
  if (sa === null || sb === null) return { strips, rigid: 0, yEnd: null };
  const dlo0 = sa[0] - (sb[0] + dx);
  const dhi0 = sa[1] - (sb[1] + dx);
  const wrist = dB.wrist[side];
  const fold = wrist === null ? L_MAX : Math.min(Math.max(eyeY + wrist - yj, L_MIN), L_MAX);
  const yEnd = Math.floor(yj + fold) + 1;
  for (let y = yj - 2 * FEATHER; y < yEnd; y += 1) {
    const span = spanAt(dB, side, y - eyeY);
    if (span === null) continue;
    const f = y <= yj ? 1 : cosDecay((y - yj) / fold);
    const blo = span[0] + dx;
    const bhi = span[1] + dx;
    strips.push([y, blo, bhi, blo + dlo0 * f, bhi + dhi0 * f]);
  }
  return { strips, rigid: 0, yEnd };
}

/** Manches longues sous la coupe `s` : assez de lignes de manche sondées, des deux côtés. */
function sleevedAt(A: AssemblyPhoto, s: number): boolean {
  const dA = A.arms!;
  const eyeY = A.eye[1];
  const relS = roundHalfEven(eyeY + s) - eyeY;
  let probes = 0;
  for (const key of ['sleeveL', 'sleeveR'] as const) {
    for (let j = 0; j < SLEEVE_PROBE; j += 1) if (spanAt(dA, key, relS + 5 * j) !== null) probes += 1;
  }
  return probes >= SLEEVE_MIN;
}

/** = arm_geometry de bras_plan.py : jonction, manches longues, et par côté les bandes. */
function armGeometry(A: AssemblyPhoto, B: AssemblyPhoto, s: number, band: [number, number] | null, dx: number): Geometry {
  const dA = A.arms!;
  const dB = B.arms!;
  const eyeY = A.eye[1];
  const ys = roundHalfEven(eyeY + s);
  const sleeved = sleevedAt(A, s);
  const yj = sleeved || !band ? ys : roundHalfEven(eyeY + band[0]);
  const sideOf = (side: Side) => (sleeved ? sleevedSide(dA, dB, side, eyeY, ys, dx) : bareSide(dA, dB, side, eyeY, yj, dx));
  return { ys, yj, sleeved, sides: { L: sideOf('L'), R: sideOf('R') } };
}

/** Vrai si le poignet de la photo du bas (d'un côté au moins) est au-dessus de la jonction. */
function wristAboveJunction(A: AssemblyPhoto, B: AssemblyPhoto, yj: number): boolean {
  const eyeY = A.eye[1];
  return [B.arms!.wrist.L, B.arms!.wrist.R].some((w) => w !== null && eyeY + w < yj);
}

// ---------------------------------------------------------------- enregistrement des opérations

class Recorder {
  readonly ops: PlanOp[] = [];

  constructor(
    readonly ox: number,
    readonly oy: number,
    readonly images: ImageMap,
    readonly checks: Partial<Record<PlanCheck, boolean>>,
  ) {}

  clear(dst: CanvasName) {
    this.ops.push({ op: 'clear', dst });
  }

  draw(dst: CanvasName, src: ImageRole | CanvasName, s: Quad, d: Quad, kind?: 'strip' | 'rest', side?: Side) {
    const op: Extract<PlanOp, { op: 'draw' }> = { op: 'draw', dst, src, s, d };
    if (kind) op.kind = kind;
    if (side) op.side = side;
    this.ops.push(op);
  }

  /** stops : [ligne de la photo du haut, poids] → centres de pixels de la scène. */
  fade(dst: CanvasName, stops: Array<[number, number]>) {
    this.ops.push({ op: 'fade', dst, stops: stops.map(([y, w]): [number, number] => [y + this.oy + 0.5, w]) });
  }

  fadeAbs(dst: CanvasName, stops: Array<[number, number]>) {
    this.ops.push({ op: 'fade', dst, stops });
  }

  composite(dst: CanvasName, src: CanvasName, mode: 'source-over' | 'lighter' = 'source-over') {
    this.ops.push({ op: 'composite', dst, src, mode });
  }

  private box(role: ImageRole): [number, number, number, number] {
    const image = this.images[role];
    if (!image) throw new Error(`Image absente du plan : ${role}`);
    return image.box;
  }

  /** Lignes [r0, r1[ (repère de sa photo) de l'image, posée à la translation (tx, ty). */
  drawRows(dst: CanvasName, role: ImageRole, tx: number, ty: number, r0 = -1e9, r1 = 1e9) {
    const [x, y, w, h] = this.box(role);
    const a = Math.max(y, Math.floor(r0));
    const b = Math.min(y + h, Math.ceil(r1));
    if (b <= a) return;
    this.draw(dst, role, [0, a - y, w, b - a], [x + tx + this.ox, a + ty + this.oy, w, b - a]);
  }

  /**
   * Photo du haut (translation nulle), ventre étiré : lignes [y0, ys] lues en y0 + (y − y0)·r ;
   * au-dessus et au-dessous, inchangées ; seulement les lignes < r1.
   */
  drawStretched(dst: CanvasName, role: ImageRole, eyeY: number, band: [number, number] | null, s: number, r1: number) {
    const [x, y, w] = this.box(role);
    if (!band) return this.drawRows(dst, role, 0, 0, -1e9, r1);
    const y0 = roundHalfEven(eyeY + band[0]);
    const y1 = roundHalfEven(eyeY + band[1]);
    const ys = roundHalfEven(eyeY + s);
    if (ys <= y0) return this.drawRows(dst, role, 0, 0, -1e9, r1);
    // bras_plan.py s'arrête ici (assert) ; le navigateur, lui, retombe sur le rendu actuel.
    if (!(y <= y0 && ys + 1 < r1)) {
      this.checks.stretchBox = false;
      return;
    }
    this.drawRows(dst, role, 0, 0, -1e9, y0);
    const r = (y1 - y0) / (ys - y0);
    const n = ys - y0 + 1;
    this.draw(dst, role, [0, y0 - y + 0.5 - 0.5 * r, w, r * n], [x + this.ox, y0 + this.oy, w, n]);
    this.drawRows(dst, role, 0, 0, ys + 1, r1);
  }
}

function quad(rect: DrawStep['source']): Quad {
  return [rect.x, rect.y, rect.width, rect.height];
}

/** Opérations du rendu actuel : la traduction exacte de planRender + drawSilhouette (draw.ts). */
function currentOps(R: Recorder, render: RenderPlan) {
  for (const step of render.upper.draws) R.draw('main', 'A.cutout', quad(step.source), quad(step.dest));
  if (render.lower && render.upper.fade) {
    const { from, to } = render.upper.fade;
    R.fadeAbs('main', [
      [from, 1],
      [to, 0],
    ]);
    R.clear('tmp');
    R.draw('tmp', 'B.cutout', quad(render.lower.draw.source), quad(render.lower.draw.dest));
    R.fadeAbs('tmp', [
      [render.lower.fade.from, 0],
      [render.lower.fade.to, 1],
    ]);
    R.composite('main', 'tmp', 'lighter');
  }
  if (render.sleeves) R.draw('main', 'A.itemSleeves', quad(render.sleeves.source), quad(render.sleeves.dest));
}

/** = ops_plies de bras_plan.py (recette validée dans Chromium). Renvoie ye. */
function pliesOps(
  R: Recorder,
  A: AssemblyPhoto,
  B: AssemblyPhoto,
  geo: Geometry,
  s: number,
  band: [number, number] | null,
  dx: number,
  dy: number,
): number | null {
  const FE = FEATHER;
  const H = A.size[1];
  const { ys, yj, sides } = geo;
  const { ox, oy, checks } = R;
  const split = B.eye[0] + dx;
  const xs = Math.ceil(split); // colonnes < split : côté gauche
  checks.stripSides = true;
  checks.kPositive = true;

  const armsLayer = (rowEnd: number) => {
    R.clear('arms');
    R.drawRows('arms', 'B.arms', dx, dy);
    R.clear('tmp');
    const yTop = yj - 2 * FE;
    for (const sd of ['L', 'R'] as const) {
      const side = sides[sd];
      const [xa, xb] = sd === 'L' ? [0, xs + ox] : [xs + ox, STAGE_WIDTH];
      for (const [y, blo, bhi, dlo, dhi] of side.strips) {
        if (y < 0 || y >= H || y >= rowEnd) continue;
        const k = (dhi - dlo) / Math.max(1, bhi - blo);
        if (k <= 0) {
          checks.kPositive = false;
          continue;
        }
        const x0 = dlo - MX * k;
        const x1 = dhi + MX * k;
        if (!((sd === 'L' && bhi + MX + 1 < split) || (sd === 'R' && blo - MX - 1 >= split))) checks.stripSides = false;
        const Xa = Math.ceil(x0);
        const Xb = Math.floor(x1) + 1;
        if (Xb <= Xa) continue;
        R.draw(
          'tmp',
          'arms',
          [blo + ox + 0.5 + (Xa - 0.5 - dlo) / k, y + oy, (Xb - Xa) / k, 1],
          [Xa + ox, y + oy, Xb - Xa, 1],
          'strip',
          sd,
        );
      }
      const r0 = Math.max(side.yEnd !== null ? side.yEnd : yTop, yTop);
      if (rowEnd > r0) {
        const n = Math.min(rowEnd, H) - r0;
        R.draw('tmp', 'arms', [xa, r0 + oy, xb - xa, n], [xa + side.rigid, r0 + oy, xb - xa, n], 'rest', sd);
      }
    }
    R.fade('tmp', [
      [yj - 2 * FE, 0],
      [yj - FE, 1],
    ]);
    R.composite('main', 'tmp');
  };

  if (geo.sleeved) {
    R.drawRows('main', 'B.body', dx, dy, ys - 2 * FE - 2 - dy);
    R.fade('main', [
      [ys - 2 * FE, 0],
      [ys - FE, 1],
    ]);
    armsLayer(H);
    R.clear('tmp');
    R.drawStretched('tmp', 'A.cutout', A.eye[1], band, s, ys + FE + 2);
    R.fade('tmp', [
      [ys - FE, 1],
      [ys + FE, 0],
    ]);
    R.composite('main', 'tmp');
    if (R.images['A.sleeves']) R.drawStretched('main', 'A.sleeves', A.eye[1], band, s, 1e9);
    checks.fade4 = true;
    return null;
  }

  const ye = Math.max(...(['L', 'R'] as const).map((sd) => sides[sd].yEnd ?? ys));
  checks.fade4 = ys - FE <= ye - 30;
  R.drawRows('main', 'B.cutout', dx, dy, ye - 47 - dy);
  R.fade('main', [
    [ye - 45, 0],
    [ye - 30, 1],
  ]);
  R.clear('tmp');
  R.drawRows('tmp', 'B.body', dx, dy, ys - 2 * FE - 2 - dy, ye + 2 - dy);
  R.fade('tmp', [
    [ys - 2 * FE, 0],
    [ys - FE, 1],
    [ye - 30, 1],
    [ye, 0],
  ]);
  R.composite('main', 'tmp');
  if (band) {
    R.clear('tmp');
    R.drawStretched('tmp', 'A.body', A.eye[1], band, s, ys + FE + 2);
    R.fade('tmp', [
      [ys - FE, 1],
      [ys + FE, 0],
    ]);
    R.composite('main', 'tmp');
  }
  armsLayer(ye);
  R.clear('tmp');
  R.drawRows('tmp', 'A.cutout', 0, 0, -1e9, yj + FE + 2);
  R.fade('tmp', [
    [yj - FE, 1],
    [yj + FE, 0],
  ]);
  R.composite('main', 'tmp');
  return ye;
}

// ---------------------------------------------------------------- plan complet d'une silhouette

/** Images d'une tenue, par rôle (= _images de bras_plan.py), avec leur URL. */
function pairImages(source: Extract<SilhouetteSource, { kind: 'pair' }>): ImageMap {
  const { upper, lower } = source;
  const [W, H] = upper.photo.size;
  const images: ImageMap = {
    'A.cutout': { photo: upper.photo.key, layer: 'cutout', url: upper.url, box: [0, 0, W, H] },
    'B.cutout': { photo: lower.photo.key, layer: 'cutout', url: lower.url, box: [0, 0, lower.photo.size[0], lower.photo.size[1]] },
  };
  if (upper.sleevesUrl) {
    images['A.itemSleeves'] = { photo: upper.photo.key, layer: 'itemSleeves', url: upper.sleevesUrl, box: [0, 0, W, H] };
  }
  for (const [role, picture] of [
    ['A', upper],
    ['B', lower],
  ] as const) {
    const arms = picture.photo.arms;
    const urls = picture.layers;
    if (!arms || !urls) continue;
    for (const layer of ['arms', 'body', 'sleeves'] as const) {
      const data = arms[layer];
      const url = urls[layer];
      if (data && url) images[`${role}.${layer}`] = { photo: picture.photo.key, layer, url, box: [...data.box] };
    }
  }
  return images;
}

/** Les images que les opérations dessinent, rangées par rôle (ordre de sorted() en Python). */
function usedImages(images: ImageMap, ops: readonly PlanOp[]): ImageMap {
  const used = new Set<ImageRole>();
  for (const op of ops) {
    if (op.op === 'draw' && op.src in images) used.add(op.src as ImageRole);
  }
  const out: ImageMap = {};
  for (const role of [...used].sort()) out[role] = images[role];
  return out;
}

function hasArms(picture: { photo: AssemblyPhoto; layers?: unknown }): boolean {
  return Boolean(picture.photo.arms && picture.layers);
}

/**
 * La couche corps de la photo du haut peut-elle servir à cette paire ? Seulement en bras pliés,
 * bras nus (pas de manches longues sous la coupe), avec une bande de ventre étirée : conditions
 * nécessaires de pliesOps, sans calculer le plan (préchargement, docs/conception.md §7 bis). Peut dire vrai
 * pour une paire qui retombe ensuite sur le rendu actuel (haut long, précondition), jamais faux
 * pour une paire dont le plan dessine A.body.
 */
export function upperBodyMayBeDrawn(source: SilhouetteSource): boolean {
  if (source.kind !== 'pair' || !hasArms(source.upper) || !hasArms(source.lower)) return false;
  const A = source.upper.photo;
  if (A.topLow === null) return false;
  const { split, stretch } = planSplit(A, source.lower.photo);
  return stretch !== null && !sleevedAt(A, split);
}

/**
 * Plan de dessin d'une silhouette (= draw_plan de bras_plan.py). Sans données de bras sur l'une
 * des deux photos, c'est exactement le plan d'aujourd'hui (`current` = planRender(source)).
 */
export function planSilhouette(source: SilhouetteSource): SilhouettePlan {
  const base = { width: STAGE_WIDTH, height: STAGE_HEIGHT, canvases: PLAN_CANVASES };

  if (source.kind === 'single') {
    const current = planRender(source);
    const { photo, url } = source.piece;
    const images: ImageMap = { 'A.cutout': { photo: photo.key, layer: 'cutout', url, box: [0, 0, photo.size[0], photo.size[1]] } };
    const R = new Recorder(current.offset.x, current.offset.y, images, {});
    currentOps(R, current);
    return { ...base, mode: 'actuel', reason: 'robe seule', geometry: null, checks: {}, images, ops: R.ops, current };
  }

  const A = source.upper.photo;
  const B = source.lower.photo;
  const { split: s, stretch: band } = planSplit(A, B);
  const { dx, dy } = alignLower(A, B, s);
  const offset = stageOffset(A);
  const [ox, oy] = [offset.x, offset.y];
  const geometry: ArmsGeometry = { s, band: band ? [band[0], band[1]] : null, dx, dy, offset: [ox, oy], ys: roundHalfEven(A.eye[1] + s) };

  let mode: 'actuel' | 'plies';
  let reason: string | null = null;
  let geo: Geometry | null = null;
  if (!hasArms(source.upper) || !hasArms(source.lower)) {
    mode = 'actuel';
    reason = 'pas de données de bras';
  } else if (A.topLow === null) {
    mode = 'actuel';
    reason = 'haut plus long que la zone mesurée';
  } else {
    geo = armGeometry(A, B, s, band, dx);
    geometry.yj = geo.yj;
    geometry.sleeved = geo.sleeved;
    geometry.sides = geo.sides;
    const longTop = s >= LONG_ARMS || wristAboveJunction(A, B, geo.yj);
    geometry.longTop = longTop;
    if (longTop) {
      mode = 'actuel';
      reason = 'haut long';
    } else if (geo.sides.L.yEnd === null && geo.sides.R.yEnd === null) {
      mode = 'actuel';
      reason = 'aucune bande';
    } else {
      mode = 'plies';
    }
  }

  const images = pairImages(source);
  const checks: Partial<Record<PlanCheck, boolean>> = {};
  let R = new Recorder(ox, oy, images, checks);
  if (mode === 'plies' && geo) {
    geometry.ye = pliesOps(R, A, B, geo, s, band, dx, dy);
    const failed = (Object.keys(checks) as PlanCheck[]).filter((key) => !checks[key]);
    if (failed.length > 0) {
      mode = 'actuel';
      reason = `précondition : ${failed.join(', ')}`;
      R = new Recorder(ox, oy, images, checks);
    }
  }
  let current: RenderPlan | null = null;
  if (mode === 'actuel') {
    current = planRender(source);
    currentOps(R, current);
  }
  return { ...base, mode, reason, geometry, checks, images: usedImages(images, R.ops), ops: R.ops, current };
}

