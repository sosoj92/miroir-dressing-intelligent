'use client';

import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { fieldRowClass, Group, Row } from '@/components/gestion/group';
import { ChevronUpDown } from '@/components/gestion/icons';
import { SegmentedControl } from '@/components/gestion/segmented-control';
import { Switch } from '@/components/gestion/switch';
import { sameDraft, showsRain, warmthHint } from '@/lib/items/form';
import { checkDraft, MAX_NAME_LENGTH } from '@/lib/items/validate';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  STYLES,
  STYLE_LABELS,
  WARMTH_LABELS,
  type ItemDraft,
  type Style,
  type Warmth,
} from '@/lib/types';
import { CheckIcon } from './icons';
import { useSaveSlot } from './save-slot';

const WARMTH_OPTIONS = ([1, 2, 3] as const).map((value) => ({ value, label: WARMTH_LABELS[value] }));
const DEFAULT_SWATCH = '#808080';

/** Titre de section, comme celui de Group, pour un champ qui a besoin d'un vrai <label>. */
const titleClass = 'px-4 pb-1.5 text-footnote text-muted';

type ItemFormProps = {
  initialDraft: ItemDraft;
  /** Enregistre la fiche ; renvoie un message d'erreur, ou null si tout s'est bien passé. */
  onSubmit: (draft: ItemDraft) => Promise<string | null>;
  /**
   * Pièce déjà enregistrée : « Enregistrer » reste grisé tant que rien n'a changé, puis affiche
   * « Enregistré. ». Sans lui (ajout), la fiche proposée s'enregistre telle quelle.
   */
  editing?: boolean;
  /** En bas du formulaire (« Recommencer »). */
  children?: ReactNode;
};

/**
 * Formulaire de correction d'une fiche (docs/conception.md §4, écran 3, étape 4), partagé par l'ajout et la
 * fiche. À placer sous un SaveSlot : « Enregistrer » est dans la ligne retour (save-slot.tsx).
 */
export function ItemForm({ initialDraft, onSubmit, editing = false, children }: ItemFormProps) {
  const id = useId();
  const [name, setName] = useState(initialDraft.name);
  const [category, setCategory] = useState(initialDraft.category);
  const [swatch, setSwatch] = useState((initialDraft.color ?? DEFAULT_SWATCH).toLowerCase());
  const [noColor, setNoColor] = useState(initialDraft.color === null);
  const [warmth, setWarmth] = useState<Warmth>(initialDraft.warmth);
  const [styles, setStyles] = useState<Style[]>(initialDraft.styles);
  const [rainOk, setRainOk] = useState(initialDraft.rain_ok);
  // Dernière fiche enregistrée : « Enregistrer » se grise de nouveau après un enregistrement.
  const [baseline, setBaseline] = useState(initialDraft);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const errorRef = useRef<HTMLParagraphElement>(null);

  const check = checkDraft({
    name,
    category,
    color: noColor ? null : swatch,
    warmth,
    styles,
    rain_ok: rainOk,
  });
  // Une fiche invalide (nom vidé) compte comme changée : « Enregistrer » dit alors ce qui manque.
  const changed = !check.ok || !sameDraft(check.draft, baseline);
  const formId = useSaveSlot({
    canSave: !editing || changed,
    pending,
    saved: editing && justSaved && !changed,
  });

  // « Enregistrer » est en haut, l'erreur en bas du formulaire : on l'amène à l'écran.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  function toggleStyle(style: Style, checked: boolean) {
    setStyles((current) => (checked ? [...current, style] : current.filter((value) => value !== style)));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || (editing && !changed)) return;
    if (!check.ok) {
      setError(check.error);
      return;
    }
    const draft = check.draft;
    setError(null);
    setJustSaved(false);
    startTransition(async () => {
      const message = await onSubmit(draft);
      if (message) {
        setError(message);
        return;
      }
      setBaseline(draft);
      setJustSaved(true);
    });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-8" noValidate>
      <div className="flex flex-col">
        <label htmlFor={`${id}-name`} className={titleClass}>
          Nom
        </label>
        <input
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="off"
          enterKeyHint="done"
          required
          className="min-h-11 w-full rounded-xl bg-surface px-4 py-[11px] text-body text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        />
      </div>

      <Group>
        <label className={fieldRowClass}>
          <span>Catégorie</span>
          <span className="flex items-center gap-1 text-muted">
            {CATEGORY_LABELS[category]}
            <ChevronUpDown />
          </span>
          <select
            aria-label="Catégorie"
            value={category}
            onChange={(event) => setCategory(event.target.value as ItemDraft['category'])}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          >
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldRowClass}>
          <span className={noColor ? 'text-muted' : undefined}>Couleur</span>
          {/* Rond de 28 px ; -my-[3px] : la ligne garde 44 px de haut. Un filet intérieur de 1 px à
              25 % de l'encre, qui suit le thème : un rond noir se voit en sombre, un blanc en clair. */}
          <span
            aria-hidden="true"
            className={`-my-[3px] size-7 shrink-0 rounded-full inset-ring inset-ring-ink/25 ${noColor ? 'opacity-40' : ''}`}
            style={{ backgroundColor: swatch }}
          />
          <input
            type="color"
            aria-label="Couleur"
            value={swatch}
            disabled={noColor}
            onChange={(event) => setSwatch(event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
          />
        </label>
        <Row control={<Switch label="Va avec tout" checked={noColor} onChange={setNoColor} />}>Va avec tout</Row>
      </Group>

      <section className="flex flex-col">
        <h2 className={titleClass}>Chaleur</h2>
        <SegmentedControl label="Chaleur" options={WARMTH_OPTIONS} value={warmth} onChange={setWarmth} />
        <p className="px-4 pt-1.5 text-footnote text-muted">{warmthHint(warmth)}</p>
      </section>

      <Group title="Styles">
        {STYLES.map((value) => {
          const checked = styles.includes(value);
          return (
            <label key={value} className={fieldRowClass}>
              <span>{STYLE_LABELS[value]}</span>
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => toggleStyle(value, event.target.checked)}
                className="sr-only"
              />
              <CheckIcon width={20} height={20} className={`shrink-0 text-accent ${checked ? '' : 'invisible'}`} />
            </label>
          );
        })}
      </Group>

      {/* Ailleurs que sur une veste ou des chaussures, la valeur reste celle de la fiche. */}
      {showsRain(category) ? (
        <Group>
          <Row control={<Switch label="Protège de la pluie" checked={rainOk} onChange={setRainOk} />}>
            Protège de la pluie
          </Row>
        </Group>
      ) : null}

      {error || children ? (
        <div className="flex flex-col gap-3">
          {error ? (
            <p ref={errorRef} role="alert" className="px-4 text-footnote text-ink">
              {error}
            </p>
          ) : null}
          {children}
        </div>
      ) : null}
    </form>
  );
}
