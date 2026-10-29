import { describe, expect, it } from 'vitest';
import {
  HINT_MS,
  MESSAGE_MS,
  MORNING_RELOAD_HOUR,
  NOTE_LIT_MS,
  REFUSED_FLASH_MS,
  REFUSE_REPEAT_MS,
  RESTART_DONE_MS,
  SLEEP_AFTER_MS,
  SLEEP_CLOCK_DAY_COLOR,
  SLEEP_CLOCK_NIGHT_COLOR,
  STALE_AFTER_MS,
  dayKey,
  errorReloadDelay,
  formatClock,
  formatWeather,
  isRepeatedRefusal,
  isStale,
  readDayKey,
  sleepClockColor,
} from './timing';
import type { DayWeather } from '@/lib/types';

describe('délais', () => {
  it('veille au bout de 2 min, données périmées au bout de 10 min', () => {
    expect(SLEEP_AFTER_MS).toBe(120_000);
    expect(STALE_AFTER_MS).toBe(600_000);
    expect(isStale(0, STALE_AFTER_MS)).toBe(false);
    expect(isStale(0, STALE_AFTER_MS + 1)).toBe(true);
  });

  it('retours en texte : « On recommence » et phrases d’une touche 1,5 s, note éclairée 1 s', () => {
    expect(MESSAGE_MS).toBe(3_000);
    expect(RESTART_DONE_MS).toBe(1_500);
    expect(HINT_MS).toBe(1_500);
    expect(NOTE_LIT_MS).toBe(1_000);
    expect(REFUSED_FLASH_MS).toBe(1_500);
  });

  it('un second « non » dans les 300 ms est ignoré, pas au-delà', () => {
    expect(isRepeatedRefusal(Number.NEGATIVE_INFINITY, 0)).toBe(false);
    expect(isRepeatedRefusal(1_000, 1_000)).toBe(true);
    expect(isRepeatedRefusal(1_000, 1_299)).toBe(true);
    expect(isRepeatedRefusal(1_000, 1_000 + REFUSE_REPEAT_MS)).toBe(false);
  });

  it('écran de secours : rechargement après 30 s, puis 2 min, puis toutes les 10 min', () => {
    expect(errorReloadDelay(0)).toBe(30_000);
    expect(errorReloadDelay(1)).toBe(120_000);
    expect(errorReloadDelay(2)).toBe(600_000);
    expect(errorReloadDelay(40)).toBe(600_000);
    // Compteur illisible (stockage effacé ou abîmé) : on repart du premier délai.
    expect(errorReloadDelay(-1)).toBe(30_000);
    expect(errorReloadDelay(Number.NaN)).toBe(30_000);
    expect(errorReloadDelay(1.5)).toBe(30_000);
  });
});

describe('dayKey', () => {
  const zone = 'Europe/Paris';

  it('change au passage de l’heure du soir', () => {
    const before = dayKey(new Date('2026-10-24T15:59:00Z'), zone, 18); // 17:59 à Paris
    const after = dayKey(new Date('2026-10-24T16:00:00Z'), zone, 18); // 18:00 à Paris
    expect(before).toBe('2026-10-24>2026-10-24>matin');
    expect(after).toBe('2026-10-24>2026-10-25>matin');
  });

  it('change à minuit même si le jour visé reste le même', () => {
    const evening = dayKey(new Date('2026-10-24T21:59:00Z'), zone, 18); // 23:59
    const midnight = dayKey(new Date('2026-10-24T22:00:00Z'), zone, 18); // 00:00 le 25
    expect(evening).toBe('2026-10-24>2026-10-25>matin');
    expect(midnight).toBe('2026-10-25>2026-10-25>nuit');
    expect(evening).not.toBe(midnight);
  });

  it('change à 4 h, heure du préchargement du matin (docs/conception.md §7 bis), dans le fuseau donné', () => {
    expect(MORNING_RELOAD_HOUR).toBe(4);
    const night = dayKey(new Date('2026-10-27T02:59:00Z'), zone, 18); // 03:59 à Paris (heure d'hiver)
    const morning = dayKey(new Date('2026-10-27T03:00:00Z'), zone, 18); // 04:00 à Paris
    expect(night).not.toBe(morning);
    expect(morning).toBe('2026-10-27>2026-10-27>matin');
    // Ensuite, plus de changement jusqu'à l'heure du soir.
    expect(dayKey(new Date('2026-10-27T10:00:00Z'), zone, 18)).toBe(morning);
  });

  it('clé d’une lecture : le jour des données, la tranche au début de la lecture', () => {
    const at = new Date('2026-10-24T16:00:05Z'); // 18:00:05 à Paris
    // Le serveur a répondu « aujourd'hui » : la clé diffère de dayKey(maintenant), on relira.
    expect(readDayKey('2026-10-24', '2026-10-24', at, zone)).toBe('2026-10-24>2026-10-24>matin');
    expect(readDayKey('2026-10-24', '2026-10-24', at, zone)).not.toBe(dayKey(at, zone, 18));
    expect(readDayKey('2026-10-24', '2026-10-25', at, zone)).toBe(dayKey(at, zone, 18));
  });
});

describe('formats', () => {
  it('heure de la veille dans le fuseau', () => {
    expect(formatClock(new Date('2026-10-24T05:07:00Z'), 'Europe/Paris')).toBe('07:07');
  });

  it('météo « Pluie · 8° à 14° », comme le téléphone', () => {
    const weather: DayWeather = {
      date: '2026-10-24',
      tempMin: 8,
      tempMax: 14,
      temp: 12.4,
      code: 61,
      rain: true,
      label: 'Pluie',
    };
    expect(formatWeather(weather)).toBe('Pluie · 8° à 14°');
    expect(formatWeather({ ...weather, tempMin: -0.3, tempMax: 2, code: 71, label: 'Neige' })).toBe('Neige · 0° à 2°');
    // Pluie d'après la seule probabilité, temps prévu sec.
    expect(formatWeather({ ...weather, code: 3, label: 'Nuageux' })).toBe('Pluie probable · 8° à 14°');
    expect(formatWeather({ ...weather, tempMin: 14, rain: false, code: 0, label: '' })).toBe('14°');
  });
});

describe('heure de veille', () => {
  it('grise le jour (7 h – 22 h, heure de Paris), très sombre la nuit', () => {
    // 2026-10-24 : Paris en UTC+2.
    expect(sleepClockColor(new Date('2026-10-24T05:00:00Z'), 'Europe/Paris')).toBe(SLEEP_CLOCK_DAY_COLOR); // 7 h
    expect(sleepClockColor(new Date('2026-10-24T04:59:00Z'), 'Europe/Paris')).toBe(SLEEP_CLOCK_NIGHT_COLOR); // 6 h 59
    expect(sleepClockColor(new Date('2026-10-24T19:59:00Z'), 'Europe/Paris')).toBe(SLEEP_CLOCK_DAY_COLOR); // 21 h 59
    expect(sleepClockColor(new Date('2026-10-24T20:00:00Z'), 'Europe/Paris')).toBe(SLEEP_CLOCK_NIGHT_COLOR); // 22 h
  });
});
