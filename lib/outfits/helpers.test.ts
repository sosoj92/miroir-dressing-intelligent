import { describe, expect, it } from 'vitest';
import {
  ANALOGOUS_MAX_DEG,
  COMPLEMENTARY_MIN_DEG,
  colorHarmony,
  hexToHsl,
  hueDistance,
  isNeutral,
} from './color';
import { hashSeed } from './hash';
import { dayNumber, daysBetween, lastWornDaysAgo, recentPairs } from './history';
import { jacketTargetWarmth, needsJacket, referenceTemperature, targetWarmth, warmthScore } from './score';
import { FALLBACK_TITLE, outfitTitle } from './title';
import type { Category, DayWeather } from '@/lib/types';

const weather = (temp: number, rain = false): DayWeather => ({
  date: '2026-10-24',
  tempMin: temp - 6,
  tempMax: temp,
  temp,
  code: rain ? 61 : 3,
  rain,
  label: '',
});

describe('hashSeed', () => {
  it('est le FNV-1a 32 bits du prototype : non signé et stable', () => {
    expect(hashSeed('')).toBe(2166136261);
    expect(hashSeed('a')).toBe(0xe40c292c);
    expect(hashSeed('foobar')).toBe(0xbf9cf968);
    expect(hashSeed('2026-10-24|h1')).toBe(hashSeed('2026-10-24|h1'));
    expect(hashSeed('2026-10-24|h1')).not.toBe(hashSeed('2026-10-25|h1'));
  });
});

describe('dates de l’historique', () => {
  it('compte les jours sur le calendrier, y compris aux changements d’heure, de mois et d’année', () => {
    expect(daysBetween('2026-10-23', '2026-10-24')).toBe(1);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2); // passage à l'heure d'hiver le 25
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2); // année bissextile
    expect(daysBetween('2026-10-24', '2026-10-17')).toBe(-7);
    expect(dayNumber('1970-01-01')).toBe(0);
  });

  it('refuse une date invalide', () => {
    for (const value of ['2026-02-30', '2026-13-01', '24/10/2026', '', null, 20261024]) {
      expect(dayNumber(value)).toBeNull();
    }
    expect(daysBetween('pas une date', '2026-10-24')).toBeNull();
  });

  it('garde la dernière fois où chaque pièce a été portée avant la date visée, jamais le jour même ni après', () => {
    const last = lastWornDaysAgo(
      [
        { date: '2026-10-20', item_ids: ['a', 'b'], title: null },
        { date: '2026-10-23', item_ids: ['a'], title: null },
        { date: '2026-10-24', item_ids: ['c'], title: null },
        { date: '2026-10-25', item_ids: ['d'], title: null },
        { date: 'n’importe quoi', item_ids: ['e'], title: null },
      ],
      '2026-10-24',
    );
    expect(Object.fromEntries(last)).toEqual({ a: 1, b: 4 });
  });

  it('retrouve les duos haut + bas récents par catégorie', () => {
    const categories = new Map<string, Category>([
      ['h1', 'haut'],
      ['b1', 'bas'],
      ['b2', 'bas'],
      ['v1', 'veste'],
    ]);
    const history = [
      { date: '2026-10-19', item_ids: ['v1', 'h1', 'b1'], title: null },
      { date: '2026-10-01', item_ids: ['h1', 'b2'], title: null },
    ];
    expect([...recentPairs(history, '2026-10-24', categories, 14)]).toEqual(['h1+b1']);
  });
});

