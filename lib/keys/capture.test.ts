import { describe, expect, it } from 'vitest';
import type { KeyInput } from './resolve';
import { currentKeyAction, describeKey, keyTestInput, startKeyTest, type KeyTestState } from './capture';

function press(test: KeyTestState, input: KeyInput) {
  return keyTestInput(test, input);
}

describe('test des touches', () => {
  it('demande les huit actions dans l’ordre et rend la correspondance complète', () => {
    let test = startKeyTest();
    expect(currentKeyAction(test)).toBe('next');

    let result = press(test, { code: 'KeyD', key: 'd' });
    expect(result.done).toBeNull();
    test = result.test;
    expect(currentKeyAction(test)).toBe('previous');

    test = press(test, { code: 'KeyA', key: 'a' }).test;
    expect(currentKeyAction(test)).toBe('bottomNext');
    test = press(test, { code: 'KeyW', key: 'w' }).test;
    expect(currentKeyAction(test)).toBe('bottomPrevious');
    test = press(test, { code: 'KeyS', key: 's' }).test;
    expect(currentKeyAction(test)).toBe('jacket');
    test = press(test, { code: 'KeyV', key: 'v' }).test;
    expect(currentKeyAction(test)).toBe('accept');
    test = press(test, { code: 'KeyJ', key: 'j' }).test;
    expect(currentKeyAction(test)).toBe('refuse');

    result = press(test, { code: 'KeyK', key: 'k' });
    expect(result.done).toBeNull();
    test = result.test;
    expect(currentKeyAction(test)).toBe('restart');

    result = press(test, { code: 'KeyL', key: 'l' });
    expect(result.done).toEqual({
      next: { code: 'KeyD', key: 'd' },
      previous: { code: 'KeyA', key: 'a' },
      bottomNext: { code: 'KeyW', key: 'w' },
      bottomPrevious: { code: 'KeyS', key: 's' },
      jacket: { code: 'KeyV', key: 'v' },
      accept: { code: 'KeyJ', key: 'j' },
      refuse: { code: 'KeyK', key: 'k' },
      restart: { code: 'KeyL', key: 'l' },
    });
  });

  it('affiche en direct la touche reçue', () => {
    const { test } = press(startKeyTest(), { code: 'KeyD', key: 'd' });
    expect(test.received).toEqual({ code: 'KeyD', key: 'd' });
  });

  it('décrit la touche reçue en mots, le code brut seulement pour une touche inconnue', () => {
    expect(describeKey({ code: 'ArrowRight', key: 'ArrowRight' })).toBe('flèche droite');
    expect(describeKey({ code: 'ArrowLeft', key: 'ArrowLeft' })).toBe('flèche gauche');
    expect(describeKey({ code: 'ArrowUp', key: 'ArrowUp' })).toBe('flèche vers le haut');
    expect(describeKey({ code: 'ArrowDown', key: 'ArrowDown' })).toBe('flèche vers le bas');
    expect(describeKey({ code: 'Enter', key: 'Enter' })).toBe('Entrée');
    expect(describeKey({ code: 'Backspace', key: 'Backspace' })).toBe('Retour arrière');
    expect(describeKey({ code: 'Space', key: ' ' })).toBe('Espace');
    expect(describeKey({ code: 'ShiftLeft', key: 'Shift' })).toBe('Maj');
    expect(describeKey({ code: 'ControlRight', key: 'Control' })).toBe('Ctrl');
    // La lettre ou le chiffre seul, en majuscule ; celui que donne le clavier (AZERTY : KeyQ → A).
    expect(describeKey({ code: 'KeyD', key: 'd' })).toBe('D');
    expect(describeKey({ code: 'KeyQ', key: 'a' })).toBe('A');
    expect(describeKey({ code: 'Digit5', key: '5' })).toBe('5');
    // Sans `key` utilisable, le code suffit quand il est connu.
    expect(describeKey({ code: 'KeyV', key: 'Unidentified' })).toBe('V');
    expect(describeKey({ code: 'ArrowUp', key: '' })).toBe('flèche vers le haut');
    // Touche inconnue : ce que reçoit l'app, tel quel.
    expect(describeKey({ code: '', key: 'MediaPlayPause' })).toBe('sans code · MediaPlayPause');
    expect(describeKey({ code: 'F13', key: 'F13' })).toBe('F13 · F13');
  });

  it('refuse une touche déjà prise et le dit', () => {
    let test = press(startKeyTest(), { code: 'KeyD', key: 'd' }).test;
    test = press(test, { code: 'KeyA', key: 'a' }).test;
    const result = press(test, { code: 'KeyD', key: 'd' });
    expect(result.done).toBeNull();
    expect(result.test.step).toBe(2);
    expect(result.test.error).toBe('Cette touche sert déjà à passer au haut suivant.');

    const fixed = press(result.test, { code: 'KeyJ', key: 'j' }).test;
    expect(fixed.error).toBeNull();
    expect(fixed.step).toBe(3);
  });

  it('ignore les touches de modification seules', () => {
    const start = startKeyTest();
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']) {
      const result = press(start, { code: `${key}Left`, key });
      expect(result.test.step).toBe(0);
      expect(result.test.bindings).toEqual({});
      expect(result.test.received).toEqual({ code: `${key}Left`, key });
    }
  });

  it('refuse une touche que l’app ne pourra pas reconnaître', () => {
    const result = press(startKeyTest(), { code: '', key: 'Unidentified' });
    expect(result.test.step).toBe(0);
    expect(result.test.error).toMatch(/non reconnue/);
  });

  it('accepte une touche sans code mais nommée, ou avec code mais « Unidentified »', () => {
    expect(press(startKeyTest(), { code: '', key: 'MediaTrackNext' }).test.step).toBe(1);
    expect(press(startKeyTest(), { code: 'Gamepad0', key: 'Unidentified' }).test.step).toBe(1);
  });
});
