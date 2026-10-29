import { CATEGORIES, STYLES } from '@/lib/types';

// Schéma JSON de la fiche que remplit la Claude API (docs/conception.md §4, écran 3), en sortie structurée
// (`output_config.format`). Les listes viennent de lib/types.ts. Pas de contrainte que les sorties
// structurées refusent (pattern, minItems, longueurs) : lib/items/validate.ts les vérifie ensuite.
export const GARMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'category', 'color', 'warmth', 'styles', 'rain_ok'],
  properties: {
    name: {
      type: 'string',
      description: 'Nom court en français, 2 à 5 mots, sans marque. Exemple : « Pull col roulé marine ».',
    },
    category: {
      type: 'string',
      enum: [...CATEGORIES],
      description:
        'haut : t-shirt, chemise, pull, sweat, top. bas : pantalon, jean, jupe, short. robe : robe ou combinaison. ' +
        'veste : veste, manteau, blouson, gilet. chaussures. accessoire : sac, écharpe, ceinture, bonnet, bijou.',
    },
    color: {
      type: 'string',
      description:
        'Couleur principale du vêtement, sans tenir compte du fond, au format #RRGGBB (un dièse puis six chiffres hexadécimaux).',
    },
    warmth: {
      type: 'integer',
      enum: [1, 2, 3],
      description: 'Chaleur : 1 léger (été), 2 moyen (mi-saison), 3 chaud (hiver).',
    },
    styles: {
      type: 'array',
      items: { type: 'string', enum: [...STYLES] },
      description:
        'Un ou plusieurs styles qui conviennent : decontracte (quotidien, détente), habille (bureau, soirée), sport.',
    },
    rain_ok: {
      type: 'boolean',
      description: 'Vrai si on peut le porter sous la pluie (imperméable, bottes, matière qui ne craint pas l’eau).',
    },
  },
} as const;
