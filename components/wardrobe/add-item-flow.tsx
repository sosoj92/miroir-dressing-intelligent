'use client';

import { unstable_rethrow } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { analyzePhoto, createItem, discardUpload } from '@/app/gestion/garde-robe/actions';
import { pressFeedback } from '@/components/gestion/buttons';
import { Group } from '@/components/gestion/group';
import { uploadErrorMessage, uploadItemPhoto, type UploadedPhoto } from '@/lib/images/upload';
import type { AnalyzeSuccess } from '@/lib/items/results';
import { EMPTY_DRAFT } from '@/lib/items/validate';
import type { ItemDraft } from '@/lib/types';
import { AddItemHint } from './add-item-hint';
import { CameraIcon, GalleryIcon } from './icons';
import { ItemForm } from './item-form';
import { PhotoButton } from './photo-picker';
import { ItemImage } from './item-image';

// Ajout d'un vêtement depuis le téléphone (docs/conception.md §4, écran 3), en secours : la méthode principale
// est la photo portée sur fond vert, préparée sur le PC puis importée (écran Importer, docs/conception.md §3.2).
// 1. photo à plat, réduite puis envoyée dans le bucket privé (et, pour une photo PNG déjà
//    détourée, son PNG transparent, qui sert de détourage sans fal.ai) ;
// 2. et 3. détourage et fiche automatique (server action analyzePhoto) ;
// 4. correction ; 5. enregistrement (createItem, « Enregistrer » dans la ligne retour), puis la
// fiche de la pièce s'ouvre.

type Stage =
  | { kind: 'pick' }
  | { kind: 'working'; message: string; preview: string }
  | { kind: 'review'; preview: string; analysis: AnalyzeSuccess }
  | { kind: 'error'; message: string; preview: string | null };

const STEP_MESSAGES = {
  reduction: 'Préparation de la photo…',
  envoi: 'Envoi de la photo…',
  analyse: "Détourage et fiche en cours… (jusqu'à une minute)",
  fiche: 'Fiche en cours…',
} as const;

const NETWORK_ERROR = 'La connexion a été coupée. Réessaie.';

export function AddItemFlow({ userId }: { userId: string }) {
  const [stage, setStage] = useState<Stage>({ kind: 'pick' });
  const previewRef = useRef<string | null>(null);

  // Libère l'aperçu local quand on quitte la page.
  useEffect(() => {
    const preview = previewRef;
    return () => {
      if (preview.current) URL.revokeObjectURL(preview.current);
    };
  }, []);

  function releasePreview() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
  }

  async function handlePick(file: File) {
    releasePreview();
    const preview = URL.createObjectURL(file);
    previewRef.current = preview;
    setStage({ kind: 'working', message: STEP_MESSAGES.reduction, preview });

    let uploaded: UploadedPhoto;
    try {
      uploaded = await uploadItemPhoto(file, userId, (step) =>
        setStage({ kind: 'working', message: STEP_MESSAGES[step], preview }),
      );
    } catch (error) {
      setStage({ kind: 'error', message: uploadErrorMessage(error), preview });
      return;
    }

    const { photoPath, cutoutPath } = uploaded;
    // PNG déjà détouré : il ne reste que la fiche automatique.
    setStage({ kind: 'working', message: cutoutPath ? STEP_MESSAGES.fiche : STEP_MESSAGES.analyse, preview });
    const result = await analyzePhoto(photoPath, cutoutPath).catch(() => null);
    if (!result || !result.ok) {
      void discardUpload(photoPath, cutoutPath).catch(() => undefined);
      setStage({ kind: 'error', message: result ? result.error : NETWORK_ERROR, preview });
      return;
    }
    setStage({ kind: 'review', preview, analysis: result });
  }

  async function save(analysis: AnalyzeSuccess, draft: ItemDraft): Promise<string | null> {
    try {
      const result = await createItem({ photoPath: analysis.photoPath, cutoutPath: analysis.cutoutPath, draft });
      return result.ok ? null : result.error;
    } catch (error) {
      // En cas de succès, createItem redirige vers la fiche de la pièce : Next.js le signale par une
      // erreur qu'il faut laisser passer.
      unstable_rethrow(error);
      return NETWORK_ERROR;
    }
  }

  function restart() {
    if (stage.kind === 'review') {
      void discardUpload(stage.analysis.photoPath, stage.analysis.cutoutPath).catch(() => undefined);
    }
    releasePreview();
    setStage({ kind: 'pick' });
  }

  if (stage.kind === 'pick') {
    return (
      <div className="flex flex-col gap-4">
        {/* La même phrase que l'attente de la session (AddItemFallback), à la même place. Le bouton
            plein pour l'action de l'écran ; la galerie en ligne d'encart, en prune (elle ouvre). */}
        <AddItemHint />
        <PhotoButton
          label="Prendre une photo"
          icon={<CameraIcon />}
          capture="environment"
          variant="primary"
          onPick={handlePick}
        />
        <Group>
          <PhotoButton label="Choisir dans la galerie" icon={<GalleryIcon />} variant="row" onPick={handlePick} />
        </Group>
      </div>
    );
  }

  if (stage.kind === 'working') {
    return (
      <div className="flex flex-col gap-4">
        <ItemImage src={stage.preview} alt="Photo du vêtement" fit="cover" className="opacity-60" />
        <p role="status" aria-live="polite" className="text-body text-muted">
          {stage.message}
        </p>
      </div>
    );
  }

  if (stage.kind === 'error') {
    return (
      <div className="flex flex-col gap-4">
        {stage.preview ? <ItemImage src={stage.preview} alt="Photo du vêtement" fit="cover" /> : null}
        <p role="alert" className="text-body text-ink">
          {stage.message}
        </p>
        <button
          type="button"
          onClick={restart}
          className="rounded-xl bg-accent px-4 py-3 text-body font-semibold text-on-accent"
        >
          Reprendre une photo
        </button>
      </div>
    );
  }

  const { analysis } = stage;
  return (
    <div className="flex flex-col gap-6">
      {analysis.cutoutUrl ? (
        <ItemImage src={analysis.cutoutUrl} alt="Vêtement détouré" fit="contain" />
      ) : (
        <ItemImage src={stage.preview} alt="Photo du vêtement" fit="cover" />
      )}
      {analysis.notices.length > 0 ? (
        <ul className="flex flex-col gap-1 text-footnote text-muted">
          {analysis.notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      ) : null}
      {/* « Enregistrer » est dans la ligne retour (SaveSlot, ajouter/page.tsx) ; « Recommencer » reste en bas. */}
      <ItemForm initialDraft={analysis.draft ?? EMPTY_DRAFT} onSubmit={(draft) => save(analysis, draft)}>
        <button type="button" onClick={restart} className={`min-h-11 text-body text-accent ${pressFeedback}`}>
          Recommencer
        </button>
      </ItemForm>
    </div>
  );
}
