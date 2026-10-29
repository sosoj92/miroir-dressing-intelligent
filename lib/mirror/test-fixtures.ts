import type { Category, MirrorItem, MirrorPayload, Outfit } from '@/lib/types';

// Données de test des modules du miroir (tests unitaires seulement).

export function mirrorItem(id: string, category: Category, overrides: Partial<MirrorItem> = {}): MirrorItem {
  return {
    id,
    name: `Pièce ${id}`,
    category,
    color: '#C8B59A',
    warmth: 2,
    styles: ['decontracte'],
    rain_ok: true,
    dirty: false,
    photo_path: null,
    cutout_path: `user/${id}.png`,
    legacy_id: null,
    created_at: '2026-10-01T08:00:00Z',
    cutout_url: `https://storage.test/${id}.png?token=t`,
    ...overrides,
  };
}

export function outfit(itemIds: string[], coreIds: string[], overrides: Partial<Outfit> = {}): Outfit {
  return {
    key: [...itemIds].sort().join('+'),
    item_ids: itemIds,
    core_ids: [...coreIds].sort(),
    // Par défaut, ce que montre la silhouette = le cœur (les tests du refus « vu » le précisent).
    drawn_ids: [...coreIds].sort(),
    title: `Tenue ${itemIds.join(' ')}`,
    planned: false,
    score: 1,
    ...overrides,
  };
}

export const ITEMS: MirrorItem[] = [
  mirrorItem('h1', 'haut'),
  mirrorItem('h2', 'haut'),
  mirrorItem('b1', 'bas'),
  mirrorItem('b2', 'bas'),
  mirrorItem('v1', 'veste'),
  mirrorItem('c1', 'chaussures'),
  mirrorItem('a1', 'accessoire'),
  mirrorItem('r1', 'robe', { cutout_url: null }),
];

/** Quatre tenues ; les deux dernières partagent leurs pièces principales (h2 + b2). */
export const OUTFITS: Outfit[] = [
  outfit(['h1', 'b1', 'c1'], ['h1', 'b1']),
  outfit(['v1', 'h1', 'b2', 'c1'], ['v1', 'h1', 'b2']),
  outfit(['h2', 'b2', 'c1'], ['h2', 'b2']),
  outfit(['h2', 'b2', 'a1'], ['h2', 'b2']),
];

export function payload(overrides: Partial<MirrorPayload> = {}): MirrorPayload {
  return {
    today: '2026-10-24',
    targetDate: '2026-10-24',
    isTomorrow: false,
    timezone: 'Europe/Paris',
    eveningHour: 18,
    weather: null,
    items: ITEMS,
    history: [],
    refusals: [],
    plan: null,
    keyMap: {
      next: { code: 'KeyD', key: 'd' },
      previous: { code: 'KeyA', key: 'a' },
      bottomNext: { code: 'KeyW', key: 'w' },
      bottomPrevious: { code: 'KeyS', key: 's' },
      jacket: { code: 'KeyV', key: 'v' },
      accept: { code: 'KeyJ', key: 'j' },
      refuse: { code: 'KeyK', key: 'k' },
      restart: { code: 'KeyL', key: 'l' },
    },
    ...overrides,
  };
}
