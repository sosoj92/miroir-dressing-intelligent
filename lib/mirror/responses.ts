// Réponses JSON des routes /api/miroir/* : jamais mises en cache, erreurs courtes en français.

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** Entrée refusée (400) : `{ ok: false, error }`, sans détail interne. */
export function badRequest(error: string): Response {
  return json({ ok: false, error }, 400);
}
