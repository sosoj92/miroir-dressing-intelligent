import { planSilhouette, type CanvasName, type ImageRole, type SilhouettePlan } from './arms-plan';
import { planRender, type DrawStep, type Fade, type RenderPlan, type SilhouetteSource } from './render';

// Adaptateur canvas 2D du rendu (navigateur seulement ; draw.test.ts le teste sur une toile factice) :
// il suit à la lettre le plan calculé par render.ts (rendu sans bras pliés) ou par arms-plan.ts
// (bras pliés), sans aucun calcul de géométrie et sans jamais lire de pixels.

export type DrawableImage = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export type SilhouetteImages = {
  upper: DrawableImage;
  lower: DrawableImage | null;
  sleeves: DrawableImage | null;
};

/** Charge et décode une image (sans crossOrigin : la toile peut être « teintée », elle s'affiche quand même). */
export async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  return image;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponible.');
  return context;
}

function drawStep(context: CanvasRenderingContext2D, image: DrawableImage, { source, dest }: DrawStep) {
  if (source.width <= 0 || source.height <= 0 || dest.width <= 0 || dest.height <= 0) return;
  context.drawImage(image, source.x, source.y, source.width, source.height, dest.x, dest.y, dest.width, dest.height);
}

/** Pondère le calque par le fondu : garde le haut (poids 1 → 0) ou le bas (0 → 1). */
function applyFade(context: CanvasRenderingContext2D, plan: RenderPlan, fade: Fade, keep: 'upper' | 'lower') {
  const gradient = context.createLinearGradient(0, fade.from, 0, fade.to);
  gradient.addColorStop(0, keep === 'upper' ? 'rgba(0, 0, 0, 1)' : 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(1, keep === 'upper' ? 'rgba(0, 0, 0, 0)' : 'rgba(0, 0, 0, 1)');
  context.globalCompositeOperation = 'destination-in';
  context.fillStyle = gradient;
  context.fillRect(0, 0, plan.width, plan.height);
  context.globalCompositeOperation = 'source-over';
}

function prepare(canvas: HTMLCanvasElement, plan: RenderPlan, scale: number): CanvasRenderingContext2D {
  // Redimensionner une toile la vide et remet son état à zéro.
  canvas.width = Math.round(plan.width * scale);
  canvas.height = Math.round(plan.height * scale);
  const context = context2d(canvas);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.imageSmoothingEnabled = true;
  // À l'échelle 1 : interpolation bilinéaire, comme la préparation (décalage et étirement linéaires),
  // exacte pour une translation entière. Vignette réduite : lissage avec mipmaps.
  context.imageSmoothingQuality = scale < 1 ? 'medium' : 'low';
  return context;
}

let scratchCanvas: HTMLCanvasElement | null = null;

/**
 * Dessine la silhouette dans `target` (fond transparent), à l'échelle `scale` de la scène.
 * Paire : haut pondéré dans `target`, bas pondéré dans une toile intermédiaire, puis somme des deux
 * (« lighter », alpha = w·A + (1 − w)·B), puis manches par-dessus.
 */
export function drawSilhouette(target: HTMLCanvasElement, plan: RenderPlan, images: SilhouetteImages, scale = 1) {
  const context = prepare(target, plan, scale);
  for (const step of plan.upper.draws) drawStep(context, images.upper, step);

  if (plan.lower && plan.upper.fade) {
    if (!images.lower) throw new Error('Photo du bas manquante.');
    applyFade(context, plan, plan.upper.fade, 'upper');

    scratchCanvas ??= document.createElement('canvas');
    const scratch = prepare(scratchCanvas, plan, scale);
    drawStep(scratch, images.lower, plan.lower.draw);
    applyFade(scratch, plan, plan.lower.fade, 'lower');

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'lighter';
    context.drawImage(scratchCanvas, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.setTransform(scale, 0, 0, scale, 0, 0);
    // Libère la mémoire de la toile intermédiaire.
    scratchCanvas.width = 0;
    scratchCanvas.height = 0;
  }

  if (plan.sleeves) {
    if (!images.sleeves) throw new Error('Manches manquantes.');
    drawStep(context, images.sleeves, plan.sleeves);
  }
}

// ---------------------------------------------------------------- bras pliés (arms-plan.ts)
// Recette validée dans Chromium (écart ≤ 2,5/255 en GPU avec l'exécuteur de référence,
// scripts/assemblage/canvas_np.py) : trois toiles de la taille de la scène (la silhouette, un
// calque, la couche des bras), bilinéaire pur (imageSmoothingQuality « low », sans mipmaps),
// transformation identité, drawImage, dégradés en destination-in, compositions source-over et
// lighter. Toujours à l'échelle 1 : une vignette est dessinée à 1, puis réduite.

/** Images d'un plan « bras pliés », par rôle (arms-plan.ts). */
export type ArmsImages = Partial<Record<ImageRole, DrawableImage>>;

/**
 * Images chargées d'une silhouette, prêtes à dessiner : rendu sans bras pliés ou bras pliés.
 * `degraded` : rendu sans bras pliés faute d'une image du plan « bras pliés » (coupure passagère,
 * le plus souvent) ; à redessiner plus tard. Jamais pour une paire sans données de bras.
 */
export type PreparedSilhouette =
  | { mode: 'actuel'; plan: RenderPlan; images: SilhouetteImages; degraded?: true }
  | { mode: 'plies'; plan: SilhouettePlan; images: ArmsImages };

type Surface = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D };

/** Réglages de la recette, remis à chaque rendu. */
function stageContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = context2d(canvas);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'low';
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;
  return context;
}

