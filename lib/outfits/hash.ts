// Départage déterministe des égalités (porté du prototype, shared/logic.js).

/**
 * Hachage 32 bits non signé FNV-1a sur les unités UTF-16 de la chaîne.
 * Sert à départager deux candidats de même score : la graine contient la date visée, donc l'ordre
 * des égalités change d'un jour à l'autre, mais jamais pour les mêmes entrées (ni Math.random ni horloge).
 */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
