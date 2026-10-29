'use client';

import { ErrorScreen } from '@/components/error-screen';

// Un écran a planté pendant son affichage : sur le miroir, l'écran noir qui se recharge seul ; sur
// le téléphone, « Cet écran n'a pas pu s'afficher. » et « Réessayer » (retry relit aussi les données,
// Next.js 16.3+). Remplace l'écran par défaut de Next.js, en anglais et sur fond blanc.
export default function AppError({ retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen retry={retry} />;
}
