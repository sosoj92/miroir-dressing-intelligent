import 'server-only';

// Seul module qui lit les variables serveur (AGENTS.md, secrets — règle n° 1).
// Chaque valeur est lue au moment de l'appel, jamais au chargement du module : le build passe
// sans clés, et une variable absente n'est signalée que par la fonction qui en a besoin.
// Les messages d'erreur nomment la variable, jamais sa valeur.

export type ServerEnvName = 'ANTHROPIC_API_KEY' | 'FAL_KEY' | 'ALLOWED_USER_ID';

export type EnvErrorReason = 'absente' | 'invalide';

export class EnvError extends Error {
  readonly variable: ServerEnvName;
  readonly reason: EnvErrorReason;

  constructor(variable: ServerEnvName, reason: EnvErrorReason) {
    super(
      reason === 'absente'
        ? `Variable d'environnement absente : ${variable}. Renseigne-la dans .env.local en local, ou dans les variables Vercel en ligne.`
        : `Variable d'environnement invalide : ${variable}. Vérifie son format dans .env.local ou dans les variables Vercel.`,
    );
    this.name = 'EnvError';
    this.variable = variable;
    this.reason = reason;
  }
}

// Lectures littérales, une par variable.
const readers: Record<ServerEnvName, () => string | undefined> = {
  ANTHROPIC_API_KEY: () => process.env.ANTHROPIC_API_KEY,
  FAL_KEY: () => process.env.FAL_KEY,
  ALLOWED_USER_ID: () => process.env.ALLOWED_USER_ID,
};

function readRequired(name: ServerEnvName): string {
  const value = readers[name]()?.trim();
  if (!value) throw new EnvError(name, 'absente');
  return value;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function anthropicApiKey(): string {
  return readRequired('ANTHROPIC_API_KEY');
}

export function falKey(): string {
  return readRequired('FAL_KEY');
}

export type EnvState = 'définie' | 'absente' | 'invalide';

/**
 * État de ALLOWED_USER_ID pour /api/health (diagnostic d'installation) : un mot, jamais la valeur.
 * « invalide » : renseignée, mais ce n'est pas un uuid (UID mal copié).
 */
export function allowedUserIdState(): EnvState {
  const value = readers.ALLOWED_USER_ID()?.trim();
  if (!value) return 'absente';
  return UUID_PATTERN.test(value) ? 'définie' : 'invalide';
}

/** Id (uuid, en minuscules) du seul compte autorisé (docs/conception.md §4). */
export function allowedUserId(): string {
  const value = readRequired('ALLOWED_USER_ID');
  if (!UUID_PATTERN.test(value)) throw new EnvError('ALLOWED_USER_ID', 'invalide');
  return value.toLowerCase();
}
