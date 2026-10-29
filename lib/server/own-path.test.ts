import { describe, expect, it } from 'vitest';
import { ownPathOrNull } from './own-path';

const USER = '0a1b2c3d-0000-4000-8000-00000000a11d';
const OTHER = '0a1b2c3d-0000-4000-8000-0000000000ff';

describe('ownPathOrNull', () => {
  it('garde un chemin rangé sous le dossier du compte', () => {
    expect(ownPathOrNull(USER, `${USER}/a.jpg`)).toBe(`${USER}/a.jpg`);
    expect(ownPathOrNull(USER, `${USER}/import/p_1-cutout.png`)).toBe(`${USER}/import/p_1-cutout.png`);
  });

  it('refuse le reste sans lever d’exception', () => {
    for (const path of [`${OTHER}/a.jpg`, `${USER}/../${OTHER}/a.jpg`, `${USER}`, '', null, undefined, 42, `${USER}/${'x'.repeat(600)}`]) {
      expect(ownPathOrNull(USER, path)).toBeNull();
    }
  });
});
