import Link from 'next/link';
import type { UserCheck } from '@/lib/server/auth';
import { pressFeedback } from './buttons';

// Ce qu'affiche un écran du téléphone quand checkUser() échoue (modèle : app/gestion/page.tsx).
// 503 (Supabase pas encore configuré) affiche aussi « Connexion requise ». « Connecte-toi » et
// « Changer de compte » ont le même rôle : la même écriture, celle d'un bouton texte.

export function SignedOut({ status }: { status: Extract<UserCheck, { ok: false }>['status'] }) {
  if (status === 403) {
    return (
      <>
        <p className="text-body">Ce compte n&apos;a pas accès à Mon Dressing.</p>
        <Link href="/connexion" className={`inline-flex min-h-11 items-center self-start text-body text-accent ${pressFeedback}`}>
          Changer de compte
        </Link>
      </>
    );
  }

  return (
    <>
      <p className="text-body">Connexion requise</p>
      <Link href="/connexion" className={`inline-flex min-h-11 items-center self-start text-body text-accent ${pressFeedback}`}>
        Connecte-toi
      </Link>
    </>
  );
}
