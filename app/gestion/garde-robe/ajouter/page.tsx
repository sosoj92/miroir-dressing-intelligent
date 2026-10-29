import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PhonePage } from '@/components/gestion/page-shell';
import { SignedOut } from '@/components/gestion/signed-out';
import { AddItemFlow } from '@/components/wardrobe/add-item-flow';
import { AddItemFallback } from '@/components/wardrobe/add-item-hint';
import { SaveButton, SaveSlot } from '@/components/wardrobe/save-slot';
import { checkUser } from '@/lib/server/auth';

// Ajout d'un vêtement par photo (docs/conception.md §4, écran 3), sur le téléphone.
export const metadata: Metadata = { title: 'Ajouter un vêtement' };

/** Détourage et fiche automatique en parallèle (server action analyzePhoto) : jusqu'à ~1 min. */
export const maxDuration = 120;

export default function AddItemPage() {
  return (
    // « Enregistrer » (ligne retour) n'apparaît qu'à la relecture de la fiche proposée (SaveSlot).
    <SaveSlot>
      <PhonePage title="Ajouter un vêtement" back={WARDROBE} action={<SaveButton />}>
        {/* En attente de la session : la phrase tout de suite, et la place des deux boutons. */}
        <Suspense fallback={<AddItemFallback />}>
          <AddGate />
        </Suspense>
      </PhonePage>
    </SaveSlot>
  );
}

const WARDROBE = { href: '/gestion/garde-robe', label: 'Garde-robe' };

async function AddGate() {
  const check = await checkUser();
  if (!check.ok) return <SignedOut status={check.status} />;
  return <AddItemFlow userId={check.user.id} />;
}