/**
 * Toiles de la taille de la scène réutilisées d'un rendu à l'autre, jamais redimensionnées (le
 * dessin est synchrone : un rendu ne commence jamais pendant un autre). `main` ne sert qu'aux
 * vignettes ; à l'échelle 1, la silhouette est dessinée directement dans sa propre toile.
 */
const sharedSurfaces: Partial<Record<CanvasName, Surface>> = {};

function sharedSurface(name: CanvasName, width: number, height: number): Surface {
  let surface = sharedSurfaces[name];
  if (!surface || surface.canvas.width !== width || surface.canvas.height !== height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    surface = { canvas, context: context2d(canvas) };
    sharedSurfaces[name] = surface;
  }
  const context = stageContext(surface.canvas);
  // Vide, comme une toile neuve : l'exécuteur de référence part de toiles transparentes.
  context.clearRect(0, 0, width, height);
  return surface;
}

function isCanvasName(source: ImageRole | CanvasName): source is CanvasName {
  return source === 'main' || source === 'tmp' || source === 'arms';
}

/** Exécute les opérations du plan, dans l'ordre, sans aucun calcul de géométrie. */
function runPlan(plan: SilhouettePlan, images: ArmsImages, surfaces: Record<CanvasName, Surface>) {
  for (const op of plan.ops) {
    if (op.op === 'clear') {
      const { canvas, context } = surfaces[op.dst];
      context.clearRect(0, 0, canvas.width, canvas.height);
    } else if (op.op === 'draw') {
      const [sx, sy, sw, sh] = op.s;
      const [dx, dy, dw, dh] = op.d;
      // Comme l'exécuteur de référence : un rectangle vide ne dessine rien (jamais à l'envers).
      if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
      const source = isCanvasName(op.src) ? surfaces[op.src].canvas : images[op.src];
      if (!source) throw new Error(`Image manquante : ${op.src}.`);
      surfaces[op.dst].context.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
    } else if (op.op === 'fade') {
      const { canvas, context } = surfaces[op.dst];
      const first = op.stops[0][0];
      const last = op.stops[op.stops.length - 1][0];
      const gradient = context.createLinearGradient(0, first, 0, last);
      for (const [y, weight] of op.stops) gradient.addColorStop((y - first) / (last - first), `rgba(0, 0, 0, ${weight})`);
      context.globalCompositeOperation = 'destination-in';
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = 'source-over';
    } else {
      const { context } = surfaces[op.dst];
      context.globalCompositeOperation = op.mode;
      context.drawImage(surfaces[op.src].canvas, 0, 0);
      context.globalCompositeOperation = 'source-over';
    }
  }
}

