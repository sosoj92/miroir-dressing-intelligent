import { describe, expect, it } from 'vitest';
import {
  VERSION_ITEM_COLUMNS,
  knownRefusalCount,
  mirrorVersion,
  needsVersionReload,
  pendingVersion,
  planVersion,
  refusalCountOf,
  refusalReload,
  versionItemOf,
  versionOf,
  withPlanVersion,
  type VersionItem,
} from './version';

const PROFILE = { city: 'Paris', lat: 48.8566, lon: 2.3522, timezone: 'Europe/Paris', evening_hour: 18 };

const NO_ASSEMBLY = {
  assembly_v: null,
  assembly_sleeves: null,
  assembly_size: null,
  assembly_eye: null,
  assembly_top_low: null,
  assembly_bottom_high: null,
  assembly_one_piece: null,
  assembly_tucked: null,
  assembly_arms: null,
  assembly_body: null,
  assembly_arm_sleeves: null,
  assembly_wrist: null,
  assembly_cuff: null,
};

function item(id: string, overrides: Partial<VersionItem> = {}): VersionItem {
  return {
    id,
    name: `Pièce ${id}`,
    category: 'haut',
    color: '#1F2A44',
    warmth: 2,
    styles: ['decontracte'],
    rain_ok: false,
    dirty: false,
    photo_path: null,
    cutout_path: `user/${id}.png`,
    ...NO_ASSEMBLY,
    ...overrides,
  };
}

const ITEMS = [item('h1'), item('b1', { category: 'bas' })];
const PLAN = { date: '2026-10-25', item_ids: ['h1', 'b1'] };
const base = { items: ITEMS, plan: PLAN, profile: PROFILE };

/** Une photo portée complète, avec ses bras pliés (format de lib/types.ts). */
const PHOTO = {
  key: 'PHOTO_1',
  size: [1000, 1600],
  eye: [500, 200],
  centers: [
    [0, 500],
    [10, 501],
  ],
  topLow: 820,
  bottomHigh: 760,
  onePiece: false,
  tucked: true,
  arms: {
    v: 1,
    arms: { path: 'user/assemblage/bras/PHOTO_1-bras.webp', box: [10, 20, 300, 400] },
    body: { path: 'user/assemblage/bras/PHOTO_1-corps.webp', box: [5, 6, 700, 900] },
    sleeves: null,
    step: 10,
    from: 5,
    L: [[1, 2], null],
    R: [null, [3, 4]],
    sleeveL: [],
    sleeveR: [],
    wrist: { L: 120, R: 125 },
    cuff: { L: 60, R: null },
  },
};

