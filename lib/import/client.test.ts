import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import type { ImportActionResult, ImportBatch } from './batches';
import { MAX_JSON_BYTES, detailLine, importPrototypeFile, isZip, summaryLine, type ImportDeps } from './client';
import { MAX_IMAGE_BYTES } from './images';

const USER = '0b7c7a2e-5f0e-4b8e-9a51-0e3c0f6d9a11';
const NOW = new Date('2026-10-24T08:00:00.000Z');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const SVG = strToU8('<svg xmlns="http://www.w3.org/2000/svg"/>');

function piece(id: string, photo: string | null, cutout: string | null) {
  return {
    id,
    category: 'haut',
    name: `Pièce ${id}`,
    photo,
    cutout,
    color: null,
    warmth: 'moyen',
    rain: false,
    occasions: ['quotidien'],
    status: 'dispo',
    createdAt: '2026-07-04T16:00:00.000Z',
  };
}

const DB = {
  version: 1,
  settings: { city: { name: 'Paris', lat: 48.8566, lon: 2.3522, timezone: 'Europe/Paris' } },
  pieces: [
    piece('p_jpeg', 'p_jpeg.jpg', 'p_jpeg-cutout.png'),
    piece('p_svg', 'p_svg.svg', null),
    piece('p_absent', 'p_absent.jpg', 'p_absent-cutout.png'),
    piece('p_badcut', 'p_badcut.jpg', 'p_badcut-cutout.png'),
  ],
  wears: [{ date: '2026-10-01', haut: 'p_jpeg', veste: null, bas: null }],
  refusals: [],
  plans: {},
  composites: [],
};

function dressingZip() {
  return zipSync({
    'Dressing/db.json': strToU8(JSON.stringify(DB)),
    'Dressing/photos/p_jpeg.jpg': JPEG,
    'Dressing/photos/p_jpeg-cutout.png': PNG,
    'Dressing/photos/p_svg.svg': SVG,
    'Dressing/photos/p_badcut.jpg': JPEG,
    'Dressing/photos/p_badcut-cutout.png': JPEG, // un détourage doit être un PNG
  });
}

/**
 * Même zip, mais dont le répertoire central annonce pour `name` une taille décompressée de `size`
 * octets (comme une zip bomb). L'entrée doit être « stockée » (level 0) : si elle était lue malgré
 * tout, fflate rendrait ses vrais octets, et l'image passerait.
 */
function withDeclaredSize(zip: Uint8Array, name: string, size: number): Uint8Array {
  const bytes = zip.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const encoded = strToU8(name);
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue; // en-tête du répertoire central
    const nameLength = view.getUint16(i + 28, true);
    const candidate = bytes.subarray(i + 46, i + 46 + nameLength);
    if (nameLength === encoded.length && candidate.every((byte, j) => byte === encoded[j])) {
      view.setUint32(i + 24, size, true); // taille décompressée
      return bytes;
    }
  }
  throw new Error(`Entrée absente du zip : ${name}`);
}

function storedZip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, [data, { level: 0 }]])));
}

function deps(overrides: Partial<ImportDeps> = {}) {
  const sent: ImportBatch[] = [];
  const upload = vi.fn<ImportDeps['upload']>(async () => true);
  const send = vi.fn(async (batch: ImportBatch): Promise<ImportActionResult> => {
    sent.push(batch);
    return {
      ok: true,
      counts: {
        items: batch.items.length,
        withoutCutout: batch.items.filter((i) => !i.cutout_path).length,
        history: batch.history.length,
        refusals: batch.refusals.length,
        plans: batch.plans.length,
        city: batch.city?.name ?? null,
      },
    };
  });
  return { sent, upload, send, value: { userId: USER, now: NOW, upload, send, ...overrides } };
}

