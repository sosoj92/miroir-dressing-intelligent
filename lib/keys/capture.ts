import { KEY_ACTIONS, type KeyAction, type KeyBinding, type KeyMap } from '@/lib/types';
import { UNIDENTIFIED_KEY, mappedAction, type KeyInput } from './resolve';

// Écran « Test des touches » (docs/conception.md §5), en mode guidé : machine à états pure.
// On demande une touche par action, dans l'ordre de KEY_ACTIONS, et on garde event.code et event.key.

/** Touches de modification : seules, elles ne comptent pas. */
export const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'Super',
  'Hyper',
  'Fn',
  'FnLock',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Symbol',
  'SymbolLock',
]);

/** À quoi sert déjà une touche, pour « Cette touche sert déjà à … ». */
export const KEY_ACTION_PURPOSES: Record<KeyAction, string> = {
  next: 'passer au haut suivant',
  previous: 'revenir au haut précédent',
  bottomNext: 'passer au bas suivant',
  bottomPrevious: 'revenir au bas précédent',
  jacket: 'changer de veste',
  accept: 'accepter',
  refuse: 'refuser',
  restart: 'recommencer le choix',
};

export type KeyTestState = {
  /** Index dans KEY_ACTIONS de l'action demandée. */
  step: number;
  /** Touches déjà choisies pendant ce test. */
  bindings: KeyMap;
  /** Dernière touche reçue, affichée en direct. */
  received: KeyBinding | null;
  error: string | null;
};

export type KeyTestResult = { test: KeyTestState; done: KeyMap | null };

export function startKeyTest(): KeyTestState {
  return { step: 0, bindings: {}, received: null, error: null };
}

/** Action demandée à cette étape. */
export function currentKeyAction(test: KeyTestState): KeyAction {
  return KEY_ACTIONS[Math.min(test.step, KEY_ACTIONS.length - 1)];
}

export function isModifierOnly(input: KeyInput): boolean {
  return MODIFIER_KEYS.has(input.key);
}

/** Une touche qu'on saura reconnaître plus tard : un `code`, ou une `key` nommée. */
export function isUsableKey(input: KeyInput): boolean {
  return input.code !== '' || (input.key !== '' && input.key !== UNIDENTIFIED_KEY);
}

/** Touches nommées, par `event.key` puis par `event.code`, en mots (écran lu à 1–2 m). */
const KEY_WORDS: ReadonlyMap<string, string> = new Map([
  ['ArrowRight', 'flèche droite'],
  ['ArrowLeft', 'flèche gauche'],
  ['ArrowUp', 'flèche vers le haut'],
  ['ArrowDown', 'flèche vers le bas'],
  ['Enter', 'Entrée'],
  ['Backspace', 'Retour arrière'],
  [' ', 'Espace'],
  ['Shift', 'Maj'],
  ['Control', 'Ctrl'],
  ['Alt', 'Alt'],
  ['Escape', 'Échap'],
  ['Tab', 'Tab'],
]);

const CODE_WORDS: ReadonlyMap<string, string> = new Map([
  ['ArrowRight', 'flèche droite'],
  ['ArrowLeft', 'flèche gauche'],
  ['ArrowUp', 'flèche vers le haut'],
  ['ArrowDown', 'flèche vers le bas'],
  ['Enter', 'Entrée'],
  ['NumpadEnter', 'Entrée'],
  ['Backspace', 'Retour arrière'],
  ['Space', 'Espace'],
  ['ShiftLeft', 'Maj'],
  ['ShiftRight', 'Maj'],
  ['ControlLeft', 'Ctrl'],
  ['ControlRight', 'Ctrl'],
  ['AltLeft', 'Alt'],
  ['Escape', 'Échap'],
  ['Tab', 'Tab'],
]);

/**
 * Ce que reçoit l'app, en mots (docs/conception.md §5) : « flèche droite », « Entrée », « Maj », la lettre ou le
 * chiffre tapé (« D », « 5 »). Une touche inconnue garde son code brut (« MediaPlayPause · … »),
 * utile pour comprendre ce qu'envoie un clavier inhabituel.
 */
export function describeKey(binding: KeyBinding): string {
  const { code, key } = binding;
  const named = KEY_WORDS.get(key);
  if (named) return named;
  // Un caractère : celui que donne la disposition du clavier (« a » sur la touche KeyQ d'un AZERTY).
  if ([...key].length === 1 && key.trim() !== '') return key.toLocaleUpperCase('fr-FR');
  const byCode = CODE_WORDS.get(code);
  if (byCode) return byCode;
  const character = /^Key([A-Z])$/.exec(code) ?? /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (character) return character[1];
  return [code || 'sans code', key || 'sans nom'].join(' · ');
}

/** Traite une touche pendant le test. `done` porte la correspondance complète à la fin. */
export function keyTestInput(test: KeyTestState, input: KeyInput): KeyTestResult {
  const received: KeyBinding = { code: input.code, key: input.key };
  if (isModifierOnly(input)) return { test: { ...test, received }, done: null };
  if (!isUsableKey(input)) {
    return {
      test: { ...test, received, error: 'Touche non reconnue. Essaie une autre touche.' },
      done: null,
    };
  }

  const taken = mappedAction(input, test.bindings);
  if (taken) {
    return {
      test: { ...test, received, error: `Cette touche sert déjà à ${KEY_ACTION_PURPOSES[taken]}.` },
      done: null,
    };
  }

  const action = currentKeyAction(test);
  const bindings: KeyMap = { ...test.bindings, [action]: received };
  const step = test.step + 1;
  const next: KeyTestState = { step, bindings, received, error: null };
  return { test: next, done: step >= KEY_ACTIONS.length ? bindings : null };
}