describe('mirrorVersion', () => {
  it('stable : mêmes données, même empreinte, quel que soit l’ordre des lignes et des pièces prévues', () => {
    const version = mirrorVersion(base);
    expect(version).toMatch(/^v2-[0-9a-f]{16}\.[0-9a-f]{16}$/);
    expect(mirrorVersion({ ...base, items: [...ITEMS].reverse() })).toBe(version);
    expect(mirrorVersion({ ...base, plan: { ...PLAN, item_ids: ['b1', 'h1'] } })).toBe(version);
  });

  it('change avec ce que le téléphone modifie sur une pièce, repères d’assemblage compris', () => {
    const version = mirrorVersion(base);
    const changes: Array<Partial<VersionItem>> = [
      { name: 'Pull rouge' },
      { category: 'veste' },
      { color: '#FFFFFF' },
      { warmth: 3 },
      { styles: ['habille'] },
      { rain_ok: true },
      { cutout_path: 'user/h1-v2.png' },
      { assembly_v: 1 },
      { assembly_sleeves: 'user/assemblage/manches/h1.webp' },
      // Import rejoué : nouveaux repères ou nouvelles couches de bras, aux mêmes chemins de photo.
      { assembly_eye: [501, 200] },
      { assembly_top_low: 830 },
      { assembly_arms: { path: 'user/assemblage/bras/PHOTO_1-bras.webp', box: [10, 20, 300, 401] } },
      { assembly_wrist: { L: 121, R: 125 } },
    ];
    for (const change of changes) {
      expect(mirrorVersion({ ...base, items: [item('h1', change), ITEMS[1]] }), JSON.stringify(change)).not.toBe(version);
    }
  });

  it('change quand une pièce passe au sale (absente des pièces propres), est ajoutée ou supprimée', () => {
    const version = mirrorVersion(base);
    expect(mirrorVersion({ ...base, items: ITEMS.slice(0, 1) })).not.toBe(version);
    expect(mirrorVersion({ ...base, items: [...ITEMS, item('h2')] })).not.toBe(version);
  });

  it('change avec la tenue prévue (sa seule partie), la ville et l’heure du soir', () => {
    const version = mirrorVersion(base);
    const data = version.split('.')[0];
    for (const plan of [null, { ...PLAN, item_ids: ['h1'] }, { ...PLAN, date: '2026-10-26' }]) {
      const other = mirrorVersion({ ...base, plan });
      expect(other).not.toBe(version);
      expect(other.split('.')[0]).toBe(data);
      expect(other).toBe(`${data}.${planVersion(plan)}`);
    }
    expect(mirrorVersion({ ...base, profile: { ...PROFILE, evening_hour: 19 } })).not.toBe(version);
    expect(mirrorVersion({ ...base, profile: { ...PROFILE, city: 'Lyon', lat: 45.76, lon: 4.84 } })).not.toBe(version);
  });

  it('lit l’assemblage par chemins JSON légers, sans les tableaux de bords', () => {
    expect(VERSION_ITEM_COLUMNS).toContain('assembly_v:assembly->v');
    expect(VERSION_ITEM_COLUMNS).toContain('assembly_eye:assembly->photo->eye');
    expect(VERSION_ITEM_COLUMNS).toContain('assembly_body:assembly->photo->arms->body');
    expect(VERSION_ITEM_COLUMNS).not.toMatch(/centers|->L\b|->R\b|sleeveL|sleeveR/);
  });

  it('une ligne complète réduite comme la lit /api/miroir/touches', () => {
    const columns = {
      id: 'h1',
      name: 'Pièce h1',
      category: 'haut',
      color: '#1F2A44',
      warmth: 2,
      styles: ['decontracte'],
      rain_ok: false,
      dirty: false,
      photo_path: null,
      cutout_path: 'user/h1.png',
    };
    const assembly = { v: 1, photo: PHOTO, sleevesPath: 'user/assemblage/manches/h1.webp' };
    expect(versionItemOf({ ...columns, assembly })).toEqual(
      item('h1', {
        assembly_v: 1,
        assembly_sleeves: 'user/assemblage/manches/h1.webp',
        assembly_size: [1000, 1600],
        assembly_eye: [500, 200],
        assembly_top_low: 820,
        assembly_bottom_high: 760,
        assembly_one_piece: false,
        assembly_tucked: true,
        assembly_arms: PHOTO.arms.arms,
        assembly_body: PHOTO.arms.body,
        assembly_arm_sleeves: null,
        assembly_wrist: { L: 120, R: 125 },
        assembly_cuff: { L: 60, R: null },
      }),
    );
    // Les tableaux de bords changent sans changer l'empreinte (trop lourds à relire toutes les 30 s).
    const edges = { ...assembly, photo: { ...PHOTO, centers: [], arms: { ...PHOTO.arms, L: [] } } };
    expect(versionItemOf({ ...columns, assembly: edges })).toEqual(versionItemOf({ ...columns, assembly }));
    // Comme `->` : null sans assemblage, sans la clé, ou si un niveau n'est pas un objet.
    for (const value of [null, undefined, {}, [1], 'texte', { v: 1, photo: [1, 2] }]) {
      const expected = value && typeof value === 'object' && 'v' in value ? item('h1', { assembly_v: 1 }) : item('h1');
      expect(versionItemOf({ ...columns, assembly: value })).toEqual(expected);
    }
  });
});

describe('choix faits sur la tablette', () => {
  it('« oui » pour demain ou « Recommencer » : seule la partie tenue prévue change, comme sur le serveur', () => {
    const version = mirrorVersion(base);
    const accepted = { date: '2026-10-25', item_ids: ['b1', 'h2'] };
    expect(withPlanVersion(version, accepted)).toBe(mirrorVersion({ ...base, plan: accepted }));
    expect(withPlanVersion(version, null)).toBe(mirrorVersion({ ...base, plan: null }));
    // Sans empreinte, ou d'un autre format : rien à prévoir, la tablette relira une fois.
    expect(withPlanVersion(null, accepted)).toBeNull();
    expect(withPlanVersion('v1-0123456789abcdef', accepted)).toBeNull();
  });

  it('relecture avec des choix encore dans la file : l’empreinte d’après ces choix, pour le jour visé', () => {
    const version = mirrorVersion(base);
    const plan = { kind: 'plan' as const, date: '2026-10-25', item_ids: ['h2', 'b1'] };
    const restart = { kind: 'restart' as const, date: '2026-10-25', today: '2026-10-24', refused: [] };
    expect(pendingVersion(version, [], '2026-10-25')).toBe(version);
    expect(pendingVersion(version, [plan], '2026-10-25')).toBe(mirrorVersion({ ...base, plan }));
    expect(pendingVersion(version, [plan, restart], '2026-10-25')).toBe(mirrorVersion({ ...base, plan: null }));
    expect(pendingVersion(version, [restart, plan], '2026-10-25')).toBe(mirrorVersion({ ...base, plan }));
    // Un choix d'un autre jour ne touche pas à la tenue prévue du jour visé.
    expect(pendingVersion(version, [{ ...restart, date: '2026-10-24' }], '2026-10-25')).toBe(version);
    // « Oui » pour aujourd'hui (tenue portée) : l'empreinte ne la contient pas.
    const worn = { kind: 'history' as const, date: '2026-10-25', item_ids: ['h2', 'b1'], title: null };
    expect(pendingVersion(version, [worn], '2026-10-25')).toBe(version);
  });
});

