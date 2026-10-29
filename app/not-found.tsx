import type { Metadata } from 'next';
import { PhonePage } from '@/components/gestion/page-shell';

// Page introuvable (adresse inconnue, ou notFound() d'une fiche). Même gabarit que les écrans du
// téléphone : on n'arrive ici que depuis la gestion. Aucune lecture de session.
export const metadata: Metadata = { title: 'Page introuvable' };

export default function NotFound() {
  return (
    <PhonePage title="Page introuvable">
      <p className="text-body text-muted">Cette adresse ne mène à rien.</p>
    </PhonePage>
  );
}
