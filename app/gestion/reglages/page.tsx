import type { Metadata } from 'next';
import { Suspense } from 'react';
import { logServerError } from '@/components/gestion/action-errors';
import { Group, Row, rowClass } from '@/components/gestion/group';
import { LoadError } from '@/components/gestion/load-error';
import { PhonePage } from '@/components/gestion/page-shell';
import { SignedOut } from '@/components/gestion/signed-out';
import { checkUser } from '@/lib/server/auth';
import { getProfile } from '@/lib/server/profile';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';
import { CityForm } from './city-form';
import { EVENING_HOUR_DEFAULT, isEveningHour } from './evening-hour';
import { EveningHourForm } from './evening-hour-form';

// Réglages (docs/conception.md §4, écran 4) : ville et « Préparer demain ». Plus de manette : le miroir se
// commande avec les bras, et le test des touches d'un clavier de secours ne s'ouvre plus que sur la
// tablette (?touches=test). La sensibilité des gestes viendra avec sa phase.
// Des listes groupées (Group, Row), comme l'accueil : un encart par réglage, sans bouton plein.
export const metadata: Metadata = { title: 'Réglages' };

export default function SettingsPage() {
  return (
    <PhonePage title="Réglages">
      <Suspense fallback={<SettingsFallback />}>
        <SettingsGate />
      </Suspense>
    </PhonePage>
  );
}

/** Titres et nombre de lignes des encarts, pour l'attente ; le dernier, sans titre. */
const SECTIONS: ReadonlyArray<{ title?: string; rows: number }> = [
  { title: 'Météo', rows: 2 },
  { title: 'Préparer demain', rows: 1 },
  { rows: 1 },
];

/** En attente : les mêmes encarts, vides, sans animation. */
function SettingsFallback() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-8">
      {SECTIONS.map(({ title, rows }, section) => (
        <Group key={section} title={title}>
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className={rowClass}>
              &nbsp;
            </div>
          ))}
        </Group>
      ))}
    </div>
  );
}

async function SettingsGate() {
  const check = await checkUser();
  if (!check.ok) return <SignedOut status={check.status} />;

  let profile: Profile;
  try {
    profile = await getProfile(await createClient());
  } catch (error) {
    logServerError('reglages', error);
    return <LoadError>Tes réglages n&apos;ont pas pu être chargés.</LoadError>;
  }

  return (
    <div className="flex flex-col gap-8">
      <CityForm initialCity={profile.city} />
      <EveningHourForm initialHour={isEveningHour(profile.evening_hour) ? profile.evening_hour : EVENING_HOUR_DEFAULT} />
      {/* Seule dans son encart, sans titre : un titre « Tenues » ne ferait que la répéter. */}
      <Group>
        <Row href="/gestion/ecartees">Tenues écartées</Row>
      </Group>
    </div>
  );
}
