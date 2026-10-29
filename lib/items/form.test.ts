import { describe, expect, it } from 'vitest';
import { COLD_BELOW_C, MILD_BELOW_C, targetWarmth } from '@/lib/outfits/score';
import { CATEGORIES, type ItemDraft } from '@/lib/types';
import { sameDraft, showsRain, warmthHint } from './form';

describe('warmthHint', () => {
  it('donne le repère de chaque chaleur', () => {
    expect(warmthHint(1)).toBe('18° et plus');
    expect(warmthHint(2)).toBe('10 à 17°');
    expect(warmthHint(3)).toBe('moins de 10°');
  });

  it('suit les seuils du choix des tenues (targetWarmth)', () => {
    for (let temperature = -10; temperature <= 35; temperature += 1) {
      const hint = warmthHint(targetWarmth(temperature));
      if (temperature >= MILD_BELOW_C) expect(hint, String(temperature)).toBe(`${MILD_BELOW_C}° et plus`);
      else if (temperature >= COLD_BELOW_C) expect(hint, String(temperature)).toBe(`${COLD_BELOW_C} à ${MILD_BELOW_C - 1}°`);
      else expect(hint, String(temperature)).toBe(`moins de ${COLD_BELOW_C}°`);
    }
  });
});

describe('showsRain', () => {
  it('seulement pour les vestes et les chaussures', () => {
    expect(CATEGORIES.filter(showsRain)).toEqual(['veste', 'chaussures']);
  });
});

describe('sameDraft', () => {
  const DRAFT: ItemDraft = {
    name: 'Jean brut',
    category: 'bas',
    color: '#1F2A44',
    warmth: 2,
    styles: ['decontracte', 'habille'],
    rain_ok: false,
  };

  it('ignore les espaces du nom, la casse de la couleur et l’ordre des styles', () => {
    expect(sameDraft(DRAFT, { ...DRAFT })).toBe(true);
    expect(sameDraft(DRAFT, { ...DRAFT, name: '  Jean   brut ' })).toBe(true);
    expect(sameDraft(DRAFT, { ...DRAFT, color: '#1f2a44' })).toBe(true);
    expect(sameDraft(DRAFT, { ...DRAFT, styles: ['habille', 'decontracte'] })).toBe(true);
  });

  it('voit chaque champ changé', () => {
    const changes: Array<Partial<ItemDraft>> = [
      { name: 'Jean noir' },
      { category: 'robe' },
      { color: null },
      { color: '#1F2A45' },
      { warmth: 3 },
      { styles: ['decontracte'] },
      { styles: ['decontracte', 'sport'] },
      { rain_ok: true },
    ];
    for (const change of changes) {
      expect(sameDraft(DRAFT, { ...DRAFT, ...change }), JSON.stringify(change)).toBe(false);
      expect(sameDraft({ ...DRAFT, ...change }, DRAFT), JSON.stringify(change)).toBe(false);
    }
  });

  it('deux fiches sans couleur sont les mêmes', () => {
    expect(sameDraft({ ...DRAFT, color: null }, { ...DRAFT, color: null })).toBe(true);
  });
});
