/**
 * Nom d'une erreur pour les journaux (et son code Postgres ou HTTP s'il y en a un) : jamais son
 * message, qui pourrait citer une URL signée ou un détail interne.
 */
export function errorName(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Erreur inconnue';
  const { name, code, status, statusCode } = error as Record<string, unknown>;
  const label = typeof name === 'string' && name ? name : 'Erreur';
  const detail = [code, status, statusCode].find(
    (value) => (typeof value === 'string' && /^[\w.-]{1,16}$/.test(value)) || typeof value === 'number',
  );
  return detail === undefined ? label : `${label} (${detail})`;
}
