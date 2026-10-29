import { connection } from 'next/server';
import { authErrorResponse, requireUser } from '@/lib/server/auth';

// Exemple de route protégée : 401 sans session, 403 pour un autre compte que ALLOWED_USER_ID.
export async function GET() {
  // Avant le try : au build, Next.js interrompt ici le pré-rendu, et cette interruption ne doit
  // pas être attrapée par le catch ci-dessous.
  await connection();
  try {
    const user = await requireUser();
    return Response.json(user, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
