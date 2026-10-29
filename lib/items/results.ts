import type { ItemDraft } from '@/lib/types';

// Types des réponses des server actions de la garde-robe (app/gestion/garde-robe/actions.ts).
// Ils vivent ici : un fichier 'use server' n'exporte que des fonctions async.

export type ActionFailure = { ok: false; error: string };
export type ActionResult<T extends object = Record<never, never>> = ({ ok: true } & T) | ActionFailure;

export type AnalyzeSuccess = {
  photoPath: string;
  /**
   * Détourage dans le bucket privé (copié depuis fal.ai, ou PNG transparent envoyé par le
   * téléphone), ou null s'il n'a pas pu être fait.
   */
  cutoutPath: string | null;
  /** URL signée d'affichage (1 h) du détourage. */
  cutoutUrl: string | null;
  /** Fiche proposée par la Claude API, ou null. */
  draft: ItemDraft | null;
  /** Ce qui n'a pas marché, en clair (« Détourage indisponible : FAL_KEY absente. »). */
  notices: string[];
};

export type AnalyzeResult = ActionResult<AnalyzeSuccess>;

export type NewItemInput = {
  photoPath: string;
  cutoutPath: string | null;
  draft: ItemDraft;
};
