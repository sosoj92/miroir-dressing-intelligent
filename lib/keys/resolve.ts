import { KEY_ACTIONS, type KeyAction, type KeyBinding, type KeyMap } from '@/lib/types';

// Touches du clavier de secours (docs/conception.md §5 : le miroir se commande avec les bras, plus de manette) :
// fonction pure, sans DOM.
// Une touche présente dans key_map suit toujours key_map. Les touches de PC ne servent, pour
// tester, que si elles n'y figurent pas.

/** Ce que l'app retient d'un `KeyboardEvent`. */
export type KeyInput = { code: string; key: string };

/** Valeur de `event.key` quand le système ne sait pas nommer la touche (claviers Bluetooth). */
export const UNIDENTIFIED_KEY = 'Unidentified';

/** Touches de PC, par `event.key`, utilisées seulement si elles ne figurent pas dans key_map. */
export const PC_KEYS: ReadonlyMap<string, KeyAction> = new Map<string, KeyAction>([
  ['ArrowRight', 'next'],
  ['ArrowLeft', 'previous'],
  ['ArrowUp', 'bottomNext'],
  ['ArrowDown', 'bottomPrevious'],
  ['Enter', 'accept'],
  ['Backspace', 'refuse'],
  // Aucune touche de navigateur n'utilise « r » seule (Ctrl+R est laissé passer par le miroir).
  ['r', 'restart'],
  ['R', 'restart'],
  ['v', 'jacket'],
  ['V', 'jacket'],
]);

/**
 * Une touche correspond-elle à une liaison ? Comparaison sur `code` quand les deux en ont un,
 * sinon sur `key`. « Unidentified » ne correspond jamais à rien.
 */
export function matchesBinding(binding: KeyBinding, input: KeyInput): boolean {
  if (binding.code && input.code) return binding.code === input.code;
  return binding.key !== '' && binding.key !== UNIDENTIFIED_KEY && binding.key === input.key;
}

/** Action liée à cette touche dans key_map, ou null. */
export function mappedAction(input: KeyInput, keyMap: KeyMap): KeyAction | null {
  for (const action of KEY_ACTIONS) {
    const binding = keyMap[action];
    if (binding && matchesBinding(binding, input)) return action;
  }
  return null;
}

/** Action déclenchée par une touche : key_map d'abord, puis les touches de PC. */
export function resolveKey(input: KeyInput, keyMap: KeyMap): KeyAction | null {
  return mappedAction(input, keyMap) ?? PC_KEYS.get(input.key) ?? null;
}
