import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { findDbJson, findPhotoEntry, folderOf, listZipEntries, readZipEntry } from './zip';
import {
  checkCutout,
  checkPhoto,
  importCutoutPath,
  importPhotoPath,
  MAX_IMAGE_BYTES,
  sniffImage,
} from './images';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP = strToU8('RIFF\x24\x00\x00\x00WEBPVP8 ');
const SVG = strToU8('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe('sniffImage', () => {
  it('reconnaît JPEG, PNG et WebP par leurs octets', () => {
    expect(sniffImage(JPEG)).toEqual({ ext: 'jpg', contentType: 'image/jpeg' });
    expect(sniffImage(PNG)).toEqual({ ext: 'png', contentType: 'image/png' });
    expect(sniffImage(WEBP)).toEqual({ ext: 'webp', contentType: 'image/webp' });
  });

  it('refuse le SVG, le GIF et les fichiers trop courts', () => {
    expect(sniffImage(SVG)).toBeNull();
    expect(sniffImage(strToU8('GIF89a'))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(strToU8('RIFF\x24\x00\x00\x00WAVE'))).toBeNull();
  });

  it('le détourage doit être un PNG, la photo peut être JPEG, PNG ou WebP', () => {
    expect(checkPhoto(JPEG).ok).toBe(true);
    expect(checkCutout(JPEG)).toEqual({ ok: false, reason: 'type' });
    expect(checkCutout(PNG).ok).toBe(true);
    expect(checkPhoto(SVG)).toEqual({ ok: false, reason: 'type' });
  });

  it('refuse une image plus lourde que la limite du bucket', () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(JPEG);
    expect(checkPhoto(big)).toEqual({ ok: false, reason: 'size' });
  });

  it('range les fichiers sous <userId>/import/<legacy_id>-…', () => {
    const user = '0b7c7a2e-5f0e-4b8e-9a51-0e3c0f6d9a11';
    expect(importPhotoPath(user, 'p_demo0001', 'jpg')).toBe(`${user}/import/p_demo0001-photo.jpg`);
    expect(importCutoutPath(user, 'p_demo0001')).toBe(`${user}/import/p_demo0001-cutout.png`);
  });
});

describe('zip du dossier Dressing/', () => {
  const zip = zipSync({
    'Dressing/db.json': strToU8('{"pieces":[]}'),
    'Dressing/photos/p_1.jpg': JPEG,
    'Dressing/photos/p_1-cutout.png': PNG,
    'Dressing/trash/p_2.jpg': JPEG,
    'Dressing/backups/db-2026-10-01.json': strToU8('{}'),
    '__MACOSX/Dressing/._db.json': strToU8('x'),
    '__MACOSX/Dressing/photos/._p_1.jpg': strToU8('x'),
  });

  it('liste les fichiers sans les métadonnées macOS', () => {
    const names = listZipEntries(zip).map((entry) => entry.name);
    expect(names.sort()).toEqual([
      'Dressing/backups/db-2026-10-01.json',
      'Dressing/db.json',
      'Dressing/photos/p_1-cutout.png',
      'Dressing/photos/p_1.jpg',
      'Dressing/trash/p_2.jpg',
    ]);
  });

  it('trouve db.json dans un sous-dossier ou à la racine', () => {
    const names = listZipEntries(zip).map((entry) => entry.name);
    expect(findDbJson(names)).toBe('Dressing/db.json');
    expect(findDbJson(['photos/a.jpg', 'db.json', 'vieux/Dressing/db.json'])).toBe('db.json');
    expect(findDbJson(['photos/a.jpg'])).toBeNull();
    expect(folderOf('Dressing/db.json')).toBe('Dressing/');
    expect(folderOf('db.json')).toBe('');
  });

  it("lit une seule entrée à la fois", () => {
    expect(readZipEntry(zip, 'Dressing/photos/p_1.jpg')).toEqual(JPEG);
    expect(new TextDecoder().decode(readZipEntry(zip, 'Dressing/db.json')!)).toBe('{"pieces":[]}');
    expect(readZipEntry(zip, 'Dressing/photos/absente.jpg')).toBeNull();
  });

  it('trouve les images par nom de fichier sous photos/, jamais dans trash/', () => {
    const names = listZipEntries(zip).map((entry) => entry.name);
    expect(findPhotoEntry(names, 'Dressing/', 'p_1.jpg')).toBe('Dressing/photos/p_1.jpg');
    expect(findPhotoEntry(names, 'Dressing/', 'p_2.jpg')).toBeNull();
    expect(findPhotoEntry(names, '', 'p_1-cutout.png')).toBe('Dressing/photos/p_1-cutout.png');
    expect(findPhotoEntry(names, 'Dressing/', '../db.json')).toBeNull();
  });
});
