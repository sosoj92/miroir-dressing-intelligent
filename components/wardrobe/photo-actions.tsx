'use client';

import { useState, useTransition } from 'react';
import { redoCutout, replacePhoto } from '@/app/gestion/garde-robe/actions';
import { pressFeedback } from '@/components/gestion/buttons';
import { uploadErrorMessage, uploadItemPhoto, type UploadedPhoto } from '@/lib/images/upload';
import { PhotoButton } from './photo-picker';

type PhotoActionsProps = {
  itemId: string;
  userId: string;
  /** Faux pour une photo importée de l'ancien format db.json : la personne la porte, on ne la détoure pas (docs/conception.md §3.1). */
  canRedoCutout: boolean;
  /**
   * Faux pour une pièce assemblée : sa photo portée et ses repères viennent du paquet d'import
   * (docs/conception.md §3.2) ; une photo à plat la sortirait de la silhouette du miroir. replacePhoto refuse aussi.
   */
  canChangePhoto: boolean;
};

/** « Relancer le détourage » et « Changer la photo » sous la photo de la fiche ; rien sinon. */
export function PhotoActions({ itemId, userId, canRedoCutout, canChangePhoto }: PhotoActionsProps) {
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  function redo() {
    setStatus({ text: 'Détourage en cours…', error: false });
    startTransition(async () => {
      const result = await redoCutout(itemId).catch(() => null);
      if (!result) setStatus({ text: 'La connexion a été coupée. Réessaie.', error: true });
      else setStatus(result.ok ? { text: 'Détourage refait.', error: false } : { text: result.error, error: true });
    });
  }

  function change(file: File) {
    setStatus({ text: 'Envoi de la photo…', error: false });
    startTransition(async () => {
      let uploaded: UploadedPhoto;
      try {
        uploaded = await uploadItemPhoto(file, userId);
      } catch (error) {
        setStatus({ text: uploadErrorMessage(error), error: true });
        return;
      }
      // PNG déjà détouré : le serveur le vérifie et l'enregistre, sans détourage.
      setStatus({ text: uploaded.cutoutPath ? 'Enregistrement…' : 'Détourage en cours…', error: false });
      const result = await replacePhoto(itemId, uploaded.photoPath, uploaded.cutoutPath).catch(() => null);
      if (!result) setStatus({ text: 'La connexion a été coupée. Réessaie.', error: true });
      else setStatus(result.ok ? { text: 'Photo remplacée.', error: false } : { text: result.error, error: true });
    });
  }

  if (!canRedoCutout && !canChangePhoto) return null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap justify-center gap-x-6">
        {canRedoCutout ? (
          <button type="button" onClick={redo} disabled={pending} className={`min-h-11 text-body text-accent disabled:text-muted ${pressFeedback}`}>
            Relancer le détourage
          </button>
        ) : null}
        {canChangePhoto ? (
          <PhotoButton label="Changer la photo" variant="text" disabled={pending} onPick={change} />
        ) : null}
      </div>
      {status ? (
        <p
          role={status.error ? 'alert' : 'status'}
          aria-live="polite"
          className={`text-center text-footnote ${status.error ? 'text-ink' : 'text-muted'}`}
        >
          {status.text}
        </p>
      ) : null}
    </div>
  );
}
