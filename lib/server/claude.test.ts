import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SDK simulé : aucun appel réseau, aucune vraie clé.
const { create, constructed } = vi.hoisted(() => ({ create: vi.fn(), constructed: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    beta = { messages: { create } };
    constructor(options: unknown) {
      constructed(options);
    }
  },
}));

import {
  CLAUDE_FALLBACK_BETA,
  CLAUDE_MODEL,
  ClaudeError,
  claudeCostUsd,
  describeGarment,
  finalText,
} from './claude';
import { EnvError } from './env';
import { CATEGORIES, STYLES } from '@/lib/types';

const KEY = 'cle-anthropic-factice';
const SIGNED_URL = 'https://projet.supabase.co/storage/v1/object/sign/items/u/p.jpg?token=jeton-factice';

const FICHE = {
  name: 'Pull col roulé marine',
  category: 'haut',
  color: '#1f2a44',
  warmth: 3,
  styles: ['habille', 'decontracte', 'habille'],
  rain_ok: false,
};

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: CLAUDE_MODEL,
    stop_reason: 'end_turn',
    stop_details: null,
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: JSON.stringify(FICHE), citations: null },
    ],
    usage: { input_tokens: 1000, output_tokens: 500 },
    ...overrides,
  };
}

beforeEach(() => {
  create.mockReset();
  constructed.mockReset();
  vi.stubEnv('ANTHROPIC_API_KEY', KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('describeGarment', () => {
  it('appelle CLAUDE_MODEL en sortie structurée, effort bas, image en URL', async () => {
    create.mockResolvedValue(message());
    await describeGarment(SIGNED_URL);

    expect(constructed).toHaveBeenCalledOnce();
    expect(constructed.mock.calls[0][0]).toMatchObject({ apiKey: KEY });

    expect(create).toHaveBeenCalledOnce();
    const params = create.mock.calls[0][0];
    expect(CLAUDE_MODEL).toBe('claude-opus-5-5');
    expect(params.model).toBe(CLAUDE_MODEL);
    expect(params.max_tokens).toBe(4000);
    expect(params.betas).toEqual([CLAUDE_FALLBACK_BETA]);
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params.fallbacks).toBe('default');
    expect(params).not.toHaveProperty('thinking');
    expect(params.output_config.effort).toBe('low');
    expect(params.output_config.format.type).toBe('json_schema');
    expect(typeof params.system).toBe('string');

    const schema = params.output_config.format.schema;
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(['category', 'color', 'name', 'rain_ok', 'styles', 'warmth']);
    expect(schema.properties.category.enum).toEqual([...CATEGORIES]);
    expect(schema.properties.warmth).toMatchObject({ type: 'integer', enum: [1, 2, 3] });
    expect(schema.properties.styles.items.enum).toEqual([...STYLES]);
    expect(schema.properties.rain_ok.type).toBe('boolean');
    expect(schema.properties.color).not.toHaveProperty('pattern');

    expect(params.messages).toHaveLength(1);
    const [image, text] = params.messages[0].content;
    expect(params.messages[0].role).toBe('user');
    expect(image).toEqual({ type: 'image', source: { type: 'url', url: SIGNED_URL } });
    expect(text.type).toBe('text');
  });

  it('renvoie la fiche normalisée', async () => {
    create.mockResolvedValue(message());
    await expect(describeGarment(SIGNED_URL)).resolves.toEqual({
      name: 'Pull col roulé marine',
      category: 'haut',
      color: '#1F2A44',
      warmth: 3,
      styles: ['decontracte', 'habille'],
      rain_ok: false,
    });
  });

  it('calcule le coût : 4 $ par million de jetons en entrée, 20 $ en sortie', async () => {
    create.mockResolvedValue(message({ usage: { input_tokens: 1000, output_tokens: 500 } }));
    const onCost = vi.fn();
    await describeGarment(SIGNED_URL, { onCost });
    expect(onCost).toHaveBeenCalledOnce();
    expect(onCost.mock.calls[0][0]).toBeCloseTo(0.014, 10);
  });

  it('refus : erreur avant de lire le contenu, coût quand même compté', async () => {
    create.mockResolvedValue(
      message({
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: null, explanation: null },
        content: [{ type: 'text', text: 'pas du JSON', citations: null }],
      }),
    );
    const onCost = vi.fn();
    const error = await describeGarment(SIGNED_URL, { onCost }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClaudeError);
    expect(error).toMatchObject({ name: 'ClaudeError', reason: 'refus' });
    expect(onCost).toHaveBeenCalledOnce();
  });

  it('JSON invalide : erreur propre', async () => {
    create.mockResolvedValue(message({ content: [{ type: 'text', text: '{"name": "Pull"', citations: null }] }));
    await expect(describeGarment(SIGNED_URL)).rejects.toMatchObject({ reason: 'reponse' });
  });

  it('JSON valide mais valeur inconnue : erreur propre', async () => {
    create.mockResolvedValue(
      message({ content: [{ type: 'text', text: JSON.stringify({ ...FICHE, category: 'pantalon' }), citations: null }] }),
    );
    await expect(describeGarment(SIGNED_URL)).rejects.toMatchObject({ reason: 'reponse' });
  });

  it('réponse tronquée (max_tokens) : erreur propre', async () => {
    create.mockResolvedValue(message({ stop_reason: 'max_tokens' }));
    await expect(describeGarment(SIGNED_URL)).rejects.toMatchObject({ reason: 'reponse' });
  });

  it('après un repli, lit le texte qui suit le bloc fallback', async () => {
    create.mockResolvedValue(
      message({
        content: [
          { type: 'text', text: '{"name": "début abandonné', citations: null },
          { type: 'fallback', from: { model: CLAUDE_MODEL }, to: { model: 'autre-modele' } },
          { type: 'text', text: JSON.stringify(FICHE), citations: null },
        ],
      }),
    );
    await expect(describeGarment(SIGNED_URL)).resolves.toMatchObject({ name: 'Pull col roulé marine' });
  });

  it('sans ANTHROPIC_API_KEY : EnvError qui nomme la variable, aucun appel', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const error = await describeGarment(SIGNED_URL).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EnvError);
    expect(error).toMatchObject({ variable: 'ANTHROPIC_API_KEY', reason: 'absente' });
    expect((error as Error).message).not.toContain(KEY);
    expect(constructed).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('les messages d’erreur ne contiennent ni URL ni réponse', async () => {
    create.mockResolvedValue(message({ content: [{ type: 'text', text: SIGNED_URL, citations: null }] }));
    const error = (await describeGarment(SIGNED_URL).catch((caught: unknown) => caught)) as Error;
    expect(error.message).not.toContain('jeton-factice');
  });
});

describe('claudeCostUsd', () => {
  it('applique les tarifs nommés', () => {
    expect(claudeCostUsd({ input_tokens: 1_000_000, output_tokens: 0 })).toBe(4);
    expect(claudeCostUsd({ input_tokens: 0, output_tokens: 1_000_000 })).toBe(20);
    expect(claudeCostUsd({ input_tokens: 0, output_tokens: 0 })).toBe(0);
  });
});

describe('finalText', () => {
  it('ignore les blocs qui ne sont pas du texte', () => {
    expect(
      finalText([
        { type: 'thinking', thinking: '', signature: 's' },
        { type: 'text', text: '{"a":', citations: null },
        { type: 'text', text: '1}', citations: null },
      ] as never),
    ).toBe('{"a":1}');
  });
});
