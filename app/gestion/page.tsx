import type { Metadata } from 'next';
import { Suspense } from 'react';
import { logServerError } from '@/components/gestion/action-errors';
import { Group, Row } from '@/components/gestion/group';
import { PhonePage } from '@/components/gestion/page-shell';
import { SignedOut } from '@/components/gestion/signed-out';
import { checkUser } from '@/lib/server/auth';
import { getProfile } from '@/lib/server/profile';
import { createClient } from '@/lib/supabase/server';
import { dirtyValue, loadHomeSummary, tomorrowValue, type HomeSummary } from './home';
import { HomeFallback } from './home-fallback';

// Accueil du téléphone : les écrans de gestion, une fois connectée, avec ce qui attend (pièces au
// sale, tenue de demain). L'onglet et l'historique disent « Mon Dressing », comme le titre. Le même
// gabarit que les autres écrans (PhonePage, sans retour) : le titre est à la même place.
export const metadata: Metadata = { title: { absolute: 'Mon Dressing' } };

export default function ManagementPage() {
  return (
    <PhonePage title="Mon Dressing" back={null}>
      <Suspense fallback={<HomeFallback />}>
        <SessionGate />
      </Suspense>
    </PhonePage>
  );
}

async function SessionGate() {
  const check = await checkUser();
  if (!check.ok) return <SignedOut status={check.status} />;

  // Sans ces chiffres, l'accueil reste utilisable : les lignes s'affichent sans valeur à droite.
  let summary: HomeSummary | null = null;
  try {
    const supabase = await createClient();
    const profile = await getProfile(supabase);
    // La session est lue : la page est dynamique, l'heure courante peut servir.
    summary = await loadHomeSummary(supabase, check.user.id, profile.timezone, new Date());
  } catch (error) {
    logServerError('accueil', error);
  }

  return (
    <nav aria-label="Gestion" className="flex flex-col gap-8">
      <Group>
        <Row href="/gestion/garde-robe" value={summary ? dirtyValue(summary.dirtyCount) : undefined}>
          Garde-robe
        </Row>
        <Row href="/gestion/demain" value={summary ? tomorrowValue(summary.tomorrowPlanned) : undefined}>
          Demain
        </Row>
      </Group>
      <Group>
        <Row href="/gestion/reglages">Réglages</Row>
        <Row href="/gestion/import">Importer</Row>
      </Group>
    </nav>
  );
}
