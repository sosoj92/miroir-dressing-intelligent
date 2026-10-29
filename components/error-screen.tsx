'use client';

import { usePathname } from 'next/navigation';
import { pressFeedback } from '@/components/gestion/buttons';
import { PhonePage } from '@/components/gestion/page-shell';
import { MirrorErrorScreen } from '@/components/mirror/error-screen';

// Écran affiché quand un écran plante (app/error.tsx, app/global-error.tsx), à la place de celui de
// Next.js (en anglais, fond blanc). Sur le miroir (/), l'écran noir qui se recharge seul ; sur le
// téléphone, le gabarit habituel et « Réessayer ». Jamais de code d'erreur.

export function ErrorScreen({ retry }: { retry: () => void }) {
  const pathname = usePathname();
  // Adresse inconnue : l'écran noir, le seul qui ne s'allume pas derrière la vitre.
  if (!pathname || pathname === '/') return <MirrorErrorScreen />;

  // Même phrase et même « Réessayer » qu'un écran qui n'a pas pu lire ses données (LoadError) :
  // de la couleur du texte, role=alert, et le bouton pâlit sous le doigt. retry() relit l'écran.
  return (
    <PhonePage>
      <div className="flex flex-col">
        <p role="alert" className="text-body text-ink">
          {"Cet écran n'a pas pu s'afficher."}
        </p>
        <button
          type="button"
          onClick={() => retry()}
          className={`flex min-h-11 items-center self-start text-body text-accent ${pressFeedback}`}
        >
          Réessayer
        </button>
      </div>
    </PhonePage>
  );
}