describe('importPrototypeFile', () => {
  it('zip : envoie les images autorisées dans Storage, puis les fiches avec leurs chemins', async () => {
    const { sent, upload, value } = deps();
    const outcome = await importPrototypeFile(dressingZip(), value);

    expect(upload.mock.calls.map(([path, , type]) => [path, type]).sort()).toEqual([
      [`${USER}/import/p_badcut-photo.jpg`, 'image/jpeg'],
      [`${USER}/import/p_jpeg-cutout.png`, 'image/png'],
      [`${USER}/import/p_jpeg-photo.jpg`, 'image/jpeg'],
    ]);
    expect(sent).toHaveLength(1);
    const items = Object.fromEntries(sent[0].items.map((item) => [item.legacy_id, item]));
    expect(items.p_jpeg.photo_path).toBe(`${USER}/import/p_jpeg-photo.jpg`);
    expect(items.p_jpeg.cutout_path).toBe(`${USER}/import/p_jpeg-cutout.png`);
    expect(items.p_svg).not.toHaveProperty('photo_path'); // SVG refusé : fiche importée sans photo
    expect(items.p_absent).not.toHaveProperty('photo_path');
    expect(items.p_badcut).not.toHaveProperty('cutout_path');
    expect(sent[0].city?.name).toBe('Paris');

    expect(outcome).toEqual({
      ok: true,
      counts: { items: 4, withoutCutout: 3, history: 1, refusals: 0, plans: 0, city: 'Paris' },
      ignored: 0,
      skippedImages: 4, // SVG, photo absente, détourage absent, détourage JPEG
      failedUploads: 0,
    });
    if (outcome.ok) expect(summaryLine(outcome.counts)).toBe('4 pièces importées, 3 photos à refaire.');
  });

  it('db.json seul : aucune image envoyée, aucun chemin dans les fiches', async () => {
    const { sent, upload, value } = deps();
    const outcome = await importPrototypeFile(strToU8(JSON.stringify(DB)), value);
    expect(outcome.ok).toBe(true);
    expect(upload).not.toHaveBeenCalled();
    for (const item of sent[0].items) {
      expect(item).not.toHaveProperty('photo_path');
      expect(item).not.toHaveProperty('cutout_path');
    }
  });

  it("un envoi d'image qui échoue n'empêche pas l'import de la fiche", async () => {
    const { sent, value } = deps({ upload: vi.fn(async (path: string) => !path.endsWith('cutout.png')) });
    const outcome = await importPrototypeFile(dressingZip(), value);
    expect(outcome.ok && outcome.failedUploads).toBe(1);
    const jpeg = sent[0].items.find((item) => item.legacy_id === 'p_jpeg');
    expect(jpeg?.photo_path).toBeDefined();
    expect(jpeg).not.toHaveProperty('cutout_path');
  });

  it("s'arrête au premier envoi refusé par le serveur et renvoie son message", async () => {
    const send = vi.fn(async (): Promise<ImportActionResult> => ({ ok: false, error: 'Connexion requise.' }));
    const { value } = deps({ send });
    expect(await importPrototypeFile(dressingZip(), value)).toEqual({ ok: false, error: 'Connexion requise.' });
  });

  it('refuse un zip sans db.json, un fichier illisible ou sans pièce', async () => {
    const { value } = deps();
    const noDb = zipSync({ 'Dressing/photos/a.jpg': JPEG });
    expect(await importPrototypeFile(noDb, value)).toEqual({ ok: false, error: 'Aucun db.json dans ce zip.' });
    expect((await importPrototypeFile(strToU8('pas du json'), value)).ok).toBe(false);
    expect(await importPrototypeFile(strToU8(JSON.stringify({ pieces: [] })), value)).toEqual({
      ok: false,
      error: 'Aucune pièce à importer dans ce db.json.',
    });
  });

  it('refuse une image annoncée trop lourde par le zip sans la décompresser', async () => {
    const zip = storedZip({
      'Dressing/db.json': strToU8(JSON.stringify({ ...DB, pieces: [piece('p_jpeg', 'p_jpeg.jpg', 'p_jpeg-cutout.png')] })),
      'Dressing/photos/p_jpeg.jpg': JPEG,
      'Dressing/photos/p_jpeg-cutout.png': PNG,
    });
    // Témoin : sans taille trafiquée, la photo stockée passe.
    const control = deps();
    await importPrototypeFile(zip, control.value);
    expect(control.upload.mock.calls.map(([path]) => path)).toContain(`${USER}/import/p_jpeg-photo.jpg`);

    const { upload, sent, value } = deps();
    const outcome = await importPrototypeFile(
      withDeclaredSize(zip, 'Dressing/photos/p_jpeg.jpg', MAX_IMAGE_BYTES + 1),
      value,
    );
    expect(outcome).toMatchObject({ ok: true, skippedImages: 1, failedUploads: 0 });
    expect(upload.mock.calls.map(([path]) => path)).toEqual([`${USER}/import/p_jpeg-cutout.png`]);
    expect(sent[0].items[0]).not.toHaveProperty('photo_path');
  });

  it('refuse un db.json annoncé trop gros par le zip avant de le décompresser', async () => {
    const zip = storedZip({ 'Dressing/db.json': strToU8(JSON.stringify(DB)) });
    const { upload, send, value } = deps();
    expect(await importPrototypeFile(withDeclaredSize(zip, 'Dressing/db.json', MAX_JSON_BYTES + 1), value)).toEqual({
      ok: false,
      error: 'Ce db.json est trop gros pour être importé.',
    });
    expect(upload).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    // Témoin : le même zip, avec sa vraie taille, s'importe.
    expect((await importPrototypeFile(zip, deps().value)).ok).toBe(true);
  });

  it("ne fait aucun appel réseau lui-même (ni Bria, ni Claude) : seulement upload et send", async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { value } = deps();
    await importPrototypeFile(dressingZip(), value);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('signale la progression', async () => {
    const onProgress = vi.fn();
    const { value } = deps({ onProgress });
    await importPrototypeFile(dressingZip(), value);
    expect(onProgress).toHaveBeenCalledWith({ step: 'read' });
    expect(onProgress).toHaveBeenCalledWith({ step: 'photos', done: 4, total: 4 });
    expect(onProgress).toHaveBeenLastCalledWith({ step: 'save', done: 1, total: 1 });
  });
});

describe('textes du résultat', () => {
  it('reconnaît un zip à ses octets', () => {
    expect(isZip(zipSync({ 'a.txt': strToU8('a') }))).toBe(true);
    expect(isZip(strToU8('{"pieces":[]}'))).toBe(false);
  });

  it('accorde les pluriels et omet ce qui vaut zéro', () => {
    const counts = { items: 1, withoutCutout: 0, history: 10, refusals: 1, plans: 0, city: 'Paris' };
    expect(summaryLine(counts)).toBe('1 pièce importée.');
    expect(summaryLine({ ...counts, items: 9, withoutCutout: 1 })).toBe('9 pièces importées, 1 photo à refaire.');
    expect(detailLine({ ok: true, counts, ignored: 0, skippedImages: 0, failedUploads: 0 })).toBe(
      "10 jours d'historique, 1 refus, ville : Paris.",
    );
    expect(
      detailLine({
        ok: true,
        counts: { ...counts, history: 0, refusals: 0, city: null },
        ignored: 2,
        skippedImages: 0,
        failedUploads: 0,
      }),
    ).toBe('2 fiches illisibles ignorées.');
  });
});
