'use client';

import { useSearchParams } from 'next/navigation';

// Message laissé par /auth/callback quand le lien n'a pas abouti : de la couleur du texte, comme
// toute erreur du téléphone (jamais prune, qui se lirait comme un lien). Rendu dans la zone des
// messages du formulaire, sous les champs (useSearchParams : il n'arrive qu'après le chargement).
const MESSAGES: Record<string, string> = {
  lien: "Ce lien n'est plus valable. Demande-en un nouveau.",
  acces: "Ce compte n'a pas accès à Mon Dressing.",
  navigateur: "Ouvre le lien dans le navigateur où tu l'as demandé.",
};

export function CallbackError() {
  const reason = useSearchParams().get('erreur');
  const message = reason ? MESSAGES[reason] : undefined;
  if (!message) return null;

  return (
    <p role="alert" className="text-body text-ink">
      {message}
    </p>
  );
}
