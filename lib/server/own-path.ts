import 'server-only';
import { assertOwnPath } from './storage';

// Défense en profondeur avant toute URL signée : même un chemin lu en base passe par
// assertOwnPath (RLS de storage.objects refuse déjà les autres dossiers).

/** Chemin rangé sous `<userId>/…`, ou null (chemin absent, trop long ou refusé). */
export function ownPathOrNull(userId: string, path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 512) return null;
  try {
    return assertOwnPath(userId, path);
  } catch {
    return null;
  }
}
