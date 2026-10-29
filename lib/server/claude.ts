import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlock, BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ItemDraft } from '@/lib/types';
import { normalizeDraft } from '@/lib/items/validate';
import { GARMENT_JSON_SCHEMA } from '@/lib/items/schema';
import { anthropicApiKey } from './env';

// Claude API, côté serveur uniquement (AGENTS.md). La photo est passée par une URL signée de
// 10 min (docs/conception.md §9) ; rien n'est journalisé ici : ni la clé, ni l'URL (elle contient un jeton).

/** Modèle de la fiche automatique et des titres de tenue (docs/conception.md §4 et §6). Aucun autre identifiant. */
export const CLAUDE_MODEL = 'claude-opus-5-5';

/** Repli côté serveur si le modèle décline pour raison de politique (« default » : choix d'Anthropic). */
export const CLAUDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Tarif de CLAUDE_MODEL, en dollars par million de jetons. */
export const CLAUDE_INPUT_USD_PER_MTOK = 4;
export const CLAUDE_OUTPUT_USD_PER_MTOK = 20;

export const DESCRIBE_MAX_TOKENS = 4000;
/** Délai maximal d'une requête, et nombre de nouvelles tentatives du SDK (429, 5xx, réseau). */
export const CLAUDE_TIMEOUT_MS = 45_000;
export const CLAUDE_MAX_RETRIES = 1;

const DESCRIBE_SYSTEM =
  "Tu décris le vêtement photographié pour une garde-robe numérique. " +
  'La photo montre un seul vêtement, posé à plat. Remplis la fiche demandée, en français.';

const DESCRIBE_REQUEST =
  'Remplis la fiche de ce vêtement : un nom court, sa catégorie, sa couleur principale, sa chaleur, ' +
  "les styles qui lui conviennent et s'il supporte la pluie.";

/** Coût d'un appel, en dollars, d'après les jetons facturés. */
export function claudeCostUsd(usage: Pick<BetaUsage, 'input_tokens' | 'output_tokens'>): number {
  const input = Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0;
  const output = Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0;
  return (input * CLAUDE_INPUT_USD_PER_MTOK + output * CLAUDE_OUTPUT_USD_PER_MTOK) / 1_000_000;
}

export type ClaudeErrorReason = 'refus' | 'reponse';

/** Erreur de la fiche automatique. Le message ne contient ni URL ni contenu de la réponse. */
export class ClaudeError extends Error {
  readonly reason: ClaudeErrorReason;

  constructor(reason: ClaudeErrorReason) {
    super(reason === 'refus' ? 'La Claude API a refusé de décrire la photo.' : 'Réponse inattendue de la Claude API.');
    this.name = 'ClaudeError';
    this.reason = reason;
  }
}

/**
 * Texte final de la réponse : les blocs `text` après le dernier bloc `fallback` (s'il y a eu un
 * repli), sans les blocs de réflexion.
 */
export function finalText(content: readonly BetaContentBlock[]): string {
  let start = 0;
  content.forEach((block, index) => {
    if (block.type === 'fallback') start = index + 1;
  });
  return content
    .slice(start)
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

export type DescribeOptions = {
  /** Appelée avec le coût de l'appel dès la réponse, même si la fiche est ensuite refusée. */
  onCost?: (costUsd: number) => unknown;
};

/** Fiche proposée pour la photo d'un vêtement (docs/conception.md §4, écran 3). Lève EnvError si la clé manque. */
export async function describeGarment(imageUrl: string, options: DescribeOptions = {}): Promise<ItemDraft> {
  const client = new Anthropic({
    apiKey: anthropicApiKey(), // EnvError avant tout appel réseau si la clé manque
    timeout: CLAUDE_TIMEOUT_MS,
    maxRetries: CLAUDE_MAX_RETRIES,
  });

  const message = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: DESCRIBE_MAX_TOKENS,
    betas: [CLAUDE_FALLBACK_BETA],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: GARMENT_JSON_SCHEMA },
    },
    system: DESCRIBE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text', text: DESCRIBE_REQUEST },
        ],
      },
    ],
  });

  try {
    await options.onCost?.(claudeCostUsd(message.usage));
  } catch {
    // Le suivi de la dépense ne doit pas faire échouer la fiche.
  }

  // Un refus peut ne pas suivre le schéma : on le traite avant de lire le contenu.
  if (message.stop_reason === 'refusal') throw new ClaudeError('refus');
  if (message.stop_reason === 'max_tokens') throw new ClaudeError('reponse'); // JSON tronqué

  let parsed: unknown;
  try {
    parsed = JSON.parse(finalText(message.content));
  } catch {
    throw new ClaudeError('reponse');
  }
  try {
    return normalizeDraft(parsed);
  } catch {
    throw new ClaudeError('reponse');
  }
}
