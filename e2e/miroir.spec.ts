import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
import { FEATHER } from '../lib/assembly/plan';
import { STAGE_HEIGHT, STAGE_WIDTH, planRender } from '../lib/assembly/render';
import { targetDay } from '../lib/dates';
import { CAMERA_LINES, CAMERA_RETRY_MS, CAMERA_STALL_MS } from '../lib/mirror/camera';
import { PRELOAD_TIMEOUT_MS, SILHOUETTE_DIM_OPACITY, VERSION_POLL_MS } from '../lib/mirror/timing';
import { mirrorVersion, withPlanVersion } from '../lib/mirror/version';
import type { HoldView } from '../lib/gestures/types';
import type { MirrorItem, MirrorPayload } from '../lib/types';
import {
  ASSEMBLED_WARDROBE,
  ASSEMBLY_COLORS,
  ASSEMBLY_PATH,
  CORE_CATEGORIES,
  CUTOUT_PATH,
  LOWER_PHOTO,
  UPPER_PHOTO,
  WARDROBE,
  assemblyImages,
  categoryOf,
  isoDateIn,
  mirrorPayload,
  nextDay,
  rainyWeather,
} from './fixtures/mirror';
import { cutoutPng } from './fixtures/png';
import { capturePath } from './support';

// Écran miroir de la tablette (docs/conception.md §4, §5, §7 bis). /api/miroir et ses sous-routes sont simulées
// par page.route : aucune session ni base n'est nécessaire. Les tenues sont calculées par le vrai
// generateOutfits dans le navigateur : on lit donc les pièces affichées dans le DOM au lieu de les
// supposer. Derrière un miroir sans tain, tout pixel non noir s'allume : on le vérifie aussi.

const API = /\/api\/miroir$/;
const KEYS_API = /\/api\/miroir\/touches$/;
const ACCEPT_API = /\/api\/miroir\/accepter$/;
const REFUSE_API = /\/api\/miroir\/refuser$/;
const RESTART_API = /\/api\/miroir\/recommencer$/;

type Posted = { accepter: unknown[]; refuser: unknown[]; recommencer: unknown[]; touches: unknown[] };

/** Simule l'API du miroir et sert les détourages. Renvoie les corps des POST reçus. */
async function mockMirror(page: Page, payload: MirrorPayload | null, status = 200): Promise<Posted> {
  const posted: Posted = { accepter: [], refuser: [], recommencer: [], touches: [] };
  const png = cutoutPng();
  const worn = assemblyImages();

  await page.route(`**${CUTOUT_PATH}**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: png }),
  );
  // Photos portées détourées et manches (même origine que la page : la toile reste lisible).
  await page.route(`**${ASSEMBLY_PATH}**`, (route) => {
    const body = worn[new URL(route.request().url()).pathname.slice(ASSEMBLY_PATH.length)];
    return body
      ? route.fulfill({ status: 200, contentType: 'image/png', body })
      : route.fulfill({ status: 404, body: '' });
  });
  await page.route(API, (route) =>
    route.fulfill(
      status === 200
        ? { status, json: payload, headers: { 'Cache-Control': 'no-store' } }
        : { status, json: { error: 'Connexion requise.' } },
    ),
  );
  await page.route(KEYS_API, (route) => {
    if (route.request().method() === 'POST') {
      posted.touches.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    return route.fulfill({ status: 200, json: {} });
  });
  await page.route(ACCEPT_API, (route) => {
    posted.accepter.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, json: { ok: true } });
  });
  await page.route(REFUSE_API, (route) => {
    posted.refuser.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, json: { ok: true } });
  });
  await page.route(RESTART_API, (route) => {
    posted.recommencer.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, json: { ok: true } });
  });
  return posted;
}

function isPost(pattern: RegExp) {
  return (request: Request) => request.method() === 'POST' && pattern.test(request.url());
}

async function backgrounds(page: Page) {
  return page.evaluate(() =>
    [document.documentElement, document.body, document.querySelector('main')].map((element) =>
      element ? getComputedStyle(element).backgroundColor : 'absent',
    ),
  );
}

const BLACK = ['rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)'];

/** La tenue affichée, par ses pièces (composition libre : pas de compteur). */
async function shownKey(page: Page): Promise<string> {
  return (await page.getByTestId('mirror-outfit').getAttribute('data-outfit-key')) ?? '';
}

/** La pièce affichée d'une catégorie (haut, bas, veste), ou undefined. */
async function shownPiece(page: Page, category: string): Promise<string | undefined> {
  return (await shownItemIds(page)).find((id) => categoryOf(id) === category);
}

async function shownItemIds(page: Page): Promise<string[]> {
  const ids = await page.getByTestId('mirror-outfit').getAttribute('data-item-ids');
  return (ids ?? '').split(',').filter(Boolean);
}

function dayLabel(isoDate: string): RegExp {
  const label = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${isoDate}T12:00:00Z`));
  return new RegExp(`^${label}$`, 'i');
}

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Boîtes de tout ce qui a le droit d'être allumé : texte, images détourées, icônes au trait. */
async function contentBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const boxes: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (const element of document.querySelectorAll('main *')) {
      const tag = element.tagName.toLowerCase();
      const hasText = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
      );
      if (tag === 'img' || tag === 'svg' || tag === 'canvas' || hasText) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          boxes.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }
      }
    }
    return boxes;
  });
}

/** Décode la capture dans une page vierge (canvas) : pixels allumés hors des boîtes, pixels colorés. */
async function analyse(context: BrowserContext, screenshot: Buffer, boxes: Box[], scale: number) {
  const decoder = await context.newPage();
  const result = await decoder.evaluate(
    async ({ base64, boxes, scale }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context2d = canvas.getContext('2d', { willReadFrequently: true });
      if (!context2d) throw new Error('canvas 2d indisponible');
      context2d.drawImage(image, 0, 0);
      const { data, width, height } = context2d.getImageData(0, 0, canvas.width, canvas.height);

      // Marge : les jambages des grandes lettres (p, j) dépassent un peu de leur boîte de ligne.
      const margin = 8 * scale;
      const rects = boxes.map((box) => ({
        left: Math.floor(box.x * scale) - margin,
        top: Math.floor(box.y * scale) - margin,
        right: Math.ceil((box.x + box.width) * scale) + margin,
        bottom: Math.ceil((box.y + box.height) * scale) + margin,
      }));

      let litOutside = 0;
      let lit = 0;
      let coloured = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
          if (r === 0 && g === 0 && b === 0) continue;
          lit++;
          if (r !== g || g !== b) coloured++;
          if (!rects.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) {
            litOutside++;
          }
        }
      }
      return { width, height, lit, litOutside, coloured };
    },
    { base64: screenshot.toString('base64'), boxes, scale },
  );
  await decoder.close();
  return result;
}

/** Couleurs de la capture d'écran en ces points (px de l'appareil). */
async function screenshotPixels(context: BrowserContext, screenshot: Buffer, points: Array<{ x: number; y: number }>) {
  const decoder = await context.newPage();
  const colours = await decoder.evaluate(
    async ({ base64, points }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context2d = canvas.getContext('2d', { willReadFrequently: true });
      if (!context2d) throw new Error('canvas 2d indisponible');
      context2d.drawImage(image, 0, 0);
      const { data, width } = context2d.getImageData(0, 0, canvas.width, canvas.height);
      return points.map(({ x, y }) => {
        const i = (y * width + x) * 4;
        return [data[i], data[i + 1], data[i + 2]];
      });
    },
    { base64: screenshot.toString('base64'), points },
  );
  await decoder.close();
  return colours;
}

type Colour = readonly [number, number, number];

type SilhouetteReading = {
  width: number;
  height: number;
  above: Record<string, number>;
  below: Record<string, number>;
  fadeAlphaMin: number;
  probes: Record<string, number[]>;
  background: Array<{ x: number; y: number }>;
};

/**
 * Lit la toile de la silhouette (avant le filtre CSS) : couleurs aux points demandés (repère de la
 * scène), couleurs rencontrées au-dessus et au-dessous du fondu, alpha minimal dans le fondu, et
 * points de fond (transparents tout autour) convertis en px de la capture d'écran.
 */
async function readSilhouette(
  page: Page,
  args: {
    colours: Record<string, Colour>;
    cut: number;
    feather: number;
    column: number;
    probes: Record<string, { x: number; y: number }>;
    dpr: number;
  },
): Promise<SilhouetteReading> {
  return page
    .getByTestId('mirror-silhouette')
    .evaluate((element, { colours, cut, feather, column, probes, dpr }) => {
      const canvas = element as HTMLCanvasElement;
      const context2d = canvas.getContext('2d');
      if (!context2d) throw new Error('canvas 2d indisponible');
      const { data, width, height } = context2d.getImageData(0, 0, canvas.width, canvas.height);
      const rgba = (x: number, y: number) => {
        const i = (y * width + x) * 4;
        return [data[i], data[i + 1], data[i + 2], data[i + 3]];
      };
      const nameOf = (r: number, g: number, b: number) =>
        Object.entries(colours).find(
          ([, c]) => Math.abs(c[0] - r) <= 4 && Math.abs(c[1] - g) <= 4 && Math.abs(c[2] - b) <= 4,
        )?.[0] ?? 'autre';

      // Hors du fondu, chaque pixel opaque doit venir de la bonne photo.
      const above: Record<string, number> = {};
      const below: Record<string, number> = {};
      for (let y = 0; y < height; y++) {
        if (y >= cut - feather && y <= cut + feather) continue;
        const bucket = y < cut ? above : below;
        for (let x = 0; x < width; x++) {
          const [r, g, b, a] = rgba(x, y);
          if (a !== 255) continue;
          const name = nameOf(r, g, b);
          bucket[name] = (bucket[name] ?? 0) + 1;
        }
      }

      // Dans le fondu, les deux calques opaques se complètent : alpha = w + (1 − w) = 1.
      let fadeAlphaMin = 255;
      for (let y = cut - feather; y <= cut + feather; y++) fadeAlphaMin = Math.min(fadeAlphaMin, rgba(column, y)[3]);

      // Points de fond : transparents à 4 px à la ronde, puis leur place dans la capture
      // (la toile est mise à l'échelle par object-fit: contain).
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(rect.width / width, rect.height / height);
      const left = rect.left + (rect.width - width * scale) / 2;
      const top = rect.top + (rect.height - height * scale) / 2;
      const background: Array<{ x: number; y: number }> = [];
      for (let y = 8; y < height - 8; y += 24) {
        for (let x = 8; x < width - 8; x += 24) {
          let clear = true;
          for (let dy = -4; dy <= 4 && clear; dy++) {
            for (let dx = -4; dx <= 4 && clear; dx++) clear = rgba(x + dx, y + dy)[3] === 0;
          }
          if (clear) {
            background.push({
              x: Math.round((left + (x + 0.5) * scale) * dpr),
              y: Math.round((top + (y + 0.5) * scale) * dpr),
            });
          }
        }
      }

      return {
        width,
        height,
        above,
        below,
        fadeAlphaMin,
        probes: Object.fromEntries(Object.entries(probes).map(([name, { x, y }]) => [name, rgba(x, y)])),
        background,
      };
    }, args);
}

