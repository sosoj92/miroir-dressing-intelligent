import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense, cache } from 'react';
import { pressFeedback } from '@/components/gestion/buttons';
import { LoadError } from '@/components/gestion/load-error';
import { PhonePage } from '@/components/gestion/page-shell';
import { SignedOut } from '@/components/gestion/signed-out';
import { GridFallback } from '@/components/wardrobe/grid-fallback';
import { WardrobeGrid } from '@/components/wardrobe/wardrobe-grid';
import { errorName } from '@/lib/items/errors';
import type { GridItem } from '@/lib/items/grid';
import { checkUser } from '@/lib/server/auth';
import { createClient } from '@/lib/supabase/server';
import { loadGridItems } from './data';

// Garde-robe (docs/conception.md §4, écran 2), sur le téléphone : grille des vêtements par catégorie, au sale
// oui ou non (mode « Marquer au sale », vue « au sale »).
export const metadata: Metadata = { title: 'Garde-robe' };

const ADD_PATH = '/gestion/garde-robe/ajouter';

/** Une seule lecture de la session par requête, pour « Ajouter » et pour la grille. */
const pageUser = cache(checkUser);

export default function WardrobePage() {
  // edge={false} : le filet est celui de la bande collée (wardrobe-grid.tsx), quand les photos
  // passent dessous ; pas quand seuls le titre et le compte glissent sous la barre.
  return (
    <PhonePage
      title="Garde-robe"
      edge={false}
      action={
        <Suspense fallback={null}>
          <AddLink />
        </Suspense>
      }
    >
      <Suspense fallback={<GridFallback />}>
        <Wardrobe />
      </Suspense>
    </PhonePage>
  );
}

/** « Ajouter » en haut à droite, seulement avec une session. */
async function AddLink() {
  const check = await pageUser();
  if (!check.ok) return null;
  return (
    <Link href={ADD_PATH} className={`flex min-h-11 items-center text-body text-accent ${pressFeedback}`}>
      Ajouter
    </Link>
  );
}

async function Wardrobe() {
  const check = await pageUser();
  if (!check.ok) return <SignedOut status={check.status} />;

  let items: GridItem[];
  try {
    items = await loadGridItems(await createClient(), check.user.id);
  } catch (error) {
    console.error(`Garde-robe : ${errorName(error)}`);
    return <LoadError>La garde-robe n&apos;a pas pu être chargée.</LoadError>;
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-body text-muted">Ta garde-robe est vide.</p>
        <Link
          href={ADD_PATH}
          className="rounded-xl bg-accent px-4 py-3 text-center text-body font-semibold text-on-accent"
        >
          Ajouter un vêtement
        </Link>
      </div>
    );
  }

  return <WardrobeGrid items={items} />;
}