describe('relecture du miroir', () => {
  it('lit l’empreinte et le nombre de refus d’une réponse, sinon null', () => {
    expect(versionOf({ version: 'v2-abc', refusals: 2 })).toBe('v2-abc');
    expect(versionOf({ refusals: 2 })).toBeNull();
    expect(versionOf({ version: '' })).toBeNull();
    expect(versionOf({ version: 3 })).toBeNull();
    expect(versionOf(null)).toBeNull();
    expect(refusalCountOf({ refusals: 3 })).toBe(3);
    expect(refusalCountOf({ refusals: 0 })).toBe(0);
    for (const body of [{}, { refusals: null }, { refusals: -1 }, { refusals: 1.5 }, { refusals: '3' }, null]) {
      expect(refusalCountOf(body)).toBeNull();
    }
  });

  it('relit si l’empreinte a changé, une seule fois par empreinte qui ne s’accorde pas', () => {
    expect(needsVersionReload('v2-a', 'v2-a', null)).toBe(false);
    expect(needsVersionReload('v2-a', 'v2-b', null)).toBe(true);
    // Pas d'empreinte (serveur en échec) : rien.
    expect(needsVersionReload('v2-a', null, null)).toBe(false);
    // Données lues sans empreinte : une relecture, puis plus rien pour cette empreinte.
    expect(needsVersionReload(null, 'v2-b', null)).toBe(true);
    expect(needsVersionReload(null, 'v2-b', 'v2-b')).toBe(false);
    // Une relecture pour v2-b a rendu v2-c (calculs divergents) : pas de relecture toutes les 30 s,
    // mais le changement suivant relit.
    expect(needsVersionReload('v2-c', 'v2-b', 'v2-b')).toBe(false);
    expect(needsVersionReload('v2-c', 'v2-d', 'v2-b')).toBe(true);
  });

  it('refus connus : ceux du serveur, plus ceux envoyés d’ici qu’il n’avait pas', () => {
    const server = [{ item_ids: ['a', 'b'] }, { item_ids: ['c', 'd'] }];
    expect(knownRefusalCount(server, [], [])).toBe(2);
    // Un « non » envoyé : un de plus ; encore dans la file : pas encore.
    expect(knownRefusalCount(server, [{ item_ids: ['e', 'f'] }], [])).toBe(3);
    expect(knownRefusalCount(server, [{ item_ids: ['e', 'f'] }], [['f', 'e']])).toBe(2);
    // Un « non » sur une tenue déjà « Écartée » : le serveur l'ignore.
    expect(knownRefusalCount(server, [{ item_ids: ['b', 'a'] }], [])).toBe(2);
  });

  it('relit quand le serveur compte moins de refus, une seule fois par compte qui ne s’accorde pas', () => {
    // Le miroir n'en fait qu'ajouter : un compte égal ou plus grand ne relit pas.
    expect(refusalReload(3, 3, null)).toEqual({ reload: false, settled: null });
    expect(refusalReload(3, 4, null)).toEqual({ reload: false, settled: null });
    expect(refusalReload(3, null, 2)).toEqual({ reload: false, settled: 2 });
    // « Remettre » sur le téléphone : un de moins, on relit.
    expect(refusalReload(3, 2, null)).toEqual({ reload: true, settled: null });
    // Une relecture pour 2 ne les a pas accordés : pas toutes les 30 s…
    expect(refusalReload(3, 2, 2)).toEqual({ reload: false, settled: 2 });
    // … mais dès qu'ils s'accordent, le prochain effacement relit de nouveau.
    expect(refusalReload(2, 2, 2)).toEqual({ reload: false, settled: null });
    expect(refusalReload(3, 2, null).reload).toBe(true);
  });
});
