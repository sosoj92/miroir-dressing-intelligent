import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PhonePage } from '@/components/gestion/page-shell';
import { SignedOut } from '@/components/gestion/signed-out';
import { checkUser } from '@/lib/server/auth';
import { ImportForm } from './import-form';

// Import depuis le téléphone : paquet d'assemblage des photos portées (docs/conception.md §3.2) ou prototype
// ancien format db.json (docs/conception.md §3.1). Le zip est ouvert dans le navigateur.
export const metadata: Metadata = { title: 'Importer' };

export default function ImportPage() {
  return (
    <PhonePage title="Importer">
      <Suspense fallback={<ImportFallback />}>
        <ImportGate />
      </Suspense>
    </PhonePage>
  );
}

/** En attente : la consigne et le bouton « Choisir un fichier », sans animation. */
function ImportFallback() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <p className="text-footnote">&nbsp;</p>
      <div className="min-h-11 rounded-xl bg-surface" />
    </div>
  );
}

async function ImportGate() {
  const check = await checkUser();
  if (!check.ok) return <SignedOut status={check.status} />;
  return <ImportForm userId={check.user.id} />;
}
