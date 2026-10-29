import { hourInTimeZone, targetDay } from '@/lib/dates';
import type { DayWeather } from '@/lib/types';
import { weatherSummary } from '@/lib/weather/format';

// Délais du miroir (docs/conception.md §4, §5, §7 bis) et petits formats d'affichage. Fonctions pures.

/** Après 2 min sans touche, le miroir n'affiche plus que l'heure (docs/conception.md §4). */
export const SLEEP_AFTER_MS = 2 * 60_000;
/** Au réveil, les données plus vieilles que ça sont relues (URL signées d'1 h, nouvel historique). */
export const STALE_AFTER_MS = 10 * 60_000;
/** « Bonne journée », « Prête pour demain », « Touches enregistrées » (docs/conception.md §4, §6). */
export const MESSAGE_MS = 3_000;
/** « On recommence » : plus court, la tenue du départ revient vite (docs/conception.md §4). */
export const RESTART_DONE_MS = 1_500;
/**
 * Retours en texte, sans mouvement (docs/conception.md §4) : phrase d'une touche sans effet (« Une robe se
 * porte sans bas »), « Sous la veste : … » éclairée quand le haut caché change, « écartée » à la
 * place de « non » dans la légende après un refus.
 */
export const HINT_MS = 1_500;
export const NOTE_LIT_MS = 1_000;
export const REFUSED_FLASH_MS = 1_500;
/** Un second « non » moins de 300 ms après le premier est ignoré (double appui involontaire). */
export const REFUSE_REPEAT_MS = 300;

/** `lastAt` : Date.now() du dernier « non » pris en compte (ou -Infinity). */
export function isRepeatedRefusal(lastAt: number, now: number): boolean {
  return now - lastAt < REFUSE_REPEAT_MS;
}
/** La tablette relit l'empreinte de ses données toutes les 30 s (GET /api/miroir/touches, docs/conception.md §7 bis). */
export const VERSION_POLL_MS = 30_000;
/** Vérification du jour visé : passage de l'heure du soir, minuit, préchargement de 4 h. */
export const DAY_CHECK_MS = 60_000;
/**
 * Préchargement du matin (docs/conception.md §7 bis : « à 4 h ») : nouvelles URL signées (celles de minuit ont
 * expiré) et météo relue avant le réveil, dans le fuseau du profil.
 */
export const MORNING_RELOAD_HOUR = 4;
/** Attente maximale du préchargement des images avant d'afficher quand même. */
export const PRELOAD_TIMEOUT_MS = 8_000;
/**
 * Silhouette pas encore prête (photos en route) : l'ancienne reste affichée, puis pâlit au bout de
 * ce délai, jusqu'à l'arrivée de la nouvelle. Sans transition : un état fixe, pas une animation.
 */
export const SILHOUETTE_DIM_AFTER_MS = 300;
export const SILHOUETTE_DIM_OPACITY = 0.4;

/**
 * Écran de secours (app/error.tsx) : rechargement de la page au bout de 30 s, puis de 2 min, puis
 * toutes les 10 min. `attempt` : essais déjà faits depuis la dernière tenue affichée (rechargements,
 * ou essais sans réponse du serveur).
 */
export const ERROR_RELOAD_DELAYS_MS = [30_000, 2 * 60_000] as const;
export const ERROR_RELOAD_LATER_MS = 10 * 60_000;
/** Avant de recharger, l'écran de secours attend au plus ce délai la réponse de /api/health. */
export const ERROR_HEALTH_TIMEOUT_MS = 10_000;

export function errorReloadDelay(attempt: number): number {
  const index = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
  return ERROR_RELOAD_DELAYS_MS[index] ?? ERROR_RELOAD_LATER_MS;
}

export function isStale(loadedAt: number, now: number): boolean {
  return now - loadedAt > STALE_AFTER_MS;
}

/**
 * Change quand la date du jour ou le jour visé change, et à MORNING_RELOAD_HOUR : il faut alors
 * relire les données.
 */
export function dayKey(instant: Date, timeZone: string, eveningHour: number): string {
  const day = targetDay(instant, timeZone, eveningHour);
  return readDayKey(day.today, day.targetDate, instant, timeZone);
}

/**
 * Clé du jour de données lues : leurs `today` et `targetDate` (ceux du serveur), et la tranche nuit
 * ou matin au début de la lecture. Comparée chaque minute à dayKey(maintenant) : une lecture à
 * cheval sur l'heure du soir, minuit ou 4 h, ou un serveur en retard d'horloge, est relue.
 */
export function readDayKey(today: string, targetDate: string, startedAt: Date, timeZone: string): string {
  const morning = hourInTimeZone(startedAt, timeZone) >= MORNING_RELOAD_HOUR ? 'matin' : 'nuit';
  return `${today}>${targetDate}>${morning}`;
}

/**
 * Heure de veille (docs/conception.md §4) : assez claire pour se lire de jour à travers le miroir, très sombre la
 * nuit pour ne pas éclairer la chambre. Valeurs à régler derrière le vrai miroir.
 */
export const SLEEP_CLOCK_DAY_COLOR = '#6a6a6a';
export const SLEEP_CLOCK_NIGHT_COLOR = '#3a3a3a';
/** Le jour va de 7 h (compris) à 22 h (exclu), dans le fuseau du profil. */
export const SLEEP_CLOCK_DAY_FROM = 7;
export const SLEEP_CLOCK_DAY_UNTIL = 22;

export function sleepClockColor(instant: Date, timeZone: string): string {
  const hour = hourInTimeZone(instant, timeZone);
  return hour >= SLEEP_CLOCK_DAY_FROM && hour < SLEEP_CLOCK_DAY_UNTIL ? SLEEP_CLOCK_DAY_COLOR : SLEEP_CLOCK_NIGHT_COLOR;
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** « 07:42 » dans le fuseau donné. */
export function formatClock(instant: Date, timeZone: string): string {
  let formatter = clockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('fr-FR', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    clockFormatters.set(timeZone, formatter);
  }
  return formatter.format(instant);
}

/** « Pluie · 9° à 14° », comme sur le téléphone (lib/weather/format.ts). */
export function formatWeather(weather: DayWeather): string {
  return weatherSummary(weather);
}
