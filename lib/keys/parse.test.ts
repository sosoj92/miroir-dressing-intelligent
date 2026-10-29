import { describe, expect, it } from 'vitest';
import { isKeyMapEmpty, parseKeyMap } from './parse';

describe('lib/keys/parse', () => {
  it('garde les actions connues et ignore le reste', () => {
    const map = parseKeyMap({
      next: { code: 'KeyD', key: 'd' },
      accept: { code: '', key: 'Enter' },
      jump: { code: 'KeyJ', key: 'j' },
      refuse: 'B',
      previous: { code: 42 },
    });
    expect(map).toEqual({ next: { code: 'KeyD', key: 'd' }, accept: { code: '', key: 'Enter' } });
  });

  it('renvoie une correspondance vide pour une valeur inattendue', () => {
    expect(parseKeyMap(null)).toEqual({});
    expect(parseKeyMap([])).toEqual({});
    expect(parseKeyMap('{}')).toEqual({});
    expect(isKeyMapEmpty({})).toBe(true);
    expect(isKeyMapEmpty({ refuse: { code: 'KeyB', key: 'b' } })).toBe(false);
  });
});
