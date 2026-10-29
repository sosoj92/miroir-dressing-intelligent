import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadError } from '@/components/gestion/load-error';
import { PhonePage } from '@/components/gestion/page-shell';
import { SignedOut } from '@/components/gestion/signed-out';
import { GridBackLink } from '@/components/wardrobe/grid-back-link';
import { DirtyFallback } from '@/components/wardrobe/grid-fallback';
import { DirtyGrid } from '@/components/wardrobe/wardrobe-grid';
import { errorName } from '@/lib/items/errors';
import type { GridItem } from '@/lib/items/grid';
import { checkUser } from '@/lib/server/auth';
import { createClient } from '@/lib/supabase/server';
import { loadGridItems } from '../data';

// Pièces au sale (docs/conception.md §4, écran 2), ouvertes depuis « 3 au sale » de la garde-robe : toutes
// catégories. Toucher une pièce la remet propre, sur place (DirtyGrid) ; « Tout est lavé » les
// remet toutes propres d'un coup. Ouverte depuis la grille, « ‹ Garde-robe » y revient par
// l'historique (GridBackLink), comme la fiche, sur une grille déjà relue (revalidatePath).
export const metadata: Metadata = { title: 'Au sale' };

export default function DirtyPage() {
  return (
    <PhonePage title="Au sale" backLink={<GridBackLink />}>
      <Suspense fallback={<DirtyFallback />}>
        <DirtyItems />
      </Suspense>
    </PhonePage>
  );
}

async function DirtyItems() {
  const check = await checkUser();
  if (!check.ok) return <SignedOut status={check.status} />;

  let items: GridItem[];
  try {
    items = await loadGridItems(await createClient(), check.user.id, { dirtyOnly: true });
  } catch (error) {
    console.error(`Au sale : ${errorName(error)}`);
    return <LoadError>Les pièces au sale n&apos;ont pas pu être chargées.</LoadError>;
  }

  return <DirtyGrid items={items} />;
}
