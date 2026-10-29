import type { AssemblyPhoto, Category, DayWeather, KeyMap, MirrorItem, MirrorPayload } from '../../lib/types';
import { paintedPng, type PaintedRect, type Rgb } from './png';

// Données simulées de GET /api/miroir pour les tests du miroir. Aucune vraie donnée : pièces
// inventées, images générées (png.ts) et servies par page.route.

/** Chemin des détourages simulés, intercepté par page.route (jamais servi par l'app). */
export const CUTOUT_PATH = '/e2e-detourages/';

/** Jour du calendrier (AAAA-MM-JJ) dans le fuseau donné. */
export function isoDateIn(instant: Date, timeZone = 'Europe/Paris'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    instant,
  );
}

export function nextDay(isoDate: string): string {
  const ms = Date.parse(`${isoDate}T12:00:00Z`) + 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function item(n: number, category: Category, name: string, color: string, withCutout = true): MirrorItem {
  const id = `0a000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    id,
    name,
    category,
    color,
    warmth: 2,
    styles: ['decontracte'],
    rain_ok: true,
    dirty: false,
    photo_path: null,
    cutout_path: `e2e/${id}.png`,
    legacy_id: null,
    created_at: '2026-10-01T08:00:00Z',
    cutout_url: withCutout ? `${CUTOUT_PATH}${id}.png` : null,
  };
}

/** Une garde-robe qui donne au moins 5 tenues par temps doux, et une veste pour la pluie. */
export const WARDROBE: MirrorItem[] = [
  item(1, 'haut', 'Pull blanc', '#F2F2F2'),
  item(2, 'haut', 'Chemise bleu ciel', '#A9C8E8'),
  item(3, 'haut', 'Pull marine', '#1F2A44'),
  item(4, 'bas', 'Jean brut', '#2C3E50'),
  item(5, 'bas', 'Pantalon beige', '#C8B59A'),
  item(6, 'bas', 'Jupe grise', '#8C8C8C'),
  item(7, 'chaussures', 'Baskets blanches', '#F5F5F5'),
  item(8, 'chaussures', 'Bottines marron', '#6B4226', false),
  item(9, 'veste', 'Trench', '#B89B72'),
];

/** Pièces principales et veste : ce qu'enregistre un refus (docs/conception.md §6). */
export const CORE_CATEGORIES: readonly Category[] = ['haut', 'bas', 'robe', 'veste'];

export function categoryOf(id: string): Category | undefined {
  return WARDROBE.find((candidate) => candidate.id === id)?.category;
}

/** Correspondance de touches d'un clavier inhabituel, sans les touches de PC (qui servent donc aussi). */
export const GAMEPAD_KEYS: KeyMap = {
  next: { code: 'KeyD', key: 'd' },
  previous: { code: 'KeyA', key: 'a' },
  bottomNext: { code: 'KeyW', key: 'w' },
  bottomPrevious: { code: 'KeyS', key: 's' },
  jacket: { code: 'KeyX', key: 'x' },
  accept: { code: 'KeyJ', key: 'j' },
  refuse: { code: 'KeyK', key: 'k' },
  restart: { code: 'KeyL', key: 'l' },
};

export function mildWeather(date: string): DayWeather {
  return { date, tempMin: 12, tempMax: 19, temp: 17, code: 3, rain: false, label: 'Nuageux' };
}

export function rainyWeather(date: string): DayWeather {
  return { date, tempMin: 9, tempMax: 13, temp: 12, code: 61, rain: true, label: 'Pluie' };
}

/** Réponse de GET /api/miroir pour l'instant donné (aujourd'hui à Paris par défaut). */
export function mirrorPayload(overrides: Partial<MirrorPayload> = {}, instant = new Date()): MirrorPayload {
  const today = isoDateIn(instant);
  const isTomorrow = overrides.isTomorrow ?? false;
  const targetDate = overrides.targetDate ?? (isTomorrow ? nextDay(today) : today);
  return {
    today,
    targetDate,
    isTomorrow,
    timezone: 'Europe/Paris',
    eveningHour: 18,
    weather: mildWeather(targetDate),
    items: WARDROBE,
    history: [],
    refusals: [],
    plan: null,
    keyMap: GAMEPAD_KEYS,
    ...overrides,
  };
}

// --- Tenue assemblée (docs/conception.md §7) -----------------------------------------------------------------
// Deux fausses photos portées détourées, de couleurs franches, avec des repères connus :
// - photo du haut : tête, buste ROUGE jusqu'à 200 px sous les yeux, ventre, puis ses propres
//   jambes VERTES (qui ne doivent jamais apparaître) ;
// - photo du bas : tête, buste BLEU (qui ne doit jamais apparaître), jambes JAUNES ;
// - manches du haut : une bande MAGENTA sur le côté, sous l'ourlet.
// Coupe attendue : max(200, 190) + 6 = 206 px sous les yeux du haut (pas d'étirement : la
// ceinture du haut est à 240). Bas décalé de dx = 200 − 190 = 10, dy = 100 − 110 = −10.

/** Chemin des photos portées simulées, intercepté par page.route (jamais servi par l'app). */
export const ASSEMBLY_PATH = '/e2e-assemblage/';

export const ASSEMBLY_COLORS = {
  skin: [230, 190, 160],
  top: [210, 40, 40],
  upperLegs: [40, 170, 70],
  lowerTop: [40, 70, 210],
  legs: [230, 200, 40],
  sleeves: [200, 50, 200],
} as const satisfies Record<string, Rgb>;

const PHOTO_SIZE: [number, number] = [400, 640];

export const UPPER_PHOTO: AssemblyPhoto = {
  key: 'E2E_HAUT',
  size: PHOTO_SIZE,
  eye: [200, 100],
  centers: [
    [100, 200],
    [300, 200],
    [500, 200],
  ],
  topLow: 200,
  bottomHigh: 240,
  onePiece: false,
  tucked: false,
};

export const LOWER_PHOTO: AssemblyPhoto = {
  key: 'E2E_BAS',
  size: PHOTO_SIZE,
  eye: [190, 110],
  centers: [
    [100, 190],
    [300, 190],
    [500, 190],
  ],
  topLow: 190,
  bottomHigh: 185,
  onePiece: false,
  tucked: false,
};

const UPPER_RECTS: PaintedRect[] = [
  { x: 170, y: 40, width: 60, height: 110, rgb: ASSEMBLY_COLORS.skin }, // tête (yeux en 200, 100)
  { x: 120, y: 150, width: 160, height: 150, rgb: ASSEMBLY_COLORS.top }, // buste, jusqu'à 100 + 200
  { x: 130, y: 300, width: 140, height: 40, rgb: ASSEMBLY_COLORS.skin }, // ventre, jusqu'à la ceinture (100 + 240)
  { x: 140, y: 340, width: 120, height: 300, rgb: ASSEMBLY_COLORS.upperLegs },
];

const LOWER_RECTS: PaintedRect[] = [
  { x: 160, y: 50, width: 60, height: 110, rgb: ASSEMBLY_COLORS.skin }, // tête (yeux en 190, 110)
  { x: 110, y: 160, width: 160, height: 140, rgb: ASSEMBLY_COLORS.lowerTop }, // buste, jusqu'à 110 + 190
  { x: 130, y: 300, width: 120, height: 340, rgb: ASSEMBLY_COLORS.legs },
];

const SLEEVES_RECTS: PaintedRect[] = [{ x: 95, y: 280, width: 20, height: 140, rgb: ASSEMBLY_COLORS.sleeves }];

/** Les images servies sous ASSEMBLY_PATH, par nom de fichier. */
export function assemblyImages(): Record<string, Buffer> {
  return {
    'E2E_HAUT.png': paintedPng(PHOTO_SIZE[0], PHOTO_SIZE[1], UPPER_RECTS),
    'E2E_BAS.png': paintedPng(PHOTO_SIZE[0], PHOTO_SIZE[1], LOWER_RECTS),
    'manches-haut.png': paintedPng(PHOTO_SIZE[0], PHOTO_SIZE[1], SLEEVES_RECTS),
  };
}

/** Un haut et un bas photographiés portés (+ chaussures et accessoire, jamais proposés). */
export const ASSEMBLED_WARDROBE: MirrorItem[] = [
  {
    ...item(21, 'haut', 'Pull rouge', '#D22828'),
    cutout_path: 'e2e/assemblage/E2E_HAUT.png',
    cutout_url: `${ASSEMBLY_PATH}E2E_HAUT.png`,
    sleeves_url: `${ASSEMBLY_PATH}manches-haut.png`,
    assembly: { v: 1, photo: UPPER_PHOTO, sleevesPath: 'e2e/assemblage/manches-haut.png' },
  },
  {
    ...item(22, 'bas', 'Jupe jaune', '#E6C828'),
    cutout_path: 'e2e/assemblage/E2E_BAS.png',
    cutout_url: `${ASSEMBLY_PATH}E2E_BAS.png`,
    sleeves_url: null,
    assembly: { v: 1, photo: LOWER_PHOTO, sleevesPath: null },
  },
  item(23, 'chaussures', 'Baskets blanches', '#F5F5F5'),
  item(24, 'accessoire', 'Foulard', '#C8B59A'),
];
