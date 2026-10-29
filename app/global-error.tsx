'use client';

import './globals.css';
import { usePathname } from 'next/navigation';
import { ErrorScreen } from '@/components/error-screen';

// La mise en page racine elle-même a planté : cet écran la remplace, avec son propre document
// (app/error.tsx ne peut plus s'afficher). Mêmes écrans que app/error.tsx. Fond noir en ligne sur
// le miroir : si la feuille de style manque, rien ne s'allume quand même derrière la vitre.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  const pathname = usePathname();
  const mirror = !pathname || pathname === '/';

  return (
    <html lang="fr" className="h-full antialiased" style={mirror ? { background: '#000' } : undefined}>
      <body className="min-h-full" style={mirror ? { margin: 0, background: '#000', color: '#ccc' } : { margin: 0 }}>
        <title>Mon Dressing</title>
        <ErrorScreen retry={retry} />
      </body>
    </html>
  );
}