/**
 * Dessine un plan « bras pliés » dans `target` (fond transparent). À l'échelle 1, directement ;
 * sinon à l'échelle 1 dans une toile de la scène, ensuite réduite dans `target`.
 */
export function drawArmsPlan(target: HTMLCanvasElement, plan: SilhouettePlan, images: ArmsImages, scale = 1) {
  const direct = scale === 1;
  let main: Surface;
  if (direct) {
    // Redimensionner une toile la vide.
    target.width = plan.width;
    target.height = plan.height;
    main = { canvas: target, context: stageContext(target) };
  } else {
    main = sharedSurface('main', plan.width, plan.height);
  }
  runPlan(plan, images, {
    main,
    tmp: sharedSurface('tmp', plan.width, plan.height),
    arms: sharedSurface('arms', plan.width, plan.height),
  });
  if (direct) return;
  target.width = Math.round(plan.width * scale);
  target.height = Math.round(plan.height * scale);
  const context = context2d(target);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.imageSmoothingEnabled = true;
  // Réduction lissée avec mipmaps, comme les vignettes sans bras pliés.
  context.imageSmoothingQuality = 'medium';
  context.drawImage(main.canvas, 0, 0);
}

/**
 * Charge les images d'une silhouette : celles que son plan dessine, chacune une fois. Sans bras
 * pliés, exactement comme avant eux (photo du haut, du bas, manches de la pièce).
 */
export async function prepareSilhouette(
  source: SilhouetteSource,
  load: (url: string) => Promise<DrawableImage>,
): Promise<PreparedSilhouette> {
  const armsPlan = planSilhouette(source);
  let degraded = false;
  if (armsPlan.mode === 'plies') {
    const roles = Object.keys(armsPlan.images) as ImageRole[];
    const urls = [...new Set(roles.map((role) => armsPlan.images[role]!.url))];
    try {
      const loaded = await Promise.all(urls.map((url) => load(url)));
      const byUrl = new Map(urls.map((url, index) => [url, loaded[index]]));
      const images: ArmsImages = {};
      for (const role of roles) images[role] = byUrl.get(armsPlan.images[role]!.url);
      return { mode: 'plies', plan: armsPlan, images };
    } catch {
      // Une image introuvable (couche des bras pliés, le plus souvent) : rendu sans bras pliés,
      // comme pour une couche non signée, marqué pour être redessiné quand l'image reviendra. Si
      // c'est une photo détourée, il échouera à son tour.
      degraded = true;
    }
  }
  const plan = armsPlan.current ?? planRender(source);
  const [upperUrl, lowerUrl, sleevesUrl] =
    source.kind === 'single' ? [source.piece.url, null, null] : [source.upper.url, source.lower.url, source.upper.sleevesUrl];
  const [upper, lower, sleeves] = await Promise.all([
    load(upperUrl),
    lowerUrl ? load(lowerUrl) : null,
    sleevesUrl ? load(sleevesUrl) : null,
  ]);
  const images = { upper, lower, sleeves };
  return degraded ? { mode: 'actuel', plan, images, degraded: true } : { mode: 'actuel', plan, images };
}

/** Dessine une silhouette préparée dans `target`, à l'échelle `scale` de la scène. */
export function paintSilhouette(target: HTMLCanvasElement, prepared: PreparedSilhouette, scale = 1) {
  if (prepared.mode === 'plies') drawArmsPlan(target, prepared.plan, prepared.images, scale);
  else drawSilhouette(target, prepared.plan, prepared.images, scale);
}

/** Charge les images d'une silhouette puis la dessine dans une nouvelle toile hors écran. */
export async function renderSilhouette(
  source: SilhouetteSource,
  load: (url: string) => Promise<DrawableImage>,
  scale = 1,
): Promise<HTMLCanvasElement> {
  const prepared = await prepareSilhouette(source, load);
  const canvas = document.createElement('canvas');
  paintSilhouette(canvas, prepared, scale);
  return canvas;
}

