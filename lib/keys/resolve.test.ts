import { describe, expect, it } from 'vitest';
import type { KeyMap } from '@/lib/types';
import { matchesBinding, mappedAction, resolveKey } from './resolve';

// Un clavier aux touches inhabituelles, enregistré par le test des touches (?touches=test, docs/conception.md §5).
const GAMEPAD: KeyMap = {
  next: { code: 'KeyD', key: 'd' },
  previous: { code: 'KeyA', key: 'a' },
  accept: { code: 'KeyJ', key: 'j' },
  refuse: { code: 'KeyK', key: 'k' },
};

describe('matchesBinding', () => {
  it('compare sur code quand les deux en ont un, même si key diffère (AZERTY)', () => {
    expect(matchesBinding({ code: 'KeyA', key: 'a' }, { code: 'KeyA', key: 'q' })).toBe(true);
    expect(matchesBinding({ code: 'KeyA', key: 'a' }, { code: 'KeyQ', key: 'a' })).toBe(false);
  });

  it('compare sur key quand un code manque', () => {
    expect(matchesBinding({ code: '', key: 'MediaPlayPause' }, { code: '', key: 'MediaPlayPause' })).toBe(true);
    expect(matchesBinding({ code: 'KeyD', key: 'd' }, { code: '', key: 'd' })).toBe(true);
    expect(matchesBinding({ code: '', key: 'd' }, { code: 'KeyD', key: 'd' })).toBe(true);
  });

  it('« Unidentified » et une key vide ne correspondent jamais', () => {
    expect(matchesBinding({ code: '', key: 'Unidentified' }, { code: '', key: 'Unidentified' })).toBe(false);
    expect(matchesBinding({ code: '', key: '' }, { code: '', key: '' })).toBe(false);
  });
});

describe('resolveKey', () => {
  it('suit key_map', () => {
    expect(resolveKey({ code: 'KeyD', key: 'd' }, GAMEPAD)).toBe('next');
    expect(resolveKey({ code: 'KeyA', key: 'a' }, GAMEPAD)).toBe('previous');
    expect(resolveKey({ code: 'KeyJ', key: 'j' }, GAMEPAD)).toBe('accept');
    expect(resolveKey({ code: 'KeyK', key: 'k' }, GAMEPAD)).toBe('refuse');
    expect(resolveKey({ code: 'KeyX', key: 'x' }, GAMEPAD)).toBeNull();
  });

  it('les touches de PC servent quand elles ne figurent pas dans key_map', () => {
    expect(resolveKey({ code: 'ArrowRight', key: 'ArrowRight' }, GAMEPAD)).toBe('next');
    expect(resolveKey({ code: 'ArrowLeft', key: 'ArrowLeft' }, GAMEPAD)).toBe('previous');
    expect(resolveKey({ code: 'Enter', key: 'Enter' }, GAMEPAD)).toBe('accept');
    expect(resolveKey({ code: 'NumpadEnter', key: 'Enter' }, {})).toBe('accept');
    expect(resolveKey({ code: 'Backspace', key: 'Backspace' }, {})).toBe('refuse');
    expect(resolveKey({ code: 'KeyR', key: 'r' }, GAMEPAD)).toBe('restart');
    expect(resolveKey({ code: 'KeyR', key: 'R' }, {})).toBe('restart');
    expect(resolveKey({ code: 'ArrowUp', key: 'ArrowUp' }, GAMEPAD)).toBe('bottomNext');
    expect(resolveKey({ code: 'ArrowDown', key: 'ArrowDown' }, GAMEPAD)).toBe('bottomPrevious');
    expect(resolveKey({ code: 'KeyV', key: 'v' }, GAMEPAD)).toBe('jacket');
    expect(resolveKey({ code: 'KeyV', key: 'V' }, {})).toBe('jacket');
  });

  it('une touche présente dans key_map suit toujours key_map, même si c’est une touche de PC', () => {
    const map: KeyMap = {
      ...GAMEPAD,
      accept: { code: 'ArrowRight', key: 'ArrowRight' },
      refuse: { code: 'Enter', key: 'Enter' },
    };
    expect(resolveKey({ code: 'ArrowRight', key: 'ArrowRight' }, map)).toBe('accept');
    expect(resolveKey({ code: 'Enter', key: 'Enter' }, map)).toBe('refuse');
    // ArrowLeft n'y figure pas : touche de PC.
    expect(resolveKey({ code: 'ArrowLeft', key: 'ArrowLeft' }, map)).toBe('previous');
  });

  it('ne lit jamais les propriétés héritées d’un objet', () => {
    expect(resolveKey({ code: '', key: 'toString' }, {})).toBeNull();
    expect(resolveKey({ code: '', key: 'constructor' }, {})).toBeNull();
  });

  it('mappedAction ne renvoie que key_map', () => {
    expect(mappedAction({ code: 'ArrowRight', key: 'ArrowRight' }, GAMEPAD)).toBeNull();
    expect(mappedAction({ code: 'KeyK', key: 'k' }, GAMEPAD)).toBe('refuse');
  });
});