describe('harmonie des couleurs', () => {
  it('lit une couleur #RRGGBB en teinte, saturation et luminosité', () => {
    expect(hexToHsl('#FF0000')).toEqual({ h: 0, s: 1, l: 0.5 });
    expect(hexToHsl('#808080')).toMatchObject({ s: 0 });
    expect(hexToHsl('rouge')).toBeNull();
    expect(hexToHsl(null)).toBeNull();
  });

  it('classe comme neutres le noir, le blanc, le gris, le marine, le jean et le camel', () => {
    for (const color of ['#000000', '#FFFFFF', '#808080', '#1F2A44', '#000080', '#3B5A80', '#7A9CC6', '#C19A6B', '#F5F0E1', null]) {
      expect(isNeutral(color), String(color)).toBe(true);
    }
  });

  it('classe comme vives les couleurs franches', () => {
    for (const color of ['#D62828', '#2A9D3A', '#1F4FD1', '#E8731C', '#F2C80F']) {
      expect(isNeutral(color), color).toBe(false);
    }
  });

  it('un neutre va avec tout', () => {
    expect(colorHarmony('#808080', '#D62828')).toBe('neutral');
    expect(colorHarmony('#1F2A44', '#2A9D3A')).toBe('neutral');
    expect(colorHarmony(null, '#D62828')).toBe('neutral');
  });

  it('deux couleurs vives voisines ou complémentaires vont ensemble, les autres jurent', () => {
    expect(ANALOGOUS_MAX_DEG).toBe(40);
    expect(COMPLEMENTARY_MIN_DEG).toBe(150);
    expect(colorHarmony('#D62828', '#E8731C')).toBe('match'); // rouge et orange
    expect(colorHarmony('#1F4FD1', '#E8731C')).toBe('match'); // bleu et orange
    expect(colorHarmony('#D62828', '#2A9D3A')).toBe('clash'); // rouge et vert
    expect(colorHarmony('#2A9D3A', '#1F4FD1')).toBe('clash'); // vert et bleu
  });

  it('mesure l’écart de teinte sur le cercle', () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
    expect(hueDistance(90, 300)).toBe(150);
  });
});

describe('règles de météo', () => {
  it('ajoute une veste sous 15 °C, s’il pleut, ou si le matin est sous 12 °C', () => {
    expect(needsJacket({ ...weather(14), tempMin: 13 })).toBe(true);
    expect(needsJacket({ ...weather(15), tempMin: 12 })).toBe(false);
    expect(needsJacket({ ...weather(28, true), tempMin: 20 })).toBe(true);
    // On s'habille le matin : 8–16 °C sec demande une veste, 14–27 °C non.
    expect(needsJacket({ ...weather(16), tempMin: 8 })).toBe(true);
    expect(needsJacket({ ...weather(27), tempMin: 14 })).toBe(false);
  });

  it('vise la chaleur du matin pour la veste, celle du jour pour le reste', () => {
    expect(jacketTargetWarmth({ ...weather(19), tempMin: 11 })).toBe(2);
    expect(jacketTargetWarmth({ ...weather(16), tempMin: 8 })).toBe(3);
    expect(jacketTargetWarmth({ ...weather(27), tempMin: 20 })).toBe(1);
    expect(jacketTargetWarmth(null)).toBe(targetWarmth(16));
  });

  it('prend 16 °C sans météo, et le maximum si la référence manque', () => {
    expect(referenceTemperature(null)).toBe(16);
    expect(needsJacket(null)).toBe(false);
    expect(referenceTemperature({ ...weather(20), temp: Number.NaN })).toBe(20);
  });

  it('vise une chaleur 3 sous 10 °C, 2 sous 18 °C, 1 au-dessus', () => {
    expect([9, 10, 17, 18, 30].map(targetWarmth)).toEqual([3, 2, 2, 1, 1]);
  });

  it('note la chaleur comme le prototype : 3 si elle correspond, 1 si voisine, −2 sinon', () => {
    expect(warmthScore(2, 2)).toBe(3);
    expect(warmthScore(1, 2)).toBe(1);
    expect(warmthScore(3, 1)).toBe(-2);
  });
});

describe('titre de secours', () => {
  it('nomme le haut et le bas, puis la veste', () => {
    expect(outfitTitle(['Pull marine', 'Jean brut'])).toBe('Pull marine et jean brut');
    expect(outfitTitle(['Pull marine', 'Jean brut', 'Trench'])).toBe('Pull marine, jean brut et trench');
    expect(outfitTitle(['Robe rouge'])).toBe('Robe rouge');
  });

  it('nettoie les noms et garde les sigles', () => {
    expect(outfitTitle(['  t-shirt   blanc ', 'Jean'])).toBe('T-shirt blanc et jean');
    expect(outfitTitle(['Sweat', 'AC/DC'])).toBe('Sweat et AC/DC');
    expect(outfitTitle(['', '  '])).toBe(FALLBACK_TITLE);
    expect(outfitTitle([])).toBe(FALLBACK_TITLE);
  });
});
