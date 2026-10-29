import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME_ZONE,
  addDays,
  formatDayLabel,
  hourInTimeZone,
  isoDateInTimeZone,
  targetDay,
} from './dates';

describe('lib/dates', () => {
  it('calcule la date dans le fuseau de Paris, pas en UTC', () => {
    // 23 h 30 UTC le 24 octobre = 1 h 30 à Paris le 25 (heure d'été).
    const instant = new Date('2026-10-24T23:30:00Z');
    expect(isoDateInTimeZone(instant, 'UTC')).toBe('2026-10-24');
    expect(isoDateInTimeZone(instant, DEFAULT_TIME_ZONE)).toBe('2026-10-25');
  });

  it('affiche le jour en français avec une majuscule', () => {
    expect(formatDayLabel('2026-10-24')).toBe('Samedi 24 octobre');
    expect(formatDayLabel('2027-01-01')).toBe('Vendredi 1 janvier');
  });

  it('ajoute des jours sur le calendrier, y compris au changement d’heure et de mois', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26'); // passage à l'heure d'hiver
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it("donne l'heure dans le fuseau du profil", () => {
    expect(hourInTimeZone(new Date('2026-10-24T16:30:00Z'), DEFAULT_TIME_ZONE)).toBe(18);
    expect(hourInTimeZone(new Date('2026-10-24T22:00:00Z'), DEFAULT_TIME_ZONE)).toBe(0);
  });

  it("vise demain à partir de l'heure du soir, aujourd'hui avant", () => {
    const evening = 18;
    expect(targetDay(new Date('2026-10-24T15:59:00Z'), DEFAULT_TIME_ZONE, evening)).toEqual({
      today: '2026-10-24',
      targetDate: '2026-10-24',
      isTomorrow: false,
    });
    expect(targetDay(new Date('2026-10-24T16:00:00Z'), DEFAULT_TIME_ZONE, evening)).toEqual({
      today: '2026-10-24',
      targetDate: '2026-10-25',
      isTomorrow: true,
    });
    // Après minuit à Paris : de nouveau le jour même.
    expect(targetDay(new Date('2026-10-24T22:30:00Z'), DEFAULT_TIME_ZONE, evening).targetDate).toBe('2026-10-25');
    expect(targetDay(new Date('2026-10-24T22:30:00Z'), DEFAULT_TIME_ZONE, evening).isTomorrow).toBe(false);
  });
});