test.describe('miroir', () => {
  test('sans simulation, / répond 200 sur fond noir', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.locator('main[data-screen="mirror"]')).toBeAttached();
    expect(await backgrounds(page)).toEqual(BLACK);
  });

  test('sans session (401) : « Tablette non connectée » et un lien « Se connecter » à toucher', async ({
    page,
    context,
  }, testInfo) => {
    await mockMirror(page, null, 401);
    await page.goto('/');
    const status = page.getByTestId('mirror-status');
    await expect(status).toHaveText('Tablette non connectée');
    await expect(status).toHaveCSS('color', 'rgb(204, 204, 204)');
    // Plus d'adresse à taper : un lien, en blanc, sans cadre, assez haut pour le doigt. La page de
    // connexion ramène au miroir (depuis=miroir).
    const link = page.getByRole('link', { name: 'Se connecter' });
    await expect(link).toHaveAttribute('href', '/connexion?depuis=miroir');
    await expect(link).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(link).toHaveCSS('border-top-width', '0px');
    expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(await page.locator('main').innerText()).not.toContain('/connexion');
    expect(await backgrounds(page)).toEqual(BLACK);

    const screenshot = await page.screenshot({ path: capturePath(testInfo, 'miroir-non-connecte') });
    const scale = testInfo.project.use.deviceScaleFactor ?? 1;
    const pixels = await analyse(context, screenshot, await contentBoxes(page), scale);
    expect(pixels.litOutside, 'pixels allumés hors du texte').toBe(0);
    expect(pixels.coloured, 'seulement du blanc et du gris').toBe(0);
  });

  test('tenue : fond noir partout, date, météo, pièces détourées et indicateurs au trait', async ({
    page,
    context,
  }, testInfo) => {
    await mockMirror(page, mirrorPayload());
    await page.goto('/');

    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    await expect(page.getByTestId('mirror-date')).toHaveText(dayLabel(isoDateIn(new Date())));
    await expect(page.getByTestId('mirror-weather')).toHaveText('Nuageux · 12° à 19°');
    await expect(page.getByTestId('mirror-tomorrow')).toHaveCount(0);
    expect(await backgrounds(page)).toEqual(BLACK);

    // Composition libre : pas de compteur ; ni « Prévue » ni « Écartée » ici.
    await expect(page.getByTestId('mirror-position')).toHaveText('');
    await expect(page.getByTestId('mirror-title')).not.toBeEmpty();

    // Sans photo portée, pas de silhouette : les pièces détourées empilées, ou leur nom en texte.
    // Chaussures et accessoires ne sont jamais proposés (la silhouette ne les dessine pas).
    await expect(page.getByTestId('mirror-outfit')).toHaveAttribute('data-display', 'pieces');
    const ids = await shownItemIds(page);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    for (const id of ids) expect(CORE_CATEGORIES).toContain(categoryOf(id));
    const images = page.getByTestId('mirror-outfit').locator('img');
    expect(await images.count()).toBeGreaterThan(0);
    for (const image of await images.all()) {
      expect(await image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(
        true,
      );
    }

    // « ← → haut  ↑ ↓ bas  V veste  oui  non » avec cinq icônes SVG au trait (le V devant
    // « veste » : un Trench propre peut être proposé), et aucun emoji nulle part. Aucun anneau de
    // progression sans geste tenu.
    const controls = page.getByTestId('mirror-controls');
    await expect(controls).toContainText('haut');
    await expect(controls).toContainText('bas');
    await expect(controls).toContainText('oui');
    await expect(controls).toContainText('non');
    await expect(controls.locator('svg')).toHaveCount(5);
    await expect(page.getByTestId('mirror-controls-jacket').locator('svg')).toHaveCount(1);
    await expect(page.getByTestId('mirror-hold-ring')).toHaveCount(0);
    await expect(page.getByTestId('mirror-controls-jacket')).toHaveText('veste');
    // Pas de caméra (Chromium de test sans caméra) : rien ne le dit, le clavier marche.
    await expect(page.locator('main')).toHaveAttribute('data-camera', 'absent');
    await expect(page.getByTestId('mirror-camera')).toHaveCount(0);
    expect(await controls.innerText()).toMatch(/haut\s+bas\s+veste\s+oui\s+non/);
    await expect(page.getByTestId('mirror-controls-refused')).toBeHidden();
    expect(await page.locator('main').innerText()).not.toMatch(/\p{Extended_Pictographic}/u);
    // Les cinq groupes tiennent sur une ligne dans les 720 px utiles, place de « écartée » comprise.
    const legend = await controls.boundingBox();
    expect(legend!.width).toBeLessThanOrEqual(720);
    const tops = await controls.locator(':scope > span').evaluateAll((groups) =>
      groups.map((group) => Math.round(group.getBoundingClientRect().top)),
    );
    expect(tops).toHaveLength(5);
    expect(new Set(tops).size).toBe(1);
    // La ligne visible est centrée comme l'en-tête et la légende : « écartée » ne lui prend pas de
    // place.
    expect(Math.abs(legend!.x + legend!.width / 2 - 400)).toBeLessThanOrEqual(2);

    const screenshot = await page.screenshot({ path: capturePath(testInfo, 'miroir-tenue') });
    const scale = testInfo.project.use.deviceScaleFactor ?? 1;
    const pixels = await analyse(context, screenshot, await contentBoxes(page), scale);
    expect(pixels.width).toBe(800 * scale);
    expect(pixels.height).toBe(1280 * scale);
    expect(pixels.lit, 'des éléments doivent être allumés').toBeGreaterThan(0);
    expect(pixels.litOutside, 'pixels allumés hors du texte, des pièces et des icônes').toBe(0);
  });

  test('anneau d’un geste tenu : autour du pouce, du poing ou du V, sans toucher les mots ni rien bouger', async ({
    page,
    context,
  }, testInfo) => {
    // La fausse caméra ne montre jamais de pouce : avec ?gestures=debug, le store de l'anneau est
    // écrit à la main (window.monDressingGestures), comme le ferait un geste tenu.
    await mockMirror(page, mirrorPayload());
    await page.goto('/?gestures=debug');
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    await expect(page.locator('main')).toHaveAttribute('data-camera', 'absent');
    const controls = page.getByTestId('mirror-controls');
    await expect(page.getByTestId('mirror-controls-jacket')).toHaveText('veste');
    const legend = (await controls.boundingBox())!;
    const groups = () =>
      controls.locator(':scope > span').evaluateAll((spans) =>
        spans.map((span) => {
          const rect = span.getBoundingClientRect();
          return [rect.x, rect.y, rect.width, rect.height];
        }),
      );
    const before = await groups();
    const setHold = (hold: HoldView | null) =>
      page.evaluate((value) => window.monDressingGestures!.hold.set(value), hold);
    /** Le mot de la légende (son nœud texte), en px CSS. */
    const wordBox = (word: string) =>
      controls.evaluate((footer, text) => {
        const walker = document.createTreeWalker(footer, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.textContent?.trim() !== text) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }
        throw new Error(`mot absent : ${text}`);
      }, word);
    const ring = page.getByTestId('mirror-hold-ring');
    // Le debug (texte en haut à gauche) n'est pas sur le miroir de tous les jours : pas dans la capture.
    await page.addStyleTag({ content: '[data-testid="mirror-gestures-debug"] { display: none; }' });

    // Pouce : le cercle de 50 px (52 hors tout) centré sur l'icône de 40 px, à 10 px de « oui ».
    await setHold({ action: 'accept', side: 'right', progress: 0.6 });
    await expect(ring).toHaveCount(1);
    await expect(ring).toHaveAttribute('data-action', 'accept');
    await expect(ring.locator('circle')).toHaveAttribute('stroke-dasharray', '60 100');
    const thumb = (await ring.locator('xpath=..').locator('svg').first().boundingBox())!;
    let box = (await ring.boundingBox())!;
    expect(box.width).toBe(52);
    expect(Math.abs(box.x + box.width / 2 - (thumb.x + thumb.width / 2))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(box.y + box.height / 2 - (thumb.y + thumb.height / 2))).toBeLessThanOrEqual(0.5);
    const yes = await wordBox('oui');
    expect(yes.x - (box.x + box.width)).toBeGreaterThanOrEqual(8);
    // Dans la hauteur de la légende, et rien ne bouge.
    expect(box.y).toBeGreaterThanOrEqual(legend.y);
    expect(box.y + box.height).toBeLessThanOrEqual(legend.y + legend.height);
    expect(await groups()).toEqual(before);
    const screenshot = await page.screenshot({ path: capturePath(testInfo, 'miroir-anneau') });
    const scale = testInfo.project.use.deviceScaleFactor ?? 1;
    const pixels = await analyse(context, screenshot, await contentBoxes(page), scale);
    expect(pixels.litOutside, 'pixels allumés hors du texte, des pièces, des icônes et de l’anneau').toBe(0);

    // Poing : à 10 px de « non ».
    await setHold({ action: 'refuse', side: 'right', progress: 0.3 });
    await expect(ring).toHaveAttribute('data-action', 'refuse');
    box = (await ring.boundingBox())!;
    const no = await wordBox('non');
    expect(no.x - (box.x + box.width)).toBeGreaterThanOrEqual(8);
    expect(await groups()).toEqual(before);

    // V : autour de l'icône du V, à 10 px de « veste », qui reste affiché.
    await setHold({ action: 'jacket', side: 'left', progress: 0.5 });
    await expect(ring).toHaveAttribute('data-action', 'jacket');
    const victory = (await ring.locator('xpath=..').locator('svg').first().boundingBox())!;
    box = (await ring.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - (victory.x + victory.width / 2))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(box.y + box.height / 2 - (victory.y + victory.height / 2))).toBeLessThanOrEqual(0.5);
    const coat = await wordBox('veste');
    expect(coat.x - (box.x + box.width)).toBeGreaterThanOrEqual(8);
    await expect(page.getByTestId('mirror-controls-jacket').getByText('veste')).toBeVisible();
    expect(await groups()).toEqual(before);
    await page.screenshot({ path: capturePath(testInfo, 'miroir-anneau-veste') });

    // Validé ou relâché : plus d'anneau, « veste » est toujours là.
    await setHold(null);
    await expect(ring).toHaveCount(0);
    await expect(page.getByTestId('mirror-controls-jacket')).toHaveText('veste');
    await expect(page.getByTestId('mirror-controls-jacket').getByText('veste')).toBeVisible();
  });

  test('tenue assemblée : le haut vient de la photo du haut, le bas de l’autre, sur fond noir', async ({
    page,
    context,
  }, testInfo) => {
    await mockMirror(page, mirrorPayload({ items: ASSEMBLED_WARDROBE }));
    await page.goto('/');

    const outfit = page.getByTestId('mirror-outfit');
    const canvas = page.getByTestId('mirror-silhouette');
    await expect(canvas).toBeVisible();
    await expect(outfit).toHaveAttribute('data-display', 'silhouette');
    // Une seule tenue possible : le haut et le bas, sans chaussures ni accessoire (non dessinés).
    expect((await shownItemIds(page)).sort()).toEqual([ASSEMBLED_WARDROBE[0].id, ASSEMBLED_WARDROBE[1].id].sort());
    await expect(page.getByTestId('mirror-title')).not.toBeEmpty();
    await expect(page.getByTestId('mirror-controls')).toBeVisible();
    // La place de la ligne d'état n'est plus réservée deux fois : 1280 − 156 (en-tête) − 104
    // (commandes) − 176 (légende : deux lignes, la note, l'état) − 32 = 812 px de haut pour la
    // silhouette (752 avant).
    expect((await canvas.boundingBox())?.height).toBe(812);
    // Éclaircissement léger et constant (vêtements foncés derrière le miroir), sans halo.
    await expect(canvas).toHaveCSS('filter', /^brightness\([\d.]+\)$/);
    expect(await backgrounds(page)).toEqual(BLACK);

    // Repère de la scène : yeux du haut en STAGE_EYE, coupe à 206 px sous ces yeux (fixtures/mirror.ts).
    const plan = planRender({
      kind: 'pair',
      upper: { photo: UPPER_PHOTO, url: 'haut', sleevesUrl: 'manches' },
      lower: { photo: LOWER_PHOTO, url: 'bas' },
    });
    expect(plan.offset).toEqual({ x: 200, y: 50 });
    expect(plan.cut).toBe(50 + 100 + 206);
    const cut = plan.cut!;
    /** Point de la scène correspondant au pixel (x, y) de la photo du haut. */
    const at = (x: number, y: number) => ({ x: plan.offset.x + x, y: plan.offset.y + y });

    const dpr = testInfo.project.use.deviceScaleFactor ?? 1;
    const pixels = await readSilhouette(page, {
      colours: ASSEMBLY_COLORS,
      cut,
      feather: FEATHER,
      column: at(200, 0).x,
      dpr,
      probes: {
        head: at(200, 100),
        top: at(200, 250), // buste rouge, au-dessus de la coupe (100 + 206)
        legs: at(200, 380), // jambes jaunes de la photo du bas
        shiftedLegs: at(255, 450), // le bas est décalé de 10 px vers la droite (dx)
        besideShiftedLegs: at(135, 450),
        sleeve: at(105, 400), // manches du haut, par-dessus, sous la coupe
        cornerTop: { x: 4, y: 4 },
        cornerBottom: { x: STAGE_WIDTH - 5, y: STAGE_HEIGHT - 5 },
      },
    });

    expect([pixels.width, pixels.height]).toEqual([STAGE_WIDTH, STAGE_HEIGHT]);
    expect(pixels.probes.head).toEqual([...ASSEMBLY_COLORS.skin, 255]);
    expect(pixels.probes.top).toEqual([...ASSEMBLY_COLORS.top, 255]);
    expect(pixels.probes.legs).toEqual([...ASSEMBLY_COLORS.legs, 255]);
    expect(pixels.probes.shiftedLegs).toEqual([...ASSEMBLY_COLORS.legs, 255]);
    expect(pixels.probes.besideShiftedLegs[3]).toBe(0);
    expect(pixels.probes.sleeve).toEqual([...ASSEMBLY_COLORS.sleeves, 255]);
    expect(pixels.probes.cornerTop[3]).toBe(0);
    expect(pixels.probes.cornerBottom[3]).toBe(0);

    // Au-dessus du fondu : seulement la photo du haut (tête, buste, manches), jamais le buste bleu
    // ni les jambes de l'autre photo. En dessous : seulement les jambes de la photo du bas (et les
    // manches), jamais les jambes vertes de la photo du haut.
    expect(pixels.above.top).toBeGreaterThan(1000);
    expect(pixels.above.skin).toBeGreaterThan(1000);
    expect(Object.keys(pixels.above).sort()).toEqual(['skin', 'sleeves', 'top']);
    expect(pixels.below.legs).toBeGreaterThan(1000);
    expect(Object.keys(pixels.below).sort()).toEqual(['legs', 'sleeves']);
    expect(pixels.fadeAlphaMin, 'fondu sans bande transparente').toBeGreaterThanOrEqual(250);

    // Fond : transparent dans la toile, donc noir à l'écran, filtre compris.
    const screenshot = await page.screenshot({ path: capturePath(testInfo, 'miroir-assemble') });
    expect(pixels.background.length).toBeGreaterThan(200);
    const colours = await screenshotPixels(context, screenshot, pixels.background);
    expect(colours.filter(([r, g, b]) => r !== 0 || g !== 0 || b !== 0)).toEqual([]);
    const lit = await analyse(context, screenshot, await contentBoxes(page), dpr);
    expect(lit.litOutside, 'pixels allumés hors du texte, de la silhouette et des icônes').toBe(0);
  });

  test('tenue mixte (un bas sans photo portée) : pièces empilées, le haut porté réduit à sa zone', async ({
    page,
    context,
  }, testInfo) => {
    const [wornTop] = ASSEMBLED_WARDROBE;
    const flatBottom = WARDROBE.find((piece) => piece.category === 'bas')!;
    await mockMirror(page, mirrorPayload({ items: [wornTop, flatBottom] }));
    await page.goto('/');

    const outfit = page.getByTestId('mirror-outfit');
    await expect(outfit).toHaveAttribute('data-display', 'pieces');
    await expect(page.getByTestId('mirror-silhouette')).toHaveCount(0);
    await expect(outfit.locator(`[data-item-id="${wornTop.id}"] svg[role="img"]`)).toBeVisible();
    await expect(outfit.locator(`[data-item-id="${flatBottom.id}"] img`)).toBeVisible();
    expect(await backgrounds(page)).toEqual(BLACK);

    // Zone d'un haut : de la tête à 40 px sous l'ourlet (lib/items/zone.ts). Le buste rouge se
    // voit ; les jambes vertes de la photo du haut, plus bas, jamais.
    const screenshot = await page.screenshot({ path: capturePath(testInfo, 'miroir-tenue-mixte') });
    const dpr = testInfo.project.use.deviceScaleFactor ?? 1;
    const decoder = await context.newPage();
    const counts = await decoder.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context2d = canvas.getContext('2d', { willReadFrequently: true });
      if (!context2d) throw new Error('canvas 2d indisponible');
      context2d.drawImage(image, 0, 0);
      const { data } = context2d.getImageData(0, 0, canvas.width, canvas.height);
      let red = 0;
      let green = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (r > 150 && g < 90 && b < 90) red++;
        if (g > 140 && r < 90 && b < 110) green++;
      }
      return { red, green };
    }, screenshot.toString('base64'));
    await decoder.close();
    expect(counts.red, 'buste rouge du haut porté').toBeGreaterThan(1000);
    expect(counts.green, 'jambes de la photo du haut').toBe(0);
    const lit = await analyse(context, screenshot, await contentBoxes(page), dpr);
    expect(lit.litOutside, 'pixels allumés hors du texte, des pièces et des icônes').toBe(0);
  });

  test('aucune tenue : écran sobre, seulement du blanc et du gris', async ({ page, context }, testInfo) => {
    await mockMirror(page, mirrorPayload({ items: [] }));
    await page.goto('/');

    await expect(page.getByTestId('mirror-empty')).toHaveText('Aucune tenue disponible');
    await expect(page.getByTestId('mirror-controls')).toHaveCount(0);
    expect(await backgrounds(page)).toEqual(BLACK);

    const screenshot = await page.screenshot();
    const scale = testInfo.project.use.deviceScaleFactor ?? 1;
    const pixels = await analyse(context, screenshot, await contentBoxes(page), scale);
    expect(pixels.lit, 'le texte doit être allumé').toBeGreaterThan(0);
    expect(pixels.litOutside, 'pixels allumés hors du texte').toBe(0);
    expect(pixels.coloured, 'pixels colorés (seuls le blanc et le gris sont permis)').toBe(0);
  });

  test('composer : ← → change le haut, ↑ ↓ le bas, V la veste, en boucle', async ({ page }) => {
    await mockMirror(page, mirrorPayload());
    await page.goto('/');
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    const firstKey = await shownKey(page);
    const top = await shownPiece(page, 'haut');
    const bottom = await shownPiece(page, 'bas');

    // Haut suivant : le bas ne bouge pas ; puis retour.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('mirror-outfit')).not.toHaveAttribute('data-outfit-key', firstKey);
    expect(await shownPiece(page, 'haut')).not.toBe(top);
    expect(await shownPiece(page, 'bas')).toBe(bottom);
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('mirror-outfit')).toHaveAttribute('data-outfit-key', firstKey);

    // Bas suivant : le haut ne bouge pas ; puis retour.
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('mirror-outfit')).not.toHaveAttribute('data-outfit-key', firstKey);
    expect(await shownPiece(page, 'haut')).toBe(top);
    expect(await shownPiece(page, 'bas')).not.toBe(bottom);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('mirror-outfit')).toHaveAttribute('data-outfit-key', firstKey);

    // Veste : ajoutée (temps doux : pas de veste au départ), puis retirée.
    expect(await shownPiece(page, 'veste')).toBeUndefined();
    await page.keyboard.press('v');
    await expect(page.getByTestId('mirror-outfit')).not.toHaveAttribute('data-outfit-key', firstKey);
    expect(await shownPiece(page, 'veste')).toBeDefined();
    await page.keyboard.press('v');
    await expect(page.getByTestId('mirror-outfit')).toHaveAttribute('data-outfit-key', firstKey);

    // Trois hauts : trois fois « suivant » ramène au premier.
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('mirror-outfit')).toHaveAttribute('data-outfit-key', firstKey);
  });

  test('sans veste propre : pas de « veste » dans la légende, et la touche veste dit pourquoi elle ne fait rien', async ({
    page,
  }, testInfo) => {
    await mockMirror(page, mirrorPayload({ items: WARDROBE.filter((piece) => piece.category !== 'veste') }));
    await page.goto('/');
    const outfit = page.getByTestId('mirror-outfit');
    await expect(outfit).toBeVisible();
    const key = await shownKey(page);
    const controls = page.getByTestId('mirror-controls');
    await expect(page.getByTestId('mirror-controls-jacket')).toHaveCount(0);
    const legend = await controls.innerText();

    // Une phrase en 32 px, graisse 400, sur la ligne d'état ; la tenue et la légende du bas restent.
    const position = page.getByTestId('mirror-position');
    await page.keyboard.press('v');
    await expect(position).toHaveText('Aucune veste propre');
    await expect(position).toHaveCSS('font-size', '32px');
    await expect(position).toHaveCSS('font-weight', '400');
    expect(await shownKey(page)).toBe(key);
    expect(await controls.innerText()).toBe(legend);
    await page.screenshot({ path: capturePath(testInfo, 'miroir-touche-sans-effet') });
    // Effacée au bout de 1,5 s…
    await expect(position).toHaveText('', { timeout: 3_000 });
    // … ou par la touche suivante.
    await page.keyboard.press('v');
    await expect(position).toHaveText('Aucune veste propre');
    await page.keyboard.press('ArrowRight');
    await expect(position).toHaveText('');
    await expect(outfit).not.toHaveAttribute('data-outfit-key', key);
  });

  test('avec une robe, ↑ ↓ dit « Une robe se porte sans bas »', async ({ page }) => {
    const dress: MirrorItem = { ...WARDROBE[0], id: '0a000000-0000-4000-8000-000000000051', category: 'robe', name: 'Robe noire' };
    await mockMirror(page, mirrorPayload({ items: [dress, WARDROBE[6]] }));
    await page.goto('/');
    await expect(page.getByTestId('mirror-outfit')).toHaveAttribute('data-item-ids', dress.id);
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('mirror-position')).toHaveText('Une robe se porte sans bas');
    await expect(page.getByTestId('mirror-outfit')).toHaveAttribute('data-item-ids', dress.id);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('mirror-position')).toHaveText('Une seule robe propre');
  });

  test('← → sous une veste : seule « Sous la veste : … » change, et s’éclaire une seconde', async ({
    page,
  }, testInfo) => {
    // Deux hauts portés de la même photo et une veste portée : sous la veste, la silhouette ne
    // change pas quand le haut change.
    const [top, bottom] = ASSEMBLED_WARDROBE;
    const otherTop: MirrorItem = { ...top, id: '0a000000-0000-4000-8000-000000000027', name: 'Pull rouge bis' };
    const jacket: MirrorItem = { ...top, id: '0a000000-0000-4000-8000-000000000028', category: 'veste', name: 'Veste rouge' };
    await mockMirror(page, mirrorPayload({ items: [top, otherTop, bottom, jacket] }));
    await page.goto('/');
    const outfit = page.getByTestId('mirror-outfit');
    const canvas = page.getByTestId('mirror-silhouette');
    await expect(outfit).toHaveAttribute('data-display', 'silhouette');
    await expect(page.getByTestId('mirror-controls-jacket')).toBeVisible();
    // Temps doux : pas de veste au départ, donc pas de note.
    expect(await outfit.getAttribute('data-item-ids')).not.toContain(jacket.id);
    await expect(page.getByTestId('mirror-note')).toHaveCount(0);
    const stage = await canvas.boundingBox();

    await page.keyboard.press('v');
    const note = page.getByTestId('mirror-note');
    await expect(note).toContainText('Sous la veste : ');
    await expect(outfit).toHaveAttribute('data-display', 'silhouette');
    // Avec la note, la silhouette garde sa place et sa taille : les yeux restent au même point.
    expect(await canvas.boundingBox()).toEqual(stage);
    await expect(note).toHaveCSS('color', 'rgb(204, 204, 204)');
    const before = await note.innerText();

    await page.keyboard.press('ArrowRight');
    await expect(note).not.toHaveText(before);
    await expect(note).toHaveCSS('color', 'rgb(255, 255, 255)');
    await page.screenshot({ path: capturePath(testInfo, 'miroir-sous-la-veste') });
    await expect(outfit).toHaveAttribute('data-display', 'silhouette');
    expect(await canvas.boundingBox()).toEqual(stage);
    // Une seconde plus tard, elle revient au gris clair, sans transition.
    await expect(note).toHaveCSS('color', 'rgb(204, 204, 204)', { timeout: 3_000 });
    await expect(note).toHaveCSS('transition-duration', '0s');
  });

  test('deux « non » rapprochés (moins de 300 ms) n’écartent qu’une tenue', async ({ page }) => {
    const posted = await mockMirror(page, mirrorPayload());
    await page.goto('/');
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expect.poll(() => posted.refuser.length).toBe(1);
    await page.waitForTimeout(500);
    expect(posted.refuser).toHaveLength(1);
    // Au-delà de 300 ms, un nouveau « non » compte.
    await page.keyboard.press('Backspace');
    await expect.poll(() => posted.refuser.length).toBe(2);
  });

  test('Entrée : « Bonne journée » sous la tenue, POST accepter, puis « Choisie »', async ({ page, context }, testInfo) => {
    const payload = mirrorPayload();
    await mockMirror(page, payload);
    await page.goto('/');
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    const firstKey = await shownKey(page);
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('mirror-outfit')).not.toHaveAttribute('data-outfit-key', firstKey);
    const key = await shownKey(page);
    const ids = await shownItemIds(page);
    const title = await page.getByTestId('mirror-outfit').getAttribute('data-title');
    const pieces = await page.getByTestId('mirror-pieces').boundingBox();

    const request = page.waitForRequest(isPost(ACCEPT_API));
    await page.keyboard.press('Enter');
    const message = page.getByTestId('mirror-message');
    await expect(message).toHaveText('Bonne journée');
    expect((await request).postDataJSON()).toEqual({ date: payload.targetDate, item_ids: ids, title, target: 'history' });
    // La tenue reste à sa place, le message prend celle de sa légende ; les commandes restent.
    await expect(page.getByTestId('mirror-outfit')).toHaveAttribute('data-outfit-key', key);
    expect(await page.getByTestId('mirror-pieces').boundingBox()).toEqual(pieces);
    await expect(page.getByTestId('mirror-title')).toHaveCount(0);
    await expect(page.getByTestId('mirror-controls')).toBeVisible();
    const screenshot = await page.screenshot({ path: capturePath(testInfo, 'miroir-bonne-journee') });
    const scale = testInfo.project.use.deviceScaleFactor ?? 1;
    const lit = await analyse(context, screenshot, await contentBoxes(page), scale);
    expect(lit.litOutside, 'pixels allumés hors du texte, des pièces et des icônes').toBe(0);

    // Après 3 s, la légende revient : la tenue validée est « Choisie ». Une autre ne l'est pas.
    await expect(message).toHaveCount(0, { timeout: 6_000 });
    await expect(page.getByTestId('mirror-position')).toHaveText('Choisie');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('mirror-position')).toHaveText('');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('mirror-position')).toHaveText('Choisie');
  });

  test('Retour arrière : POST refuser (ce que montre la silhouette), bas suivant, puis « Écartée »', async ({
    page,
  }, testInfo) => {
    // Jour de pluie : la tenue a une veste, qui cache le haut.
    const tomorrow = nextDay(isoDateIn(new Date()));
    await mockMirror(page, mirrorPayload({ isTomorrow: true, targetDate: tomorrow, weather: rainyWeather(tomorrow) }));
    await page.goto('/');
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    const refusedKey = await shownKey(page);
    const ids = await shownItemIds(page);
    const of = (category: string) => ids.find((id) => categoryOf(id) === category);
    const dress = of('robe');
    const drawn = (dress ? [dress] : [of('veste') ?? of('haut'), of('bas')]).filter(Boolean).sort();
    expect(of('veste')).toBeDefined();

    const controls = page.getByTestId('mirror-controls');
    const legend = await controls.boundingBox();
    const request = page.waitForRequest(isPost(REFUSE_API));
    await page.keyboard.press('Backspace');
    expect((await request).postDataJSON()).toEqual({ item_ids: drawn });
    await expect(page.getByTestId('mirror-outfit')).not.toHaveAttribute('data-outfit-key', refusedKey);
    await expect(page.getByTestId('mirror-position')).toHaveText('');
    // Un « non » ne change souvent qu'un vêtement : « écartée » prend la place du poing et de
    // « non » dans la légende 1,5 s, sans que la ligne bouge.
    const refusedWord = page.getByTestId('mirror-controls-refused');
    await expect(refusedWord).toBeVisible();
    await expect(controls.getByText('non', { exact: true })).toBeHidden();
    await expect(refusedWord.locator('xpath=..').locator('svg').first()).toBeHidden();
    expect(await controls.boundingBox()).toEqual(legend);
    // Le mot tient dans la place du poing et de « non » : rien ne sort de la zone utile (40 à
    // 760 px), V de la veste compris.
    const refusedText = await refusedWord.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, width: rect.width };
    });
    const refusedGroup = (await refusedWord.locator('xpath=..').boundingBox())!;
    expect(refusedText.x).toBeGreaterThanOrEqual(refusedGroup.x);
    expect(refusedText.x + refusedText.width).toBeLessThanOrEqual(refusedGroup.x + refusedGroup.width);
    expect(refusedText.x + refusedText.width).toBeLessThanOrEqual(760);
    await page.screenshot({ path: capturePath(testInfo, 'miroir-ecartee') });
    await expect(refusedWord).toBeHidden({ timeout: 3_000 });
    await expect(controls.getByText('non', { exact: true })).toBeVisible();

    // La veste cache le haut : « non » est passé au bas suivant. En revenant dessus, la
    // combinaison reste visible, marquée « Écartée ».
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('mirror-outfit')).toHaveAttribute('data-outfit-key', refusedKey);
    await expect(page.getByTestId('mirror-position')).toHaveText('Écartée');
  });

  test('Recommencer : deux appuis, POST recommencer, retour au point de départ', async ({ page }, testInfo) => {
    const payload = mirrorPayload();
    const posted = await mockMirror(page, payload);
    await page.goto('/');
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    const firstKey = await shownKey(page);

    const refusal = page.waitForRequest(isPost(REFUSE_API));
    await page.keyboard.press('Backspace');
    const refused = (await refusal).postDataJSON() as { item_ids: string[] };
    await expect(page.getByTestId('mirror-outfit')).not.toHaveAttribute('data-outfit-key', firstKey);
    await page.keyboard.press('ArrowUp');

    // Pendant la confirmation, « oui » n'accepte pas la tenue cachée : il annule seulement.
    await page.keyboard.press('l');
    await expect(page.getByTestId('mirror-message')).toHaveText('Appuie encore pour recommencer');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    expect(posted.accepter).toEqual([]);

    // Premier appui : rien n'est effacé, on demande confirmation.
    await page.keyboard.press('l');
    await expect(page.getByTestId('mirror-message')).toHaveText('Appuie encore pour recommencer');
    await page.screenshot({ path: capturePath(testInfo, 'miroir-recommencer') });
    expect(posted.recommencer).toEqual([]);

    const request = page.waitForRequest(isPost(RESTART_API));
    await page.keyboard.press('l');
    await expect(page.getByTestId('mirror-message')).toHaveText('On recommence');
    expect((await request).postDataJSON()).toEqual({
      date: payload.targetDate,
      today: payload.today,
      refused: [[...refused.item_ids].sort()],
    });
    // Pendant « On recommence », la tenue reste cachée ; elle revient au bout de 1,5 s (pas 3).
    await expect(page.getByTestId('mirror-outfit')).toHaveCount(0);
    await expect(page.getByTestId('mirror-controls')).toHaveCount(0);

    await expect(page.getByTestId('mirror-outfit')).toBeVisible({ timeout: 2_500 });
    await expect(page.getByTestId('mirror-outfit')).toHaveAttribute('data-outfit-key', firstKey);
    await expect(page.getByTestId('mirror-position')).toHaveText('');
    await expect.poll(() => posted.recommencer.length).toBe(1);
  });

  test('keyMap vide : la composition, sans test des touches ; les touches de PC servent', async ({ page }) => {
    // Plus de manette : une tablette neuve ne doit jamais rester bloquée sur le test des touches.
    await page.clock.install();
    const posted = await mockMirror(page, mirrorPayload({ keyMap: {} }));
    await page.goto('/');
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    await expect(page.getByTestId('mirror-key-test')).toHaveCount(0);
    const firstKey = await shownKey(page);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('mirror-outfit')).not.toHaveAttribute('data-outfit-key', firstKey);
    // Le sondage de 30 s ne l'ouvre pas non plus.
    const polled = page.waitForRequest((request) => request.method() === 'GET' && KEYS_API.test(request.url()));
    await page.clock.fastForward(VERSION_POLL_MS);
    await polled;
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    await expect(page.getByTestId('mirror-key-test')).toHaveCount(0);
    expect(posted.touches).toEqual([]);
  });

  test('?touches=test : test des 8 touches guidé, POST touches, puis la composition', async ({ page }, testInfo) => {
    const posted = await mockMirror(page, mirrorPayload({ keyMap: {} }));
    await page.goto('/?touches=test');

    const screen = page.getByTestId('mirror-key-test');
    await expect(screen).toBeVisible();
    await expect(screen).toContainText('Appuie sur la touche pour :');
    const action = page.getByTestId('key-test-action');
    await expect(action).toHaveText('Haut suivant');
    // ?touches=test quitte l'adresse dès l'ouverture : un rechargement de la page ne le rouvre pas.
    expect(new URL(page.url()).search).toBe('');
    // « Haut » désigne le vêtement : la touche conseillée lève l'ambiguïté avec la croix.
    const hint = page.getByTestId('key-test-hint');
    await expect(hint).toHaveText('Conseillé : flèche droite →');
    // La consigne, lue de loin, ne bouge pas quand la liste des touches choisies s'allonge.
    const actionTop = (await action.boundingBox())?.y;

    // Ce que reçoit l'app, en mots : la lettre seule, pas « KeyD · d ».
    await page.keyboard.press('d');
    await expect(hint).toHaveText('Conseillé : flèche gauche ←');
    await expect(page.getByTestId('key-test-received')).toHaveText('Reçu : D');
    await expect(action).toHaveText('Haut précédent');
    await expect(page.getByTestId('key-test-bindings')).toHaveText(/^Haut suivant\s*D$/);
    expect((await action.boundingBox())?.y).toBe(actionTop);
    await page.screenshot({ path: capturePath(testInfo, 'miroir-test-touches') });

    // Une touche de modification seule ne compte pas ; une touche déjà prise est refusée.
    await page.keyboard.press('Shift');
    await expect(page.getByTestId('key-test-received')).toHaveText('Reçu : Maj');
    await expect(action).toHaveText('Haut précédent');
    await page.keyboard.press('d');
    await expect(page.getByTestId('key-test-error')).toHaveText('Cette touche sert déjà à passer au haut suivant.');
    await expect(action).toHaveText('Haut précédent');

    // Les touches conseillées sont celles d'un clavier de PC (plus de manette : ni A ni B).
    const steps: Array<[string, string, string?]> = [
      ['a', 'Bas suivant'],
      ['w', 'Bas précédent'],
      ['s', 'Veste suivante', 'Conseillé : V'],
      ['x', 'Accepter', 'Conseillé : Entrée'],
      ['j', 'Refuser', 'Conseillé : Retour arrière'],
      ['k', 'Recommencer', 'Conseillé : R'],
    ];
    for (const [key, next, advice] of steps) {
      await page.keyboard.press(key);
      await expect(action).toHaveText(next);
      if (advice) await expect(hint).toHaveText(advice);
    }
    // Sept touches choisies, en mots : la consigne n'a toujours pas bougé.
    await expect(page.getByTestId('key-test-bindings').locator('dd')).toHaveText(['D', 'A', 'W', 'S', 'X', 'J', 'K']);
    expect((await action.boundingBox())?.y).toBe(actionTop);

    const request = page.waitForRequest(isPost(KEYS_API));
    await page.keyboard.press('l');
    expect((await request).postDataJSON()).toEqual({
      keyMap: {
        next: { code: 'KeyD', key: 'd' },
        previous: { code: 'KeyA', key: 'a' },
        bottomNext: { code: 'KeyW', key: 'w' },
        bottomPrevious: { code: 'KeyS', key: 's' },
        jacket: { code: 'KeyX', key: 'x' },
        accept: { code: 'KeyJ', key: 'j' },
        refuse: { code: 'KeyK', key: 'k' },
        restart: { code: 'KeyL', key: 'l' },
      },
    });
    await expect(page.getByTestId('mirror-message')).toHaveText('Touches enregistrées');
    await expect.poll(() => posted.touches.length).toBe(1);
    // ?touches=test a quitté l'adresse dès l'ouverture : un rechargement de la page (écran de
    // secours) ne rouvre pas le test.
    expect(new URL(page.url()).search).toBe('');

    // « Oui » tout de suite après : la tenue n'a pas encore été vue, la touche efface seulement le message.
    await page.keyboard.press('j');
    await expect(page.getByTestId('mirror-message')).toHaveCount(0);
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    await page.waitForTimeout(300);
    expect(posted.accepter).toEqual([]);

    // Retour à la composition, avec les nouvelles touches.
    await expect(page.getByTestId('mirror-outfit')).toBeVisible({ timeout: 6_000 });
    const firstKey = await shownKey(page);
    await page.keyboard.press('w');
    await expect(page.getByTestId('mirror-outfit')).not.toHaveAttribute('data-outfit-key', firstKey);
  });

  test('veille après 2 min sans touche ; la touche qui réveille ne fait rien d’autre', async ({
    page,
  }, testInfo) => {
    // Un matin fixe, à Paris (heure d'hiver) ; les données sont celles de ce jour-là.
    const morning = new Date('2026-10-26T08:00:00+01:00');
    await page.clock.install({ time: morning });
    const posted = await mockMirror(page, mirrorPayload({}, morning));
    await page.goto('/');

    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    const firstKey = await shownKey(page);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('mirror-outfit')).not.toHaveAttribute('data-outfit-key', firstKey);
    const secondKey = await shownKey(page);

    await page.clock.fastForward('02:01'); // SLEEP_AFTER_MS (2 min) + 1 s
    const clock = page.getByTestId('mirror-sleep');
    await expect(clock).toBeVisible();
    await expect(clock).toHaveText(/^\d{2}:\d{2}$/);
    await expect(page.getByTestId('mirror-outfit')).toHaveCount(0);
    await expect(page.getByTestId('mirror-date')).toHaveCount(0);
    await page.screenshot({ path: capturePath(testInfo, 'miroir-veille') });

    // Réveil par Entrée : même tenue, aucune action, aucun envoi.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    await expect(page.getByTestId('mirror-outfit')).toHaveAttribute('data-outfit-key', secondKey);
    await expect(page.getByTestId('mirror-message')).toHaveCount(0);
    expect(posted.accepter).toEqual([]);

    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('mirror-outfit')).not.toHaveAttribute('data-outfit-key', secondKey);
  });

  test('le soir, mode demain : « Demain », météo de demain, puis « Prête pour demain »', async ({
    page,
  }, testInfo) => {
    const tomorrow = nextDay(isoDateIn(new Date()));
    await mockMirror(page, mirrorPayload({ isTomorrow: true, targetDate: tomorrow, weather: rainyWeather(tomorrow) }));
    await page.goto('/');

    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    await expect(page.getByTestId('mirror-tomorrow')).toHaveText('Demain ·');
    // Après « Demain · », la date commence en minuscule (dayLabel ignore la casse).
    await expect(page.getByTestId('mirror-date')).toHaveText(dayLabel(tomorrow));
    await expect(page.getByTestId('mirror-weather')).toHaveText('Pluie · 9° à 13°');
    expect(await backgrounds(page)).toEqual(BLACK);
    await page.screenshot({ path: capturePath(testInfo, 'miroir-demain') });

    const ids = await shownItemIds(page);
    const request = page.waitForRequest(isPost(ACCEPT_API));
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('mirror-message')).toHaveText('Prête pour demain');
    expect((await request).postDataJSON()).toMatchObject({ date: tomorrow, item_ids: ids, target: 'plan' });
    // La tenue reste affichée sous le message, avec les commandes ; ensuite, « Prévue ».
    expect(await shownItemIds(page)).toEqual(ids);
    await expect(page.getByTestId('mirror-controls')).toBeVisible();
    await expect(page.getByTestId('mirror-message')).toHaveCount(0, { timeout: 6_000 });
    await expect(page.getByTestId('mirror-position')).toHaveText('Prévue');
  });

  test('silhouette pas encore prête : l’ancienne reste, pâlit, et « oui » / « non » attendent', async ({
    page,
  }, testInfo) => {
    // Deux hauts portés : le second arrive lentement (premier défilement après le réveil, photos
    // retéléchargées). La tenue prévue (le premier haut) est le point de départ.
    const [top, bottom] = ASSEMBLED_WARDROBE;
    const slowTop: MirrorItem = {
      ...top,
      id: '0a000000-0000-4000-8000-000000000025',
      name: 'Pull rouge bis',
      cutout_path: 'e2e/assemblage/E2E_HAUT_LENT.png',
      cutout_url: `${ASSEMBLY_PATH}E2E_HAUT_LENT.png`,
    };
    await page.clock.install();
    const base = mirrorPayload();
    const posted = await mockMirror(
      page,
      mirrorPayload({
        items: [top, slowTop, bottom],
        plan: { date: base.targetDate, item_ids: [top.id, bottom.id], confirmed: true },
      }),
    );
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    const body = assemblyImages()['E2E_HAUT.png'];
    await page.route(`**${ASSEMBLY_PATH}E2E_HAUT_LENT.png`, async (route) => {
      await released;
      await route.fulfill({ status: 200, contentType: 'image/png', body });
    });

    const slowRequest = page.waitForRequest((request) => request.url().includes('E2E_HAUT_LENT'));
    await page.goto('/');
    await slowRequest;
    // La voisine ne vient pas : le préchargement abandonne au bout de 8 s, la tenue s'affiche.
    await page.clock.fastForward(PRELOAD_TIMEOUT_MS + 100);
    const outfit = page.getByTestId('mirror-outfit');
    const canvas = page.getByTestId('mirror-silhouette');
    await expect(outfit).toHaveAttribute('data-display', 'silhouette');
    expect(await shownItemIds(page)).toContain(top.id);
    await expect(page.getByTestId('mirror-position')).toHaveText('Prévue');

    // Haut suivant : la légende change tout de suite, l'ancienne silhouette reste à l'écran.
    await page.keyboard.press('ArrowRight');
    await expect(outfit).toHaveAttribute('data-display', 'pending');
    expect(await shownItemIds(page)).toContain(slowTop.id);
    await expect(page.getByTestId('mirror-title')).toContainText('Pull rouge bis');
    await expect(canvas).toBeVisible();
    // Au-delà de 300 ms, elle pâlit (sans transition) jusqu'à l'arrivée de la nouvelle.
    await page.clock.fastForward(400);
    await expect(canvas).toHaveCSS('opacity', String(SILHOUETTE_DIM_OPACITY));
    await expect(canvas).toHaveCSS('transition-duration', '0s');
    await page.screenshot({ path: capturePath(testInfo, 'miroir-silhouette-attente') });

    // « Non » et « oui » ne font rien : on n'écarte ni ne choisit une tenue qu'on n'a pas vue.
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    expect(posted.refuser).toEqual([]);
    expect(posted.accepter).toEqual([]);
    await expect(page.getByTestId('mirror-message')).toHaveCount(0);
    expect(await shownItemIds(page)).toContain(slowTop.id);

    // La photo arrive : la nouvelle silhouette remplace l'ancienne, à pleine lumière.
    release();
    await expect(outfit).toHaveAttribute('data-display', 'silhouette');
    await expect(canvas).toHaveCSS('opacity', '1');
    const refusal = page.waitForRequest(isPost(REFUSE_API));
    await page.keyboard.press('Backspace');
    expect(((await refusal).postDataJSON() as { item_ids: string[] }).item_ids).toContain(slowTop.id);
  });

  test('une pièce mise au sale sur le téléphone : le miroir relit ses données en 30 s au plus', async ({ page }) => {
    await page.clock.install();
    // Le jour visé de l'heure qu'il est (le soir : demain) : pas de relecture pour un changement de jour.
    const day = targetDay(new Date(), 'Europe/Paris', 18);
    await mockMirror(page, { ...mirrorPayload(day), version: 'v1-avant' } as MirrorPayload);
    await page.goto('/');
    const outfit = page.getByTestId('mirror-outfit');
    await expect(outfit).toBeVisible();
    const top = await shownPiece(page, 'haut');
    const bottom = await shownPiece(page, 'bas');
    expect(bottom).toBeDefined();

    // Sur le téléphone, le bas affiché passe au sale : l'empreinte de /touches change.
    const changed = {
      ...mirrorPayload({ ...day, items: WARDROBE.filter((item) => item.id !== bottom) }),
      version: 'v1-apres',
    };
    let reads = 0;
    await page.route(API, (route) => {
      reads += 1;
      return route.fulfill({ status: 200, json: changed, headers: { 'Cache-Control': 'no-store' } });
    });
    await page.route(KEYS_API, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 200, json: { ok: true } })
        : route.fulfill({ status: 200, json: { version: 'v1-apres' } }),
    );
    await page.clock.fastForward(VERSION_POLL_MS);
    await expect.poll(() => reads).toBe(1);
    // Rien de nouveau à l'écran : seul le bas change, le haut affiché reste.
    await expect.poll(() => shownPiece(page, 'bas')).not.toBe(bottom);
    expect(await shownPiece(page, 'haut')).toBe(top);
    await expect(page.getByTestId('mirror-message')).toHaveCount(0);

    // Même empreinte au sondage suivant : pas de nouvelle lecture.
    await page.clock.fastForward(VERSION_POLL_MS);
    await page.waitForTimeout(300);
    expect(reads).toBe(1);
  });

  test('sans météo ni réseau : « Météo indisponible » en petit, « · hors ligne », puis rien au retour', async ({
    page,
  }, testInfo) => {
    // Pire cas de largeur : « Demain · mercredi 30 septembre · hors ligne » sur 720 px.
    await page.clock.install();
    await mockMirror(page, mirrorPayload({ isTomorrow: true, targetDate: '2026-09-30', weather: null }));
    await page.goto('/');
    const outfit = page.getByTestId('mirror-outfit');
    await expect(outfit).toBeVisible();
    const weather = page.getByTestId('mirror-weather');
    await expect(weather).toHaveText('Météo indisponible');
    await expect(weather).toHaveCSS('font-size', '32px');
    // La boîte garde la hauteur de la météo (60 px) : la silhouette ne bouge pas.
    expect((await weather.boundingBox())?.height).toBe(60);
    const outfitTop = (await outfit.boundingBox())?.y;
    await expect(page.getByTestId('mirror-offline')).toHaveCount(0);

    // Coupure du Wi-Fi : la vérification de 30 s échoue, ainsi que les relectures.
    await page.route(API, (route) => route.abort('internetdisconnected'));
    await page.route(KEYS_API, (route) => route.abort('internetdisconnected'));
    await page.clock.fastForward(VERSION_POLL_MS);
    const offline = page.getByTestId('mirror-offline');
    await expect(offline).toHaveText('· hors ligne');
    await expect(offline).toHaveCSS('font-size', '32px');
    // Une seule ligne de 48 px, sans rien pousser : la date passe en 32 px pendant la coupure.
    const day = page.getByTestId('mirror-day');
    expect((await day.boundingBox())?.height).toBe(48);
    expect((await outfit.boundingBox())?.y).toBe(outfitTop);
    await expect(page.getByTestId('mirror-tomorrow')).toHaveText('Demain ·');
    await page.screenshot({ path: capturePath(testInfo, 'miroir-hors-ligne') });

    // Retour du réseau : à la première réponse, « hors ligne » s'en va.
    await page.unroute(API);
    await page.unroute(KEYS_API);
    await page.route(API, (route) =>
      route.fulfill({
        status: 200,
        json: mirrorPayload({ isTomorrow: true, targetDate: '2026-09-30', weather: null }),
        headers: { 'Cache-Control': 'no-store' },
      }),
    );
    await page.route(KEYS_API, (route) => route.fulfill({ status: 200, json: {} }));
    await page.clock.fastForward(VERSION_POLL_MS);
    await expect(offline).toHaveCount(0);
    await expect(day).toHaveCSS('font-size', '40px');
  });

  test('test des touches laissé en plan : veille après 2 min, une touche le reprend où il en était', async ({
    page,
  }) => {
    await page.clock.install();
    const posted = await mockMirror(page, mirrorPayload({ keyMap: {} }));
    await page.goto('/?touches=test');
    const action = page.getByTestId('key-test-action');
    await expect(action).toHaveText('Haut suivant');
    await page.keyboard.press('d');
    await expect(action).toHaveText('Haut précédent');

    // Le test des touches s'endort 2 min après son ouverture, comme les autres écrans.
    await page.clock.fastForward('02:01');
    await expect(page.getByTestId('mirror-sleep')).toHaveText(/^\d{2}:\d{2}$/);
    await expect(page.getByTestId('mirror-key-test')).toHaveCount(0);

    // La touche qui réveille n'est pas enregistrée : le test reprend à la même étape.
    await page.keyboard.press('a');
    await expect(action).toHaveText('Haut précédent');
    await expect(page.getByTestId('key-test-received')).toHaveText('Reçu : D');
    await page.keyboard.press('a');
    await expect(action).toHaveText('Bas suivant');
    expect(posted.touches).toEqual([]);

    // Un rechargement de la page (écran de secours) ne le rouvre pas. Rien n'a été enregistré. (Une
    // tablette sans clavier laissée sur le test en sort à la relecture de 18 h, minuit ou 4 h, en
    // veille : lib/mirror/state.test.ts.)
    expect(new URL(page.url()).search).toBe('');
    await page.reload();
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    await expect(page.getByTestId('mirror-key-test')).toHaveCount(0);
    expect(posted.touches).toEqual([]);
  });

  test('l’affichage plante : écran de secours noir, rechargement seul au bout de 30 s, ou à la première touche', async ({
    page,
    context,
  }, testInfo) => {
    // Une date illisible dans la réponse fait planter l'affichage (aucun déclencheur dans l'app).
    await page.clock.install();
    await mockMirror(page, { ...mirrorPayload(), targetDate: 'pas-une-date' });
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });
    await page.goto('/');
    const line = page.getByText("Souci d'affichage, nouvel essai dans un instant");
    await expect(line).toBeVisible();
    await expect(page.locator('main[data-screen="mirror"]')).toBeAttached();
    expect(await backgrounds(page)).toEqual(BLACK);
    await expect(page.getByRole('button')).toHaveCount(0);
    const screenshot = await page.screenshot({ path: capturePath(testInfo, 'miroir-secours') });
    const scale = testInfo.project.use.deviceScaleFactor ?? 1;
    const pixels = await analyse(context, screenshot, await contentBoxes(page), scale);
    expect(pixels.litOutside, 'pixels allumés hors de la ligne').toBe(0);
    expect(pixels.coloured, 'seulement du gris').toBe(0);

    // Personne ne peut toucher l'écran : il se recharge seul, et compte ses essais.
    await page.clock.fastForward(30_000);
    await expect.poll(() => loads).toBe(2);
    await expect(line).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('mon-dressing:miroir:rechargements'))).toBe('1');
    // Deuxième essai au bout de 2 min ; une touche recharge tout de suite.
    await page.keyboard.press('Enter');
    await expect.poll(() => loads).toBe(3);
  });

  test('écran de problème : veille après 2 min, le nouvel essai continue, une touche réaffiche le message', async ({
    page,
  }) => {
    await page.clock.install();
    await mockMirror(page, null, 401);
    let reads = 0;
    page.on('request', (request) => {
      if (API.test(request.url())) reads += 1;
    });
    await page.goto('/');
    const status = page.getByTestId('mirror-status');
    await expect(status).toHaveText('Tablette non connectée');

    await page.clock.fastForward('02:01');
    await expect(page.getByTestId('mirror-sleep')).toHaveText(/^\d{2}:\d{2}$/);
    await expect(status).toHaveCount(0);
    expect(await backgrounds(page)).toEqual(BLACK);
    await expect.poll(() => reads).toBeGreaterThan(1);

    await page.keyboard.press('Enter');
    await expect(status).toBeVisible();
  });

  test.describe('écran tactile', () => {
    test.use({ hasTouch: true });

    test('« Tablette non connectée » en veille : un toucher, là où sera le lien, réaffiche l’écran sans rien ouvrir', async ({
      page,
    }) => {
      // Avant de monter la tablette, personne n'est encore devant la caméra : le doigt suffit.
      await page.clock.install();
      await mockMirror(page, null, 401);
      await page.goto('/');
      const status = page.getByTestId('mirror-status');
      const link = page.getByRole('link', { name: 'Se connecter' });
      await expect(status).toHaveText('Tablette non connectée');
      const box = (await link.boundingBox())!;
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

      await page.clock.fastForward('02:01');
      await expect(page.getByTestId('mirror-sleep')).toBeVisible();
      await expect(status).toHaveCount(0);

      await page.touchscreen.tap(center.x, center.y);
      await expect(status).toBeVisible();
      await expect(link).toBeVisible();
      await page.waitForTimeout(500);
      expect(new URL(page.url()).pathname).toBe('/');

      // Écran éveillé, le même toucher ouvre la connexion, qui ramènera au miroir.
      await page.touchscreen.tap(center.x, center.y);
      await expect.poll(() => new URL(page.url()).pathname).toBe('/connexion');
      expect(new URL(page.url()).searchParams.get('depuis')).toBe('miroir');
    });
  });

  test('l’affichage plante sans réseau : rien ne se recharge tant que le serveur ne répond pas', async ({
    page,
    context,
  }) => {
    // Recharger sans réseau allumerait la page d'erreur du navigateur derrière la vitre.
    await page.clock.install();
    await mockMirror(page, { ...mirrorPayload(), targetDate: 'pas-une-date' });
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });
    await page.route('**/api/health', (route) => route.abort('internetdisconnected'));
    await page.goto('/');
    const line = page.getByText("Souci d'affichage, nouvel essai dans un instant");
    await expect(line).toBeVisible();

    // Au bout de 30 s, le serveur ne répond pas : pas de rechargement, la ligne reste.
    await page.clock.fastForward(30_000);
    await page.waitForTimeout(500);
    expect(loads).toBe(1);
    await expect(line).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('mon-dressing:miroir:rechargements'))).toBeNull();

    // Wi-Fi coupé : une touche ne recharge pas non plus.
    await context.setOffline(true);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    expect(loads).toBe(1);
    await expect(line).toBeVisible();

    // Retour du réseau : le serveur répond, la page se recharge d'elle-même.
    await page.unroute('**/api/health');
    await context.setOffline(false);
    await expect.poll(() => loads).toBe(2);
    await expect(line).toBeVisible();
  });

  test('écran de secours : veille après 2 min, rechargements en veille, une touche réaffiche la ligne', async ({
    page,
  }, testInfo) => {
    // La panne se répète à chaque rechargement (date illisible) : la nuit, la ligne ne reste pas allumée.
    await page.clock.install();
    await mockMirror(page, { ...mirrorPayload(), targetDate: 'pas-une-date' });
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });
    let checks = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/api/health')) checks += 1;
    });
    // D'abord sans réponse du serveur : aucun rechargement pendant ces 2 min.
    await page.route('**/api/health', (route) => route.abort('internetdisconnected'));
    await page.goto('/');
    const line = page.getByText("Souci d'affichage, nouvel essai dans un instant");
    const clock = page.getByTestId('mirror-sleep');
    await expect(line).toBeVisible();

    // Le premier essai (30 s) échoue ; à 2 min, la veille : l'heure seule, sur fond noir.
    await page.clock.fastForward('02:01');
    await expect.poll(() => checks).toBe(1);
    await expect(clock).toHaveText(/^\d{2}:\d{2}$/);
    await expect(line).toHaveCount(0);
    expect(await backgrounds(page)).toEqual(BLACK);
    await page.screenshot({ path: capturePath(testInfo, 'miroir-secours-veille') });

    // La touche qui réveille réaffiche la ligne, sans rien faire d'autre (pas de nouvel essai).
    await page.keyboard.press('Enter');
    await expect(line).toBeVisible();
    await expect(clock).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(checks).toBe(1);
    // Écran éveillé, une touche tente un rechargement (sans réponse ici : rien ne se recharge).
    await page.keyboard.press('Enter');
    await expect.poll(() => checks).toBe(2);
    expect(loads).toBe(1);

    // 2 min plus tard, l'écran se rendort et le deuxième essai échoue encore. Puis le serveur
    // répond : le troisième essai, 10 min après, recharge la page en veille ; la panne revient, et
    // l'écran repart directement en veille.
    await page.clock.fastForward('02:01');
    await expect(clock).toBeVisible();
    await expect.poll(() => checks).toBe(3);
    await page.waitForTimeout(500); // Le troisième essai se programme après la réponse ratée.
    await page.unroute('**/api/health');
    await page.clock.fastForward('10:30');
    await expect.poll(() => loads).toBe(2);
    await expect(clock).toHaveText(/^\d{2}:\d{2}$/);
    await expect(line).toHaveCount(0);
    expect(await backgrounds(page)).toEqual(BLACK);

    // Une touche réaffiche la ligne, une autre recharge tout de suite.
    await page.keyboard.press('Enter');
    await expect(line).toBeVisible();
    await page.keyboard.press('Enter');
    await expect.poll(() => loads).toBe(3);
    await expect(line).toBeVisible();
  });

  test('le téléphone ne peut plus ouvrir le test des touches : un ancien key_test_requested est ignoré', async ({
    page,
  }) => {
    await page.clock.install();
    await mockMirror(page, mirrorPayload({ keyTestRequested: true } as Partial<MirrorPayload>));
    await page.goto('/');
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    await page.route(KEYS_API, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 200, json: { ok: true } })
        : route.fulfill({ status: 200, json: { keyTestRequested: true } }),
    );
    await page.clock.fastForward(VERSION_POLL_MS);
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    await expect(page.getByTestId('mirror-key-test')).toHaveCount(0);
  });

  test('défilement rapide pendant l’attente : l’ancienne silhouette reste pâle, sans se rallumer', async ({ page }) => {
    const [top, bottom] = ASSEMBLED_WARDROBE;
    const slowTop = (n: number): MirrorItem => ({
      ...top,
      id: `0a000000-0000-4000-8000-00000000003${n}`,
      name: `Pull lent ${n}`,
      cutout_path: `e2e/assemblage/E2E_HAUT_LENT_${n}.png`,
      cutout_url: `${ASSEMBLY_PATH}E2E_HAUT_LENT_${n}.png`,
    });
    await page.clock.install();
    const base = mirrorPayload();
    await mockMirror(
      page,
      mirrorPayload({
        items: [top, slowTop(1), slowTop(2), bottom],
        plan: { date: base.targetDate, item_ids: [top.id, bottom.id], confirmed: true },
      }),
    );
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    const body = assemblyImages()['E2E_HAUT.png'];
    await page.route(`**${ASSEMBLY_PATH}E2E_HAUT_LENT_*`, async (route) => {
      await released;
      await route.fulfill({ status: 200, contentType: 'image/png', body });
    });

    const slowRequest = page.waitForRequest((request) => request.url().includes('E2E_HAUT_LENT_'));
    await page.goto('/');
    await slowRequest;
    await page.clock.fastForward(PRELOAD_TIMEOUT_MS + 100);
    const outfit = page.getByTestId('mirror-outfit');
    const canvas = page.getByTestId('mirror-silhouette');
    await expect(outfit).toHaveAttribute('data-display', 'silhouette');

    await page.keyboard.press('ArrowRight');
    await expect(outfit).toHaveAttribute('data-display', 'pending');
    await page.clock.fastForward(400);
    await expect(canvas).toHaveCSS('opacity', String(SILHOUETTE_DIM_OPACITY));
    const waiting = (await outfit.getAttribute('data-item-ids')) ?? '';

    // Deuxième appui pendant l'attente : la légende change, l'ancienne silhouette reste pâle (lu
    // dès le rendu de la nouvelle légende, avant les 300 ms qui la rallumaient).
    await page.keyboard.press('ArrowRight');
    const opacity = await page.evaluate(async (before) => {
      const section = document.querySelector('[data-testid="mirror-outfit"]');
      while (section && section.getAttribute('data-item-ids') === before) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const shown = document.querySelector('[data-testid="mirror-silhouette"]');
      return shown ? getComputedStyle(shown).opacity : 'absente';
    }, waiting);
    expect(opacity).toBe(String(SILHOUETTE_DIM_OPACITY));
    await expect(outfit).toHaveAttribute('data-display', 'pending');
    await page.clock.fastForward(400);
    await expect(canvas).toHaveCSS('opacity', String(SILHOUETTE_DIM_OPACITY));

    release();
    await expect(outfit).toHaveAttribute('data-display', 'silhouette');
    await expect(canvas).toHaveCSS('opacity', '1');
  });

  test('après des pièces empilées, une silhouette pas encore prête : les pièces restent, pâlissent, puis la silhouette', async ({
    page,
  }, testInfo) => {
    // Départ : un haut porté et un bas sans photo portée (pièces empilées). Le bas suivant est
    // porté, mais sa photo arrive lentement : aucune silhouette d'avant à garder.
    const [top, bottom] = ASSEMBLED_WARDROBE;
    const flatBottom = WARDROBE.find((piece) => piece.category === 'bas')!;
    const slowBottom: MirrorItem = {
      ...bottom,
      id: '0a000000-0000-4000-8000-000000000041',
      name: 'Jupe jaune bis',
      cutout_path: 'e2e/assemblage/E2E_BAS_LENT.png',
      cutout_url: `${ASSEMBLY_PATH}E2E_BAS_LENT.png`,
    };
    await page.clock.install();
    const base = mirrorPayload();
    const posted = await mockMirror(
      page,
      mirrorPayload({
        items: [top, flatBottom, slowBottom],
        plan: { date: base.targetDate, item_ids: [top.id, flatBottom.id], confirmed: true },
      }),
    );
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    const body = assemblyImages()['E2E_BAS.png'];
    await page.route(`**${ASSEMBLY_PATH}E2E_BAS_LENT.png`, async (route) => {
      await released;
      await route.fulfill({ status: 200, contentType: 'image/png', body });
    });

    const slowRequest = page.waitForRequest((request) => request.url().includes('E2E_BAS_LENT'));
    await page.goto('/');
    await slowRequest;
    await page.clock.fastForward(PRELOAD_TIMEOUT_MS + 100);
    const outfit = page.getByTestId('mirror-outfit');
    const pieces = page.getByTestId('mirror-pieces');
    await expect(outfit).toHaveAttribute('data-display', 'pieces');
    const startKey = await shownKey(page);

    // Bas suivant : la légende change tout de suite, les pièces d'avant restent à leur place.
    await page.keyboard.press('ArrowUp');
    await expect(outfit).toHaveAttribute('data-display', 'pending');
    expect(await shownItemIds(page)).toContain(slowBottom.id);
    await expect(pieces).toHaveAttribute('data-pieces-key', startKey);
    await expect(outfit.locator(`[data-item-id="${flatBottom.id}"] img`)).toBeVisible();
    await page.clock.fastForward(400);
    await expect(pieces).toHaveCSS('opacity', String(SILHOUETTE_DIM_OPACITY));
    await expect(pieces).toHaveCSS('transition-duration', '0s');
    expect(await backgrounds(page)).toEqual(BLACK);
    await page.screenshot({ path: capturePath(testInfo, 'miroir-pieces-attente') });

    // « Non » et « oui » attendent la silhouette.
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    expect(posted.refuser).toEqual([]);
    expect(posted.accepter).toEqual([]);

    release();
    await expect(outfit).toHaveAttribute('data-display', 'silhouette');
    await expect(pieces).toHaveCount(0);
    await expect(page.getByTestId('mirror-silhouette')).toHaveCSS('opacity', '1');
  });

  test('après « On recommence », un point de départ pas encore dessiné : la dernière silhouette reste, pas de trou noir', async ({
    page,
  }) => {
    // Avant : la tenue prévue (le premier haut). « Recommencer » efface ce choix ; le premier haut,
    // porté hier, passe derrière le second, dont la photo arrive lentement.
    const [top, bottom] = ASSEMBLED_WARDROBE;
    const slowTop: MirrorItem = {
      ...top,
      id: '0a000000-0000-4000-8000-000000000051',
      name: 'Pull rouge ter',
      cutout_path: 'e2e/assemblage/E2E_HAUT_RECOMMENCER.png',
      cutout_url: `${ASSEMBLY_PATH}E2E_HAUT_RECOMMENCER.png`,
    };
    await page.clock.install();
    const base = mirrorPayload();
    const yesterday = new Date(Date.parse(`${base.today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const posted = await mockMirror(
      page,
      mirrorPayload({
        items: [top, slowTop, bottom],
        plan: { date: base.targetDate, item_ids: [top.id, bottom.id], confirmed: true },
        history: [{ date: yesterday, item_ids: [top.id, bottom.id], title: 'Pull rouge et jupe jaune' }],
      }),
    );
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    const body = assemblyImages()['E2E_HAUT.png'];
    await page.route(`**${ASSEMBLY_PATH}E2E_HAUT_RECOMMENCER.png`, async (route) => {
      await released;
      await route.fulfill({ status: 200, contentType: 'image/png', body });
    });

    const slowRequest = page.waitForRequest((request) => request.url().includes('E2E_HAUT_RECOMMENCER'));
    await page.goto('/');
    await slowRequest;
    await page.clock.fastForward(PRELOAD_TIMEOUT_MS + 100);
    const outfit = page.getByTestId('mirror-outfit');
    const canvas = page.getByTestId('mirror-silhouette');
    await expect(outfit).toHaveAttribute('data-display', 'silhouette');
    expect(await shownItemIds(page)).toContain(top.id);

    await page.keyboard.press('l');
    await expect(page.getByTestId('mirror-message')).toHaveText('Appuie encore pour recommencer');
    await page.keyboard.press('l');
    await expect(page.getByTestId('mirror-message')).toHaveText('On recommence');
    await expect.poll(() => posted.recommencer.length).toBe(1);

    // Une flèche aussitôt efface le message : la tenue cachée revient, son point de départ n'est
    // pas encore dessiné. L'ancienne silhouette reste à sa place, au lieu d'un écran noir.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('mirror-message')).toHaveCount(0);
    expect(await shownItemIds(page)).toContain(slowTop.id);
    await expect(outfit).toHaveAttribute('data-display', 'pending');
    await expect(canvas).toBeVisible();

    // « Oui » et « non » attendent toujours la nouvelle silhouette.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);
    expect(posted.accepter).toEqual([]);
    expect(posted.refuser).toEqual([]);

    release();
    await expect(outfit).toHaveAttribute('data-display', 'silhouette');
    await expect(canvas).toHaveCSS('opacity', '1');
  });

  test('une tenue remise sur le téléphone (refus effacé) : le miroir relit ses données, pas après ses propres « non »', async ({
    page,
  }) => {
    await page.clock.install();
    const day = targetDay(new Date(), 'Europe/Paris', 18);
    const [first, second] = WARDROBE.filter((item) => item.category === 'haut');
    const pants = WARDROBE.find((item) => item.category === 'bas')!;
    const refusals = [{ item_ids: [first.id, pants.id].sort() }, { item_ids: [second.id, pants.id].sort() }];
    await mockMirror(page, { ...mirrorPayload({ ...day, refusals }), version: 'v2-meme' } as MirrorPayload);
    await page.goto('/');
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();

    // « Remettre » sur le téléphone : le serveur compte un refus de moins, l'empreinte ne bouge pas.
    let reads = 0;
    const after = { ...mirrorPayload({ ...day, refusals: refusals.slice(1) }), version: 'v2-meme' };
    await page.route(API, (route) => {
      reads += 1;
      return route.fulfill({ status: 200, json: after, headers: { 'Cache-Control': 'no-store' } });
    });
    let count = 1;
    await page.route(KEYS_API, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 200, json: { ok: true } })
        : route.fulfill({ status: 200, json: { version: 'v2-meme', refusals: count } }),
    );
    await page.clock.fastForward(VERSION_POLL_MS);
    await expect.poll(() => reads).toBe(1);

    // Un « non » sur le miroir : le serveur en compte un de plus, comme la tablette ; pas de relecture.
    const refusal = page.waitForRequest(isPost(REFUSE_API));
    await page.keyboard.press('Backspace');
    await refusal;
    count = 2;
    await page.clock.fastForward(VERSION_POLL_MS);
    await page.waitForTimeout(300);
    expect(reads).toBe(1);
  });

  test('« oui » pour demain sur le miroir : pas de relecture pour ce choix, mais une autre tenue prévue relit', async ({
    page,
  }) => {
    const evening = new Date('2026-10-26T19:00:00+01:00');
    await page.clock.install({ time: evening });
    const payload = mirrorPayload({ isTomorrow: true }, evening);
    const version = mirrorVersion({
      items: [],
      plan: null,
      profile: { city: 'Paris', lat: 48.8566, lon: 2.3522, timezone: 'Europe/Paris', evening_hour: 18 },
    });
    await mockMirror(page, { ...payload, version } as MirrorPayload);
    await page.goto('/');
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    let reads = 0;
    await page.route(API, (route) => {
      reads += 1;
      return route.fulfill({ status: 200, json: { ...payload, version }, headers: { 'Cache-Control': 'no-store' } });
    });

    const ids = await shownItemIds(page);
    const accepted = page.waitForRequest(isPost(ACCEPT_API));
    await page.keyboard.press('Enter');
    await accepted;
    await expect(page.getByTestId('mirror-message')).toHaveText('Prête pour demain');
    // Le serveur a la tenue : son empreinte est celle que la tablette a prévue.
    let polled = withPlanVersion(version, { date: payload.targetDate, item_ids: ids });
    await page.route(KEYS_API, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 200, json: { ok: true } })
        : route.fulfill({ status: 200, json: { version: polled } }),
    );
    await page.clock.fastForward(VERSION_POLL_MS);
    await page.waitForTimeout(300);
    expect(reads).toBe(0);

    // Une autre tenue gardée sur le téléphone : l'empreinte change, le miroir relit.
    polled = withPlanVersion(version, { date: payload.targetDate, item_ids: ids.slice(1) });
    await page.clock.fastForward(VERSION_POLL_MS);
    await expect.poll(() => reads).toBe(1);
  });
});

// --- Gestes caméra (projet « camera » : Chromium et sa fausse caméra) ----------------------------
// La fausse caméra de Chromium filme une mire (fond vert, motif qui tourne) : personne devant,
// donc aucun geste. Aucune vidéo personnelle n'entre dans les tests. MediaPipe tourne pour de vrai,
// moteur et modèles servis par l'app ; sans GPU dans Chromium de test, le délégué peut être le CPU.
// Un refus et une caméra occupée ne s'obtiennent pas avec la fausse caméra : getUserMedia est
// remplacé avant le chargement de la page.

/** getUserMedia répond par cette erreur (DOMException), avant tout script de la page. */
async function cameraFails(page: Page, name: string) {
  await page.addInitScript((errorName) => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('simulé', errorName));
  }, name);
}

/** Les flux ouverts par la page, gardés pour vérifier qu'elle les rend. */
async function recordStreams(page: Page) {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const opened: MediaStream[] = [];
    Object.assign(window, { openedStreams: opened });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      opened.push(stream);
      return stream;
    };
  });
}

/** Les flux ouverts : pistes vidéo et audio, et s'ils tournent encore. */
function streamsOf(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { openedStreams: MediaStream[] }).openedStreams.map((stream) => ({
      video: stream.getVideoTracks().length,
      audio: stream.getAudioTracks().length,
      live: stream.getTracks().some((track) => track.readyState === 'live'),
    })),
  );
}

/** Simule la page cachée ou montrée (écran éteint, autre appli devant). */
async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((visibility) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/** Le moteur des gestes peut mettre du temps à démarrer dans Chromium de test (CPU, sans GPU). */
const ENGINE_TIMEOUT_MS = 90_000;

test.describe('miroir, gestes caméra', { tag: '@camera' }, () => {
  // Une seule instance de MediaPipe à la fois : les tests de ce groupe passent l'un après l'autre.
  test.describe.configure({ mode: 'default', timeout: 150_000 });

  test('fausse caméra : le miroir s’affiche, et la mire ne déclenche rien', async ({ page }, testInfo) => {
    await recordStreams(page);
    const posted = await mockMirror(page, mirrorPayload());
    await page.goto('/');
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    const main = page.locator('main');
    await expect(main).toHaveAttribute('data-camera', 'running', { timeout: ENGINE_TIMEOUT_MS });
    // La caméra frontale, sans son ; son image n'est jamais dans la page.
    expect(await streamsOf(page)).toEqual([{ video: 1, audio: 0, live: true }]);
    await expect(page.locator('video')).toHaveCount(0);

    // Quelques secondes de mire : personne, aucun geste, rien d'envoyé.
    const key = await shownKey(page);
    await page.waitForTimeout(4_000);
    expect(await shownKey(page)).toBe(key);
    await expect(page.getByTestId('mirror-hold-ring')).toHaveCount(0);
    await expect(page.getByTestId('mirror-position')).toHaveText('');
    await expect(page.getByTestId('mirror-camera')).toHaveCount(0);
    await expect(page.getByTestId('mirror-gestures-debug')).toHaveCount(0);
    expect(posted.accepter).toEqual([]);
    expect(posted.refuser).toEqual([]);
    await page.screenshot({ path: capturePath(testInfo, 'miroir-camera') });

    // Le clavier marche toujours.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('mirror-outfit')).not.toHaveAttribute('data-outfit-key', key);
  });

  test('?gestures=debug : délégué, images/s, présence, sur noir ; jamais l’image de la caméra', async ({
    page,
    context,
  }, testInfo) => {
    await recordStreams(page);
    // Aucune tenue : rien de coloré à l'écran. Un seul pixel coloré viendrait de la mire (verte).
    await mockMirror(page, mirrorPayload({ items: [] }));
    await page.goto('/?gestures=debug');
    await expect(page.getByTestId('mirror-empty')).toBeVisible();
    const camera = page.getByTestId('debug-camera');
    await expect(camera).toHaveText(/^(GPU|CPU) · \d+ im\/s · gestes 0 im\/s$/, { timeout: ENGINE_TIMEOUT_MS });
    // Personne devant la mire : PoseLandmarker au ralenti (5 images/s), pas de Gesture Recognizer.
    const fps = async () => Number(/· (\d+) im\/s/.exec(await camera.innerText())?.[1] ?? -1);
    await expect.poll(fps, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    expect(await fps()).toBeLessThanOrEqual(6);
    await expect(page.getByTestId('debug-presence')).toHaveText('Personne');
    await expect(page.getByTestId('debug-recognized')).toHaveText('Aucune main reconnue');
    await expect(page.getByTestId('debug-action')).toHaveText('Dernier geste : —');
    // Le cadre de l'image analysée, sans zones ni mains (personne), et jamais l'image elle-même.
    await expect(page.getByTestId('mirror-gestures-zones')).toBeVisible();
    await expect(page.locator('[data-zone], [data-hand]')).toHaveCount(0);
    // Aucun trait du cadre ne traverse le texte du debug.
    const frameBox = (await page.getByTestId('debug-frame').boundingBox())!;
    for (const text of await page.getByTestId('mirror-gestures-debug').locator('p').all()) {
      const box = (await text.boundingBox())!;
      expect(overlaps(box, frameBox), await text.innerText()).toBe(false);
    }
    await expect(page.locator('video')).toHaveCount(0);
    await expect(page.locator('main canvas')).toHaveCount(0);

    const screenshot = await page.screenshot({ path: capturePath(testInfo, 'miroir-gestes-debug') });
    const scale = testInfo.project.use.deviceScaleFactor ?? 1;
    const pixels = await analyse(context, screenshot, await contentBoxes(page), scale);
    expect(pixels.lit, 'le texte du debug est allumé').toBeGreaterThan(0);
    expect(pixels.coloured, 'seulement du blanc et du gris : aucune image de la caméra').toBe(0);

    // Page cachée : la caméra est rendue ; au retour, reprise.
    await setVisibility(page, 'hidden');
    await expect(page.locator('main')).toHaveAttribute('data-camera', 'paused');
    await expect(camera).toHaveText('Caméra rendue (page cachée)');
    expect(await streamsOf(page)).toEqual([{ video: 1, audio: 0, live: false }]);
    await setVisibility(page, 'visible');
    await expect(page.locator('main')).toHaveAttribute('data-camera', 'running', { timeout: 30_000 });
    expect(await streamsOf(page)).toEqual([
      { video: 1, audio: 0, live: false },
      { video: 1, audio: 0, live: true },
    ]);
    await expect.poll(fps, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  });

  test('caméra refusée : « Caméra refusée : gestes coupés. » sous l’en-tête, et le clavier marche', async ({
    page,
    context,
  }, testInfo) => {
    await cameraFails(page, 'NotAllowedError');
    const posted = await mockMirror(page, mirrorPayload({ items: ASSEMBLED_WARDROBE }));
    await page.goto('/');
    await expect(page.getByTestId('mirror-silhouette')).toBeVisible();
    const line = page.getByTestId('mirror-camera');
    await expect(line).toHaveText(CAMERA_LINES.denied);
    await expect(page.locator('main')).toHaveAttribute('data-camera', 'denied');
    // Une seule petite ligne grise, juste sous la météo, centrée, sans rien déplacer.
    await expect(line).toHaveCSS('font-size', '32px');
    await expect(line).toHaveCSS('color', 'rgb(204, 204, 204)');
    const weather = (await page.getByTestId('mirror-weather').boundingBox())!;
    const box = (await line.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(weather.y + weather.height);
    expect(box.height).toBeLessThanOrEqual(40);
    expect(box.width).toBeLessThanOrEqual(720);
    expect(Math.abs(box.x + box.width / 2 - 400)).toBeLessThanOrEqual(2);
    // Tout entière au-dessus de la toile de la silhouette : elle ne touche jamais la tête, même une
    // tête tout en haut de la scène. La silhouette n'a pas bougé (156 px d'en-tête, 16 de marge).
    const silhouette = (await page.getByTestId('mirror-silhouette').boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(silhouette.y);
    expect(silhouette.y).toBe(172);
    expect(silhouette.height).toBe(812);

    const screenshot = await page.screenshot({ path: capturePath(testInfo, 'miroir-camera-refusee') });
    const scale = testInfo.project.use.deviceScaleFactor ?? 1;
    const pixels = await analyse(context, screenshot, await contentBoxes(page), scale);
    expect(pixels.litOutside, 'pixels allumés hors du texte, de la silhouette et des icônes').toBe(0);

    // Le clavier marche toujours.
    const accepted = page.waitForRequest(isPost(ACCEPT_API));
    await page.keyboard.press('Enter');
    await accepted;
    await expect(page.getByTestId('mirror-message')).toHaveText('Bonne journée');
    expect(posted.accepter).toHaveLength(1);
  });

  test('caméra occupée par une autre appli : sa ligne, puis un nouvel essai au bout de 30 s', async ({
    page,
  }, testInfo) => {
    await page.clock.install();
    // Premier essai : la caméra est prise (visio, assistant vocal…) ; ensuite, elle est libre.
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      let calls = 0;
      navigator.mediaDevices.getUserMedia = (constraints) => {
        calls += 1;
        Object.assign(window, { cameraCalls: calls });
        return calls === 1
          ? Promise.reject(new DOMException('Could not start video source', 'NotReadableError'))
          : original(constraints);
      };
    });
    await mockMirror(page, mirrorPayload());
    await page.goto('/');
    await expect(page.getByTestId('mirror-outfit')).toBeVisible();
    const line = page.getByTestId('mirror-camera');
    await expect(line).toHaveText(CAMERA_LINES.busy);
    await page.screenshot({ path: capturePath(testInfo, 'miroir-camera-occupee') });
    // Le clavier marche toujours.
    const key = await shownKey(page);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('mirror-outfit')).not.toHaveAttribute('data-outfit-key', key);

    const calls = () => page.evaluate(() => (window as unknown as { cameraCalls: number }).cameraCalls);
    await page.clock.fastForward(CAMERA_RETRY_MS - 1_000);
    expect(await calls()).toBe(1);
    await expect(line).toHaveText(CAMERA_LINES.busy);
    await page.clock.fastForward(1_000);
    // L'autre appli l'a rendue : la ligne s'en va.
    await expect(line).toHaveCount(0);
    expect(await calls()).toBe(2);
  });

  test('vidéo figée alors que la caméra « tourne » : rouverte, puis « Gestes indisponibles… », puis elle repart', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await recordStreams(page);
    // La vidéo de la caméra peut être figée à la demande (window.freezeVideo) : son currentTime ne
    // bouge plus, comme une piste muette ou une vidéo hors de la page mise en pause par le navigateur.
    await page.addInitScript(() => {
      const real = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
      const frozen = new WeakMap<HTMLMediaElement, number>();
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
        configurable: true,
        get(this: HTMLMediaElement) {
          const now = real.get!.call(this) as number;
          if (!(window as unknown as { freezeVideo?: boolean }).freezeVideo) {
            frozen.delete(this);
            return now;
          }
          if (!frozen.has(this)) frozen.set(this, now);
          return frozen.get(this)!;
        },
        set(this: HTMLMediaElement, value: number) {
          real.set!.call(this, value);
        },
      });
    });
    const freeze = (on: boolean) => page.evaluate((value) => Object.assign(window, { freezeVideo: value }), on);
    await mockMirror(page, mirrorPayload());
    await page.goto('/');
    const main = page.locator('main');
    await expect(main).toHaveAttribute('data-camera', 'running', { timeout: ENGINE_TIMEOUT_MS });
    expect(await streamsOf(page)).toEqual([{ video: 1, audio: 0, live: true }]);

    // Figée : au bout de 5 s, la caméra est rendue et rouverte (sans ligne).
    await freeze(true);
    await expect.poll(async () => (await streamsOf(page)).length, { timeout: CAMERA_STALL_MS + 10_000 }).toBe(2);
    expect((await streamsOf(page))[0].live).toBe(false);
    const line = page.getByTestId('mirror-camera');
    await expect(line).toHaveCount(0);

    // Toujours figée : au troisième blocage de suite, la ligne du miroir le dit ; caméra rendue.
    await expect(line).toHaveText(CAMERA_LINES.failed, { timeout: 3 * CAMERA_STALL_MS + 15_000 });
    await expect(main).toHaveAttribute('data-camera', 'failed');
    expect((await streamsOf(page)).every((stream) => !stream.live)).toBe(true);

    // La vidéo repart : nouvel essai 30 s plus tard, la ligne s'en va.
    await freeze(false);
    await expect(main).toHaveAttribute('data-camera', 'running', { timeout: CAMERA_RETRY_MS + 30_000 });
    await expect(line).toHaveCount(0);
    expect((await streamsOf(page)).at(-1)!.live).toBe(true);
  });

  test('?gestures=debug, caméra refusée : le debug ne répète pas la ligne du miroir par-dessus', async ({
    page,
  }, testInfo) => {
    await cameraFails(page, 'NotAllowedError');
    await mockMirror(page, mirrorPayload({ items: ASSEMBLED_WARDROBE }));
    await page.goto('/?gestures=debug');
    await expect(page.getByTestId('mirror-silhouette')).toBeVisible();
    const line = page.getByTestId('mirror-camera');
    await expect(line).toHaveText(CAMERA_LINES.denied);
    await expect(page.getByTestId('mirror-gestures-debug')).toBeAttached();
    // Le miroir le dit déjà : pas de « Caméra refusée » du debug posé dessus.
    await expect(page.getByTestId('debug-camera')).toHaveCount(0);
    const lineBox = (await line.boundingBox())!;
    for (const text of await page.getByTestId('mirror-gestures-debug').locator('p').all()) {
      const box = await text.boundingBox();
      if (box) expect(overlaps(box, lineBox)).toBe(false);
    }
    await page.screenshot({ path: capturePath(testInfo, 'miroir-gestes-debug-refusee') });
  });

  test('moteur des gestes en panne : « Gestes indisponibles… », et les nouveaux essais n’allument plus la caméra', async ({
    page,
    context,
  }, testInfo) => {
    // Trois chargements du moteur (GPU puis CPU à chaque fois) dans Chromium de test.
    test.setTimeout(300_000);
    await page.clock.install();
    // Les modèles manquent (déploiement raté, par exemple) : le moteur ne se charge ni sur le GPU
    // ni sur le CPU.
    let modelRequests = 0;
    await page.route('**/mediapipe/models/**', (route) => {
      modelRequests += 1;
      return route.fulfill({ status: 404, body: '' });
    });
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      const opened: MediaStream[] = [];
      Object.assign(window, { openedStreams: opened, cameraCalls: 0 });
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        Object.assign(window, { cameraCalls: opened.length + 1 });
        const stream = await original(constraints);
        opened.push(stream);
        return stream;
      };
    });
    await mockMirror(page, mirrorPayload({ items: ASSEMBLED_WARDROBE }));
    await page.goto('/');
    await expect(page.getByTestId('mirror-silhouette')).toBeVisible();
    const line = page.getByTestId('mirror-camera');
    await expect(line).toHaveText(CAMERA_LINES.failed, { timeout: ENGINE_TIMEOUT_MS });
    await expect(page.locator('main')).toHaveAttribute('data-camera', 'failed');
    // La même petite ligne grise que refusée ou occupée, sur une ligne, au-dessus de la toile.
    await expect(line).toHaveCSS('font-size', '32px');
    await expect(line).toHaveCSS('color', 'rgb(204, 204, 204)');
    const box = (await line.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(40);
    expect(box.width).toBeLessThanOrEqual(720);
    expect(box.y + box.height).toBeLessThanOrEqual((await page.getByTestId('mirror-silhouette').boundingBox())!.y);
    const screenshot = await page.screenshot({ path: capturePath(testInfo, 'miroir-gestes-indisponibles') });
    const scale = testInfo.project.use.deviceScaleFactor ?? 1;
    const pixels = await analyse(context, screenshot, await contentBoxes(page), scale);
    expect(pixels.litOutside, 'pixels allumés hors du texte, de la silhouette et des icônes').toBe(0);

    // La caméra ouverte au premier essai est rendue.
    expect(await streamsOf(page)).toEqual([{ video: 1, audio: 0, live: false }]);
    const calls = () => page.evaluate(() => (window as unknown as { cameraCalls: number }).cameraCalls);
    const first = modelRequests;
    expect(first).toBeGreaterThan(0);

    // 30 s plus tard : le moteur se recharge d'abord ; toujours en panne, la caméra (et son témoin,
    // derrière la vitre) ne se rallume pas.
    await page.clock.fastForward(CAMERA_RETRY_MS);
    await expect.poll(() => modelRequests, { timeout: ENGINE_TIMEOUT_MS }).toBe(2 * first);
    await page.waitForTimeout(500);
    expect(await calls()).toBe(1);
    await expect(line).toHaveText(CAMERA_LINES.failed);

    // Ensuite les essais s'espacent, comme l'écran de secours : rien 30 s plus tard, le suivant au
    // bout de 2 min (puis toutes les 10 min).
    await page.clock.fastForward(CAMERA_RETRY_MS);
    await page.waitForTimeout(1_000);
    expect(modelRequests).toBe(2 * first);
    await page.clock.fastForward(2 * 60_000 - CAMERA_RETRY_MS);
    await expect.poll(() => modelRequests, { timeout: ENGINE_TIMEOUT_MS }).toBe(3 * first);
    await page.waitForTimeout(500);
    expect(await calls()).toBe(1);
  });
});
