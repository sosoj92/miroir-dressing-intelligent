'use client';

import type { ChangeEvent, ReactNode } from 'react';
import { centeredButtonRowClass } from '@/components/gestion/group';

type PhotoButtonProps = {
  label: string;
  icon?: ReactNode;
  /** `environment` ouvre directement l'appareil photo arrière ; sans valeur, le téléphone propose le choix. */
  capture?: 'environment';
  /**
   * Les trois recettes de bouton (components/gestion/buttons.ts) : `primary` plein, `row` ligne
   * d'encart en prune (à placer dans un <Group>), `text` bouton texte.
   */
  variant: 'primary' | 'row' | 'text';
  disabled?: boolean;
  onPick: (file: File) => void;
};

// Le contour de focus du champ caché : autour du bouton plein ou du texte, à l'intérieur de la
// ligne (l'encart, overflow-hidden, couperait celui du dehors). Désactivé comme le reste de l'app :
// pâli pour un bouton plein ou une ligne, gris pour un bouton texte. Le bouton texte pâlit sous le
// doigt comme les autres (pressFeedback, components/gestion/buttons.ts), mais seulement si son champ
// est actif : le :active d'un libellé ne s'arrête pas quand le champ est désactivé.
const variants: Record<PhotoButtonProps['variant'], string> = {
  primary:
    'justify-center rounded-xl bg-accent px-4 py-3 font-semibold text-on-accent has-[input:focus-visible]:outline-offset-2 has-[input:disabled]:opacity-60',
  row: `${centeredButtonRowClass} text-accent has-[input:focus-visible]:-outline-offset-2 has-[input:disabled]:opacity-60`,
  text: 'min-h-11 text-accent transition-opacity duration-100 ease-standard has-[input:enabled]:active:opacity-60 has-[input:focus-visible]:outline-offset-2 has-[input:disabled]:text-muted',
};

/** Bouton qui ouvre l'appareil photo ou la galerie (champ fichier caché dans le libellé). */
export function PhotoButton({ label, icon, capture, variant, disabled, onPick }: PhotoButtonProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // pour pouvoir choisir deux fois la même photo
    if (file) onPick(file);
  }

  return (
    <label
      className={`flex cursor-pointer items-center text-body has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-accent has-[input:disabled]:cursor-default ${variants[variant]}`}
    >
      {/* L'icône et le libellé ensemble : 8 px entre eux, quel que soit l'écart de la ligne. */}
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <input
        type="file"
        accept="image/*"
        capture={capture}
        disabled={disabled}
        onChange={handleChange}
        className="sr-only"
      />
    </label>
  );
}
