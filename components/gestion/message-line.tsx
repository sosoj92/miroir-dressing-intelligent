// Message sous un contrôle du téléphone (Réglages, connexion), une seule règle partout :
// - un succès (« Enregistré. », « Lien envoyé… ») en gris, dans la zone role=status, toujours
//   présente pour que le lecteur d'écran l'annonce ;
// - un échec de la couleur du texte, avec role=alert : il ne ressemble plus à une confirmation.
// Jamais prune (ça se lirait comme un lien) ni rouge. Une erreur qui remplace le contenu d'un écran
// est en text-body (LoadError, Importer) ; ici, à côté d'un contrôle, en text-footnote.

export type Message = { text: string; error: boolean };

/**
 * L'action n'a pas pu joindre le serveur (connexion coupée) : écrit sous le contrôle, au lieu de
 * remplacer la page par l'écran d'erreur. Après `unstable_rethrow(caught)` dans le catch.
 */
export const CONNECTION_LOST: Message = { text: 'La connexion a été coupée. Réessaie.', error: true };

/** `className` : la place du message (marges), la même pour le succès et l'échec. */
export function MessageLine({ message, className = '' }: { message: Message | null; className?: string }) {
  const success = message && !message.error ? message.text : '';
  return (
    <>
      <p role="status" aria-live="polite" className={`text-footnote text-muted empty:p-0 ${className}`}>
        {success}
      </p>
      {message?.error ? (
        <p role="alert" className={`text-footnote text-ink ${className}`}>
          {message.text}
        </p>
      ) : null}
    </>
  );
}
