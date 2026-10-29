import type { Metadata } from 'next';
import { Suspense } from 'react';
import { logServerError } from '@/components/gestion/action-errors';
import { LoadError } from '@/components/gestion/load-error';
import { PhonePage } from '@/components/gestion/page-shell';
import { SignedOut } from '@/components/gestion/signed-out';
import { checkUser } from '@/lib/server/auth';
import { getProfile } from '@/lib/server/profile';
import { createClient } from '@/lib/supabase/server';
import { loadTomorrow } from './data';
import { Tomorrow, TomorrowFallback } from './tomorrow';
import type { TomorrowView } from './view';

// « Préparer demain » depuis le téléphone (docs/conception.md §4) : 5 tenues proposées (generateOutfits), avec la
// météo de demain. En tête et en grand, la tenue gardée (sinon la première proposition), qui est
// aussi le point de départ du miroir ; les autres par deux, pour les comparer d'un coup d'œil.
// L'affichage est dans tomorrow.tsx ; ici, la session et les données.
export const metadata: Metadata = { title: 'Demain' };

export default function TomorrowPage() {
  return (
    <PhonePage title="Demain">
      <Suspense fallback={<TomorrowFallback />}>
        <TomorrowGate />
      </Suspense>
    </PhonePage>
  );
}

async function TomorrowGate() {
  const check = await checkUser();
  if (!check.ok) return <SignedOut status={check.status} />;

  let view: TomorrowView;
  try {
    const supabase = await createClient();
    const profile = await getProfile(supabase);
    // La session est lue : la page est dynamique, l'heure courante peut servir.
    view = await loadTomorrow(supabase, check.user.id, profile, new Date());
  } catch (error) {
    logServerError('demain', error);
    return <LoadError>Les tenues de demain n&apos;ont pas pu être chargées.</LoadError>;
  }

  return <Tomorrow view={view} />;
}
