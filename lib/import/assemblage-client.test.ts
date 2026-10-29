import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import type { AssemblyActionResult, AssemblyBatch } from './assemblage';

// Sur demande, une fiche par envoi : un paquet d'essai tient sinon toujours dans un seul envoi.
const split = vi.hoisted(() => ({ perItem: false }));
vi.mock('./assemblage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./assemblage')>();
  return {
    ...actual,
    buildAssemblyBatches: (items: Parameters<typeof actual.buildAssemblyBatches>[0]) =>
      split.perItem ? items.map((item) => ({ items: [item] })) : actual.buildAssemblyBatches(items),
  };
});
import {
  assemblyDetail,
  assemblySummary,
  importAssemblyPackage,
  openAssemblyPackage,
  type AssemblyDeps,
  type AssemblyPackage,
} from './assemblage-client';
import { FAKE_JPEG, FAKE_WEBP, fakeArmsManifest, fakeManifest } from './assemblage-fixtures';

const USER = '0b7c7a2e-5f0e-4b8e-9a51-0e3c0f6d9a11';

function packageZip(files: Record<string, Uint8Array> = {}, manifest: unknown = fakeManifest(), folder = '') {
  return zipSync({
    [`${folder}manifest.json`]: strToU8(JSON.stringify(manifest)),
    [`${folder}photos/PHOTO_A.jpg`]: FAKE_JPEG,
    [`${folder}photos/PHOTO_A.webp`]: FAKE_WEBP,
    [`${folder}photos/PHOTO_B.jpg`]: FAKE_JPEG,
    [`${folder}photos/PHOTO_B.webp`]: FAKE_WEBP,
    [`${folder}manches/a01.webp`]: FAKE_WEBP,
    ...files,
  });
}

function open(bytes: Uint8Array): AssemblyPackage {
  const result = openAssemblyPackage(bytes);
  if (!result || !result.ok) throw new Error('paquet attendu');
  return result.pkg;
}

function deps(overrides: Partial<AssemblyDeps> = {}) {
  const upload = vi.fn<AssemblyDeps['upload']>(async () => true);
  const batches: AssemblyBatch[] = [];
  const send = vi.fn(async (batch: AssemblyBatch): Promise<AssemblyActionResult> => {
    batches.push(batch);
    return { ok: true, counts: { created: batch.items.length, updated: 0 }, replaced: [] };
  });
  const finish = vi.fn<AssemblyDeps['finish']>(async () => ({ ok: true }));
  const progress: string[] = [];
  return {
    upload,
    send,
    finish,
    batches,
    progress,
    deps: {
      userId: USER,
      upload,
      send,
      finish,
      onProgress: (step: Parameters<NonNullable<AssemblyDeps['onProgress']>>[0]) =>
        progress.push('done' in step ? `${step.step} ${step.done}/${step.total}` : step.step),
      ...overrides,
    } satisfies AssemblyDeps,
  };
}

describe('openAssemblyPackage', () => {
  it("reconnaît un zip qui contient le manifeste d'assemblage, à la racine ou dans un dossier", () => {
    expect(open(packageZip()).folder).toBe('');
    expect(open(packageZip({}, fakeManifest(), 'mon-dressing-import/')).folder).toBe('mon-dressing-import/');
  });

  it('laisse le flux du prototype prendre un db.json, un zip sans manifeste ou un autre manifeste', () => {
    expect(openAssemblyPackage(strToU8('{"version":1}'))).toBeNull();
    expect(openAssemblyPackage(zipSync({ 'Dressing/db.json': strToU8('{}') }))).toBeNull();
    expect(openAssemblyPackage(zipSync({ 'manifest.json': strToU8('{"format":"autre"}') }))).toBeNull();
  });

  it('dit quand le manifeste est illisible', () => {
    expect(openAssemblyPackage(zipSync({ 'manifest.json': strToU8('{pas du json') }))).toEqual({
      ok: false,
      error: 'Le manifest.json de ce zip est illisible.',
    });
  });
});

