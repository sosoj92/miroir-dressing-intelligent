'use client';

import { useId } from 'react';

// Contrôle segmenté du téléphone (direction A) : d'un seul tenant, segments de 32 px de même
// largeur, le segment choisi en relief (coins de 7 px, retrait de 2 px, ombre neutre shadow-control).
// Ce relief est un seul curseur qui glisse d'un segment à l'autre (200 ms, sans dépassement) ; les
// libellés ne bougent pas. De vrais boutons radio cachés : Tab entre dans le groupe, les flèches
// changent le choix, comme pour tout groupe radio du navigateur.

export type Segment<T extends string | number> = { value: T; label: string };

type SegmentedControlProps<T extends string | number> = {
  /** Nom du groupe lu par le lecteur d'écran : le titre affiché au-dessus (« Chaleur »). */
  label: string;
  options: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Nom des boutons radio (lecture par FormData) ; sans lui, un nom unique. */
  name?: string;
};

export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
  name,
}: SegmentedControlProps<T>) {
  const fallbackName = useId();
  const index = options.findIndex((option) => option.value === value);

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`relative flex rounded-[9px] bg-fill p-0.5 ${disabled ? 'opacity-60' : ''}`}
    >
      {/* Le curseur : la largeur d'un segment, décalé de `index` segments (translateX en % de sa
          propre largeur). Sous les libellés, qui le suivent dans le document. */}
      {index >= 0 ? (
        <span
          aria-hidden="true"
          className="absolute top-0.5 bottom-0.5 left-0.5 rounded-[7px] bg-segment shadow-control transition-transform duration-200 ease-standard motion-reduce:transition-none"
          style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
        />
      ) : null}
      {options.map((option) => (
        // before: agrandit la zone à toucher à 44 px de haut sans grossir le segment.
        <label
          key={String(option.value)}
          className="relative flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-[7px] px-2 text-center text-footnote font-semibold text-ink before:absolute before:inset-x-0 before:-inset-y-1.5 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-accent has-[input:disabled]:cursor-default"
        >
          <input
            type="radio"
            name={name ?? fallbackName}
            value={String(option.value)}
            checked={option.value === value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          <span className="truncate">{option.label}</span>
        </label>
      ))}
    </div>
  );
}
