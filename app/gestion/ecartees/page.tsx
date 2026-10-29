import type { Metadata } from 'next';
import { Suspense } from 'react';
import { logServerError } from '@/components/gestion/action-errors';
import { LoadError } from '@/components/gestion/load-error';
import { PhonePage } from '@/components/gestion/page-shell';
import { SignedOut } from '@/components/gestion/signed-out';
import { checkUser } from '@/lib/server/auth';
import { createClient } from '@/lib/supabase/server';
import { DismissedFallback } from './dismissed-fallback';
import { DismissedList } from './dismissed-list';
import { dismissedRows, type DismissedRow, type Refusal, type RefusedPiece } from './rows';

// « Tenues écartées » (docs/conception.md §4, §6) : ce que « non » a écarté, du plus récent au plus ancien, pour
// pouvoir revenir sur un refus. Chaque refus s'écrit comme la légende du miroir, une pièce par ligne
// (rows.ts) : ce que montrait la silhouette (veste et bas, haut et bas, ou robe) ; ceux de l'ancien
// format nomment aussi le haut caché sous la veste, en gris.
export const metadata: Metadata = { title: 'Tenues écartées' };

export default function DismissedPage() {
  return (
    <PhonePage title="Tenues écartées" back={{ href: '/gestion/reglages', label: 'Réglages' }}>
      <Suspense fallback={<DismissedFallback />}>
        <DismissedGate />
      </Suspense>
    </PhonePage>
  );
}

async function DismissedGate() {
  const check = await checkUser();
  if (!check.ok) return <SignedOut status={check.status} />;

  let rows: DismissedRow[];
  try {
    const supabase = await createClient();
    const [refusals, items] = await Promise.all([
      supabase
        .from('refusals')
        .select('id, item_ids, created_at')
        .eq('owner', check.user.id)
        .order('created_at', { ascending: false }),
      supabase.from('items').select('id, name, category').eq('owner', check.user.id),
    ]);
    if (refusals.error) throw refusals.error;
    if (items.error) throw items.error;
    rows = dismissedRows((refusals.data ?? []) as Refusal[], (items.data ?? []) as RefusedPiece[]);
  } catch (error) {
    logServerError('ecartees', error);
    return <LoadError>Les tenues écartées n&apos;ont pas pu être chargées.</LoadError>;
  }

  if (rows.length === 0) return <p className="text-body text-muted">Aucune tenue écartée.</p>;

  return <DismissedList rows={rows} />;
}