describe('importAssemblyPackage', () => {
  it('envoie chaque fichier une seule fois, puis les fiches', async () => {
    const run = deps();
    const outcome = await importAssemblyPackage(open(packageZip()), run.deps);

    expect(outcome).toEqual({ ok: true, counts: { created: 3, updated: 0 }, photos: 2, arms: 0, sleeves: 1 });
    const paths = run.upload.mock.calls.map(([path]) => path).sort();
    expect(paths).toEqual(
      [
        `${USER}/assemblage/PHOTO_A.jpg`,
        `${USER}/assemblage/PHOTO_A.webp`,
        `${USER}/assemblage/PHOTO_B.jpg`,
        `${USER}/assemblage/PHOTO_B.webp`,
        `${USER}/assemblage/manches/a01.webp`,
      ].sort(),
    );
    expect(run.upload).toHaveBeenCalledWith(`${USER}/assemblage/PHOTO_A.jpg`, FAKE_JPEG, 'image/jpeg');
    expect(run.upload).toHaveBeenCalledWith(`${USER}/assemblage/PHOTO_A.webp`, FAKE_WEBP, 'image/webp');

    // Les fiches partent après les fichiers, en un seul envoi ici.
    expect(run.send).toHaveBeenCalledTimes(1);
    expect(run.batches[0].items.map((item) => [item.legacy_id, item.photo_path])).toEqual([
      ['a01', `${USER}/assemblage/PHOTO_A.jpg`],
      ['a19', `${USER}/assemblage/PHOTO_A.jpg`],
      ['a18', `${USER}/assemblage/PHOTO_B.jpg`],
    ]);
    expect(run.progress).toEqual([
      'check',
      'photos 0/2',
      'photos 1/2',
      'photos 2/2',
      'sleeves 0/1',
      'sleeves 1/1',
      'save 0/1',
      'save 1/1',
    ]);
    if (outcome.ok) {
      expect(assemblySummary(outcome)).toBe('3 pièces importées : 3 créées, 0 mise à jour.');
      expect(assemblyDetail(outcome)).toBe('2 photos envoyées, 1 image de manches.');
    }
  });

  it("n'envoie rien si un fichier manque ou n'est pas du bon type", async () => {
    const missing = zipSync({
      'manifest.json': strToU8(JSON.stringify(fakeManifest())),
      'photos/PHOTO_A.jpg': FAKE_JPEG,
      'photos/PHOTO_A.webp': FAKE_WEBP,
      'photos/PHOTO_B.jpg': FAKE_JPEG,
      'photos/PHOTO_B.webp': FAKE_WEBP,
    });
    let run = deps();
    await expect(importAssemblyPackage(open(missing), run.deps)).resolves.toEqual({
      ok: false,
      error: 'Fichier absent du zip : manches/a01.webp.',
    });
    expect(run.upload).not.toHaveBeenCalled();
    expect(run.send).not.toHaveBeenCalled();

    run = deps();
    const wrongType = packageZip({ 'photos/PHOTO_B.webp': FAKE_JPEG });
    await expect(importAssemblyPackage(open(wrongType), run.deps)).resolves.toEqual({
      ok: false,
      error: "photos/PHOTO_B.webp n'est pas une image WebP.",
    });
    expect(run.upload).not.toHaveBeenCalled();
  });

  it("n'envoie rien si le manifeste est invalide", async () => {
    const run = deps();
    const manifest = fakeManifest({ items: [{ ...fakeManifest().items[0], category: 'pull' }] });
    await expect(importAssemblyPackage(open(packageZip({}, manifest)), run.deps)).resolves.toEqual({
      ok: false,
      error: 'Pièce a01 : catégorie inconnue (« pull »).',
    });
    expect(run.upload).not.toHaveBeenCalled();
    expect(run.send).not.toHaveBeenCalled();
  });

  it("n'enregistre aucune fiche si un envoi de fichier échoue", async () => {
    const run = deps();
    run.upload.mockImplementation(async (path: string) => !path.endsWith('PHOTO_B.webp'));
    await expect(importAssemblyPackage(open(packageZip()), run.deps)).resolves.toEqual({
      ok: false,
      error:
        "1 fichier n'a pas pu être envoyé. Vérifie la connexion et réessaie : l'import reprend sans doublon.",
    });
    expect(run.send).not.toHaveBeenCalled();
  });

  it('additionne les compteurs et relaie le refus du serveur', async () => {
    const run = deps({
      send: async (batch) => ({ ok: true, counts: { created: 0, updated: batch.items.length }, replaced: [] }),
    });
    const outcome = await importAssemblyPackage(open(packageZip()), run.deps);
    expect(outcome).toMatchObject({ ok: true, counts: { created: 0, updated: 3 } });
    if (outcome.ok) expect(assemblySummary(outcome)).toBe('3 pièces importées : 0 créée, 3 mises à jour.');

    const refused = deps({ send: async () => ({ ok: false, error: 'Connexion requise.' }) });
    await expect(importAssemblyPackage(open(packageZip()), refused.deps)).resolves.toEqual({
      ok: false,
      error: 'Connexion requise.',
    });
  });
});

