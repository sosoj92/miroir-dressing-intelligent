import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planSilhouette } from '@/lib/assembly/arms-plan';
import { parseAssemblyPhoto } from '@/lib/assembly/parse';
import { silhouetteSource } from '@/lib/assembly/render';
import type { Assembly, MirrorItem } from '@/lib/types';
import {
  buildDeck,
  itemImageUrls,
  itemsById,
  mergeRefusals,
  outfitImageUrls,
  outfitLayout,
  outfitSilhouette,
  outfitSilhouettes,
  refusalIds,
  sameIds,
  withoutRefused,
} from './deck';
import { ITEMS, OUTFITS, mirrorItem, outfit, payload } from './test-fixtures';

const BY_ID = itemsById(ITEMS);

describe('refus', () => {
  it('compare les listes d’ids sans tenir compte de l’ordre', () => {
    expect(sameIds(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameIds(['a'], ['a', 'b'])).toBe(false);
  });

  it('fusionne refus du serveur et refus locaux sans doublon, triés', () => {
    const merged = mergeRefusals([{ item_ids: ['b', 'a'] }], [{ item_ids: ['a', 'b'] }, { item_ids: ['c'] }]);
    expect(merged).toEqual([{ item_ids: ['a', 'b'] }, { item_ids: ['c'] }]);
  });

  it('enregistre ce que montre la silhouette : drawn_ids, sinon recalculé (veste et bas, ou la robe seule)', () => {
    expect(refusalIds(outfit(['v1', 'h1', 'b2', 'c1'], ['v1', 'h1', 'b2'], { drawn_ids: ['b2', 'v1'] }), BY_ID)).toEqual([
      'b2',
      'v1',
    ]);
    // Sans drawn_ids : la veste cache le haut ; une robe se montre seule, sans sa veste.
    expect(refusalIds(outfit(['v1', 'h1', 'b2', 'c1'], [], { drawn_ids: [] }), BY_ID)).toEqual(['b2', 'v1']);
    expect(refusalIds(outfit(['v1', 'r1', 'c1', 'a1'], [], { drawn_ids: [] }), BY_ID)).toEqual(['r1']);
    expect(refusalIds(outfit(['h2', 'b1', 'c1'], [], { drawn_ids: [] }), BY_ID)).toEqual(['b1', 'h2']);
  });

  it('« non » à ce qu’on voit : la même veste et le même bas sont écartés, quel que soit le haut caché', () => {
    const shown = [
      outfit(['v1', 'h1', 'b2'], ['v1', 'h1', 'b2'], { drawn_ids: ['b2', 'v1'] }),
      outfit(['v1', 'h2', 'b2'], ['v1', 'h2', 'b2'], { drawn_ids: ['b2', 'v1'] }),
      outfit(['v1', 'h2', 'b1'], ['v1', 'h2', 'b1'], { drawn_ids: ['b1', 'v1'] }),
    ];
    const kept = withoutRefused(shown, [{ item_ids: ['b2', 'v1'] }], BY_ID);
    expect(kept.map((candidate) => candidate.key)).toEqual([shown[2].key]);
    // Un refus de l'ancien format (haut, bas, veste) bloque encore exactement ces trois pièces.
    const old = withoutRefused(shown, [{ item_ids: ['b2', 'h1', 'v1'] }], BY_ID);
    expect(old.map((candidate) => candidate.key)).toEqual([shown[1].key, shown[2].key]);
  });

  it('écarte les tenues dont le cœur est refusé', () => {
    const kept = withoutRefused(OUTFITS, [{ item_ids: ['b2', 'h2'] }], BY_ID);
    expect(kept.map((candidate) => candidate.key)).toEqual([OUTFITS[0].key, OUTFITS[1].key]);
    expect(withoutRefused(OUTFITS, [], BY_ID)).toEqual(OUTFITS);
  });
});

describe('affichage', () => {
  it('liste les détourages à précharger, sans doublon, sans les pièces qui n’en ont pas', () => {
    const urls = outfitImageUrls([OUTFITS[0], OUTFITS[2], outfit(['r1', 'c1'], ['r1'])], ITEMS);
    expect(urls).toEqual([
      'https://storage.test/h1.png?token=t',
      'https://storage.test/b1.png?token=t',
      'https://storage.test/c1.png?token=t',
      'https://storage.test/h2.png?token=t',
      'https://storage.test/b2.png?token=t',
    ]);
  });

  it('range les pièces de haut en bas : veste et haut, bas, chaussures, accessoires', () => {
    const layout = outfitLayout(outfit(['h1', 'v1', 'b2', 'c1', 'a1'], ['h1', 'v1', 'b2']), BY_ID);
    expect(layout.upper.map((item) => item.id)).toEqual(['v1', 'h1']);
    expect(layout.lower.map((item) => item.id)).toEqual(['b2']);
    expect(layout.feet.map((item) => item.id)).toEqual(['c1']);
    expect(layout.extras.map((item) => item.id)).toEqual(['a1']);
  });

  it('une robe occupe le haut, sans rangée de bas ; une pièce inconnue est ignorée', () => {
    const byId = itemsById([...ITEMS, mirrorItem('x', 'haut')]);
    const layout = outfitLayout(outfit(['r1', 'c1', 'inconnue'], ['r1']), byId);
    expect(layout.upper.map((item) => item.id)).toEqual(['r1']);
    expect(layout.lower).toEqual([]);
  });
});

describe('silhouette assemblée', () => {
  const photo: Assembly['photo'] = {
    key: 'P',
    size: [1200, 1600],
    eye: [600, 400],
    centers: [[400, 620]],
    topLow: 480,
    bottomHigh: 520,
    onePiece: false,
    tucked: false,
  };
  const ASSEMBLED = [
    mirrorItem('h1', 'haut', {
      assembly: { v: 1, photo, sleevesPath: 'user/manches/h1.webp' },
      sleeves_url: 'https://storage.test/manches-h1.webp?token=t',
    }),
    mirrorItem('b1', 'bas', { assembly: { v: 1, photo, sleevesPath: null } }),
    mirrorItem('b2', 'bas'),
    mirrorItem('c1', 'chaussures'),
    mirrorItem('a1', 'accessoire'),
  ];
  const BY_ASSEMBLED = itemsById(ASSEMBLED);

  it('ne propose ni chaussures ni accessoires (la silhouette ne les dessine pas), même prévus', () => {
    const deck = buildDeck(
      payload({ items: ASSEMBLED, plan: { date: '2026-10-24', item_ids: ['h1', 'b1', 'c1'], confirmed: true } }),
      [],
    );
    expect(deck.length).toBeGreaterThan(0);
    for (const candidate of deck) {
      expect(candidate.item_ids.some((id) => id === 'c1' || id === 'a1')).toBe(false);
    }
    expect(deck[0]).toMatchObject({ planned: true });
    expect([...deck[0].item_ids].sort()).toEqual(['b1', 'h1']);
  });

  it('précharge aussi les manches', () => {
    expect(outfitImageUrls([outfit(['h1', 'b1'], ['h1', 'b1'])], ASSEMBLED)).toEqual([
      'https://storage.test/h1.png?token=t',
      'https://storage.test/manches-h1.webp?token=t',
      'https://storage.test/b1.png?token=t',
    ]);
  });

  it('autour de la tenue : détourages et manches de la pièce, pas les couches des bras pliés', () => {
    const layer = (name: string) => ({ path: `user/assemblage/${name}/P.webp`, box: [0, 0, 10, 10] as [number, number, number, number] });
    const arms = {
      v: 1 as const,
      arms: layer('bras'),
      body: layer('corps'),
      sleeves: layer('manches-photo'),
      step: 5,
      from: 250,
      L: [null],
      R: [null],
      sleeveL: [null],
      sleeveR: [null],
      wrist: { L: null, R: null },
      cuff: { L: null, R: null },
    };
    const urls = (id: string) => ({
      arms: `https://storage.test/bras-${id}.webp?token=t`,
      body: `https://storage.test/corps-${id}.webp?token=t`,
      sleeves: `https://storage.test/manches-photo-${id}.webp?token=t`,
    });
    const armed = { v: 1 as const, photo: { ...photo, arms }, sleevesPath: null };
    const items = [
      mirrorItem('h1', 'haut', { assembly: armed, arms_urls: urls('h1') }),
      mirrorItem('b1', 'bas', { assembly: armed, arms_urls: urls('b1') }),
    ];
    // Le pré-rendu de la silhouette charge lui-même les couches que son plan dessine.
    expect(outfitImageUrls([outfit(['h1', 'b1'], ['h1', 'b1'])], items)).toEqual([
      'https://storage.test/h1.png?token=t',
      'https://storage.test/b1.png?token=t',
    ]);
    // En arrière-plan : bras et corps d'un bas ; manches de la photo d'un haut, jamais ses bras.
    expect(itemImageUrls(items[1], [items[1]])).toEqual(['https://storage.test/b1.png?token=t', urls('b1').arms, urls('b1').body]);
    expect(itemImageUrls(items[0], [items[1]])).toEqual(['https://storage.test/h1.png?token=t', urls('h1').sleeves]);
    // URL de couches sans données de bras : ignorées, comme par la silhouette.
    const bare = mirrorItem('b2', 'bas', { assembly: { v: 1, photo, sleevesPath: null }, arms_urls: urls('b2') });
    expect(itemImageUrls(bare, [bare])).toEqual(['https://storage.test/b2.png?token=t']);
  });

  it('assemble les tenues dont toutes les pièces ont une photo portée, une seule fois chacune', () => {
    const assembled = outfit(['h1', 'b1'], ['h1', 'b1']);
    expect(outfitSilhouette(assembled, BY_ASSEMBLED)).toMatchObject({
      kind: 'pair',
      upper: { url: 'https://storage.test/h1.png?token=t', sleevesUrl: 'https://storage.test/manches-h1.webp?token=t' },
      lower: { url: 'https://storage.test/b1.png?token=t' },
    });
    expect(outfitSilhouette(outfit(['h1', 'b2'], ['h1', 'b2']), BY_ASSEMBLED)).toBeNull();
    const sources = outfitSilhouettes([assembled, outfit(['h1', 'b2'], ['h1', 'b2']), assembled], ASSEMBLED);
    expect(sources).toHaveLength(1);
  });
});

// Paires de référence des bras pliés (lib/assembly/fixtures/arms-reference.json) : repères tirés de
// photos portées personnelles, générés en local et jamais commités. Sans eux, ce bloc est sauté.
type ArmsReference = {
  photos: Record<string, object>;
  cases: Array<{ covers: string; upper: string; lower: string; upperSleeves: string | null }>;
};
const ARMS_FIXTURE = new URL('../assembly/fixtures/arms-reference.json', import.meta.url);
const armsFound = existsSync(ARMS_FIXTURE);

describe.skipIf(!armsFound)('préchargement des couches des bras pliés (photos de fixtures/arms-reference.json)', () => {
  const reference: ArmsReference = armsFound
    ? (JSON.parse(readFileSync(ARMS_FIXTURE, 'utf8')) as ArmsReference)
    : { photos: {}, cases: [] };
  const byCovers = (covers: string) => reference.cases.filter((entry) => entry.covers === covers);

  /** Pièce sur cette photo de référence ; les couches ont leur chemin du zip comme URL. */
  function referenceItem(id: string, category: 'haut' | 'bas', key: string, sleeves: string | null = null): MirrorItem {
    const photo = parseAssemblyPhoto({ ...reference.photos[key], key });
    if (!photo) throw new Error(`photo illisible : ${key}`);
    const arms = photo.arms;
    return mirrorItem(id, category, {
      cutout_url: `cutout/${key}`,
      assembly: { v: 1, photo, sleevesPath: sleeves },
      sleeves_url: sleeves,
      arms_urls: arms ? { arms: arms.arms.path, body: arms.body.path, sleeves: arms.sleeves?.path ?? null } : undefined,
    });
  }

  const body = (item: MirrorItem) => item.arms_urls!.body!;

  it('le corps d’un haut seulement si une paire étire sa bande de ventre, bras nus', () => {
    // Un haut de référence bras nus avec un bas, ventre étiré avec un autre.
    const naked = byCovers('bras nus').find((entry) => byCovers('ventre étiré').some((other) => other.upper === entry.upper));
    if (!naked) throw new Error('il faut un haut « bras nus » et « ventre étiré » dans la référence');
    const stretchedCase = byCovers('ventre étiré').find((other) => other.upper === naked.upper)!;
    const top = referenceItem('h1', 'haut', naked.upper);
    const plain = referenceItem('b1', 'bas', naked.lower);
    const stretched = referenceItem('b2', 'bas', stretchedCase.lower);
    expect(itemImageUrls(top, [plain])).not.toContain(body(top));
    expect(itemImageUrls(top, [plain, stretched])).toContain(body(top));
    expect(itemImageUrls(top, [])).not.toContain(body(top));

    // Un haut à manches longues avec un bas qui étire le ventre, mais les manches du haut couvrent
    // les bras : le plan dessine ses manches de la photo, pas son corps.
    const longSleeves = byCovers('manches longues et ventre étiré')[0];
    if (!longSleeves) throw new Error('il faut un cas « manches longues et ventre étiré » dans la référence');
    const sleeved = referenceItem('h2', 'haut', longSleeves.upper, 'manches/haut-a.webp');
    const urls = itemImageUrls(sleeved, [referenceItem('b3', 'bas', longSleeves.lower)]);
    expect(urls).not.toContain(body(sleeved));
    expect(urls).toContain(sleeved.arms_urls!.sleeves);
    expect(urls).toContain('manches/haut-a.webp');
  });

  it('chaque image que dessine le plan d’une paire est préchargée par l’une de ses deux pièces', () => {
    for (const entry of reference.cases) {
      const upper = referenceItem('u', 'haut', entry.upper, entry.upperSleeves);
      const lower = referenceItem('l', 'bas', entry.lower);
      const source = silhouetteSource(['u', 'l'], itemsById([upper, lower]));
      if (!source) throw new Error(`paire non assemblée : ${entry.covers}`);
      const plan = planSilhouette(source);
      const preloaded = new Set([...itemImageUrls(upper, [lower]), ...itemImageUrls(lower, [lower])]);
      for (const image of Object.values(plan.images)) {
        expect(preloaded.has(image!.url), `${entry.covers} : ${image!.layer} de ${image!.photo}`).toBe(true);
      }
      // En bras pliés, le corps du haut est préchargé si et seulement si le plan le dessine.
      if (plan.mode === 'plies') expect(preloaded.has(body(upper)), entry.covers).toBe('A.body' in plan.images);
    }
  });
});
