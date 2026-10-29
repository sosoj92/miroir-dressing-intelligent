import { KEY_ACTIONS, type KeyBinding, type KeyMap } from '@/lib/types';

// Lecture défensive de profile.key_map (jsonb) : on ne garde que les actions connues,
// avec un `code` ou une `key` sous forme de texte court.
const MAX_LENGTH = 64;

function asText(value: unknown): string {
  return typeof value === 'string' && value.length <= MAX_LENGTH ? value : '';
}

export function parseKeyMap(value: unknown): KeyMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const map: KeyMap = {};
  for (const action of KEY_ACTIONS) {
    const entry = source[action];
    if (!entry || typeof entry !== 'object') continue;
    const binding: KeyBinding = {
      code: asText((entry as Record<string, unknown>).code),
      key: asText((entry as Record<string, unknown>).key),
    };
    if (binding.code || binding.key) map[action] = binding;
  }
  return map;
}

export function isKeyMapEmpty(map: KeyMap): boolean {
  return KEY_ACTIONS.every((action) => !map[action]);
}