describe('importAssemblyPackage : paquet avec bras pliés', () => {
  const LAYERS = {
    'bras/PHOTO_A.webp': FAKE_WEBP,
    'corps/PHOTO_A.webp': FAKE_WEBP,
    'manches-photo/PHOTO_A.webp': FAKE_WEBP,
  };

  it('envoie les couches une seule fois avec leur photo, puis les fiches avec les chemins Storage', async () => {
    const run = deps();
    const outcome = await importAssemblyPackage(open(packageZip(LAYERS, fakeArmsManifest())), run.deps);

    expect(outcome).toEqual({ ok: true, counts: { created: 3, updated: 0 }, photos: 2, arms: 1, sleeves: 1 });
    const paths = run.upload.mock.calls.map(([path]) => path);
    expect(paths.sort()).toEqual(
      [
        `${USER}/assemblage/PHOTO_A.jpg`,
        `${USER}/assemblage/PHOTO_A.webp`,
        `${USER}/assemblage/bras/PHOTO_A.webp`,
        `${USER}/assemblage/corps/PHOTO_A.webp`,
        `${USER}/assemblage/manches-photo/PHOTO_A.webp`,
        `${USER}/assemblage/PHOTO_B.jpg`,
        `${USER}/assemblage/PHOTO_B.webp`,
        `${USER}/assemblage/manches/a01.webp`,
      ].sort(),
    );
    expect(run.upload).toHaveBeenCalledWith(`${USER}/assemblage/corps/PHOTO_A.webp`, FAKE_WEBP, 'image/webp');
    // La progression compte toujours les photos (leurs couches comprises).
    expect(run.progress.slice(0, 4)).toEqual(['check', 'photos 0/2', 'photos 1/2', 'photos 2/2']);

    const [jacket, bottom, dress] = run.batches[0].items;
    expect(jacket.assembly.photo.arms?.arms.path).toBe(`${USER}/assemblage/bras/PHOTO_A.webp`);
    expect(bottom.assembly.photo.arms?.body.path).toBe(`${USER}/assemblage/corps/PHOTO_A.webp`);
    expect(dress.assembly.photo).not.toHaveProperty('arms');
    if (outcome.ok) expect(assemblyDetail(outcome)).toBe('2 photos envoyées (1 avec les bras pliés), 1 image de manches.');
  });

  it("n'envoie rien si une couche annoncée manque ou n'est pas du WebP", async () => {
    let run = deps();
    const partial = Object.fromEntries(Object.entries(LAYERS).filter(([name]) => name !== 'corps/PHOTO_A.webp'));
    await expect(importAssemblyPackage(open(packageZip(partial, fakeArmsManifest())), run.deps)).resolves.toEqual({
      ok: false,
      error: 'Fichier absent du zip : corps/PHOTO_A.webp.',
    });
    expect(run.upload).not.toHaveBeenCalled();

    run = deps();
    const wrongType = packageZip({ ...LAYERS, 'bras/PHOTO_A.webp': FAKE_JPEG }, fakeArmsManifest());
    await expect(importAssemblyPackage(open(wrongType), run.deps)).resolves.toEqual({
      ok: false,
      error: "bras/PHOTO_A.webp n'est pas une image WebP.",
    });
    expect(run.upload).not.toHaveBeenCalled();
  });

  it("n'envoie rien si les bras pliés sont illisibles", async () => {
    const run = deps();
    const outcome = await importAssemblyPackage(open(packageZip(LAYERS, fakeArmsManifest({ v: 2 }))), run.deps);
    expect(outcome).toEqual({
      ok: false,
      error: 'Photo PHOTO_A : bras pliés illisibles (couches, bords, poignets ou manches).',
    });
    expect(run.upload).not.toHaveBeenCalled();
    expect(run.send).not.toHaveBeenCalled();
  });

  it("un paquet sans bras pliés ne cherche aucune couche (rien de plus n'est envoyé)", async () => {
    const run = deps();
    const outcome = await importAssemblyPackage(open(packageZip(LAYERS)), run.deps);
    expect(outcome).toMatchObject({ ok: true, photos: 2, arms: 0 });
    expect(run.upload.mock.calls.some(([path]) => /\/(bras|corps|manches-photo)\//.test(path))).toBe(false);
    if (outcome.ok) expect(assemblyDetail(outcome)).toBe('2 photos envoyées, 1 image de manches.');
  });
});

describe('importAssemblyPackage : fichiers remplacés', () => {
  /** Chaque envoi dit avoir remplacé un fichier propre à sa pièce, et un fichier commun. */
  function replacing(events: string[], failOn?: string) {
    return async (batch: AssemblyBatch): Promise<AssemblyActionResult> => {
      const ids = batch.items.map((item) => item.legacy_id);
      events.push(`send ${ids.join(',')}`);
      if (failOn && ids.includes(failOn)) return { ok: false, error: "L'import a échoué. Réessaie : il reprend sans doublon." };
      return { ok: true, counts: { created: 0, updated: ids.length }, replaced: [...ids.map((id) => `${USER}/ancien-${id}.jpg`), `${USER}/commun.jpg`] };
    };
  }

  it('supprimés une seule fois, après le dernier envoi, avec ceux de tous les envois', async () => {
    split.perItem = true;
    try {
      const events: string[] = [];
      const run = deps({ send: replacing(events) });
      run.finish.mockImplementation(async (cleanup) => {
        events.push(`finish ${cleanup.paths.length}`);
        return { ok: true };
      });
      const outcome = await importAssemblyPackage(open(packageZip()), run.deps);
      expect(outcome).toMatchObject({ ok: true, counts: { created: 0, updated: 3 } });
      expect(events).toEqual(['send a01', 'send a19', 'send a18', 'finish 4']);
      expect(run.finish).toHaveBeenCalledWith({
        paths: [`${USER}/ancien-a01.jpg`, `${USER}/commun.jpg`, `${USER}/ancien-a19.jpg`, `${USER}/ancien-a18.jpg`],
      });
    } finally {
      split.perItem = false;
    }
  });

  it("un envoi refusé : rien n'est supprimé, pas même ce qu'ont remplacé les envois d'avant", async () => {
    split.perItem = true;
    try {
      const events: string[] = [];
      const run = deps({ send: replacing(events, 'a19') });
      await expect(importAssemblyPackage(open(packageZip()), run.deps)).resolves.toMatchObject({ ok: false });
      expect(events).toEqual(['send a01', 'send a19']);
      expect(run.finish).not.toHaveBeenCalled();
    } finally {
      split.perItem = false;
    }
  });

  it("rien de remplacé : pas d'appel ; fin en échec : l'import reste réussi", async () => {
    const quiet = deps();
    await expect(importAssemblyPackage(open(packageZip()), quiet.deps)).resolves.toMatchObject({ ok: true });
    expect(quiet.finish).not.toHaveBeenCalled();

    const run = deps({ send: replacing([]) });
    run.finish.mockRejectedValue(new Error('réseau'));
    await expect(importAssemblyPackage(open(packageZip()), run.deps)).resolves.toMatchObject({
      ok: true,
      counts: { created: 0, updated: 3 },
    });
    expect(run.finish).toHaveBeenCalledTimes(1);
  });
});
