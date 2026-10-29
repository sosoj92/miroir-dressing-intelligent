// Chemins des photos dans le bucket privé `items` (AGENTS.md : tout est rangé sous <user_id>/…).
// Module pur, utilisé par le navigateur (envoi de la photo) et par le serveur (vérification).
// Côté serveur, ces vérifications complètent `assertOwnPath` (lib/server/storage.ts), qui reste
// obligatoire pour tout chemin reçu du navigateur.

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PHOTO_FILE = new RegExp(`^${UUID_SOURCE}\\.jpg$`);
const CUTOUT_FILE = new RegExp(`^${UUID_SOURCE}-cutout\\.png$`);

/** Photo réduite envoyée par le téléphone : `<userId>/<uuid>.jpg`. */
export function photoPathFor(userId: string, uuid: string): string {
  return `${userId}/${uuid}.jpg`;
}

/** Détourage copié depuis fal.ai : `<userId>/<uuid>-cutout.png` (un nouveau nom à chaque détourage). */
export function cutoutPathFor(userId: string, uuid: string): string {
  return `${userId}/${uuid}-cutout.png`;
}

function fileOf(userId: string, path: unknown): string | null {
  if (typeof path !== 'string') return null;
  const prefix = `${userId}/`;
  if (!path.startsWith(prefix)) return null;
  return path.slice(prefix.length);
}

/** Vrai pour une photo envoyée par l'écran d'ajout de ce compte. */
export function isUploadedPhotoPath(userId: string, path: unknown): path is string {
  const file = fileOf(userId, path);
  return file !== null && PHOTO_FILE.test(file);
}

/** Vrai pour un détourage enregistré par le serveur (ou PNG transparent envoyé par le téléphone) pour ce compte. */
export function isCutoutPath(userId: string, path: unknown): path is string {
  const file = fileOf(userId, path);
  return file !== null && CUTOUT_FILE.test(file);
}

/**
 * Uuid v4. `crypto.randomUUID` n'existe que sur une page sécurisée (HTTPS ou localhost) : sur le
 * téléphone, en test sur le réseau local (http://192.168…), on le fabrique avec getRandomValues.
 */
export function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
