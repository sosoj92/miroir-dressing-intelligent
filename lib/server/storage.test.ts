import { describe, expect, it } from 'vitest';
import { StoragePathError, assertOwnPath } from './storage';

const USER = '0a1b2c3d-0000-4000-8000-0000000000aa';

describe('lib/server/storage', () => {
  it("accepte un chemin rangé sous l'id du compte", () => {
    expect(assertOwnPath(USER, `${USER}/abc.jpg`)).toBe(`${USER}/abc.jpg`);
    expect(assertOwnPath(USER, `${USER}/import/p_1-cutout.png`)).toBe(`${USER}/import/p_1-cutout.png`);
  });

  it("refuse le dossier d'un autre compte, les « .. » et les caractères inattendus", () => {
    const other = '00000000-0000-4000-8000-000000000000';
    for (const path of [
      `${other}/abc.jpg`,
      `${USER}/../${other}/abc.jpg`,
      `${USER}//abc.jpg`,
      `${USER}`,
      `${USER}/`,
      `${USER}/a b.jpg`,
      `${USER}/abc.jpg?x=1`,
      `/${USER}/abc.jpg`,
    ]) {
      expect(() => assertOwnPath(USER, path), path).toThrow(StoragePathError);
    }
  });
});
