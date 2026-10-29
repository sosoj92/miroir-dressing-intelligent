// Pictogrammes au trait (AGENTS.md, Design) : SVG inline, couleur du texte.

type IconProps = { className?: string };

export function ChevronRight({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M7.5 4.5 13 10l-5.5 5.5" />
    </svg>
  );
}

export function ChevronLeft({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M12.5 4.5 7 10l5.5 5.5" />
    </svg>
  );
}

export function ChevronDown({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M4.5 7.5 10 13l5.5-5.5" />
    </svg>
  );
}

/** Chevrons haut et bas : une valeur qui ouvre la liste native des choix. */
export function ChevronUpDown({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M6.5 7.5 10 4l3.5 3.5M6.5 12.5 10 16l3.5-3.5" />
    </svg>
  );
}

/** Loupe : champ de recherche (ville de la météo). */
export function SearchIcon({ className = 'size-[17px]' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" className={className}>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="m12.5 12.5 4 4" />
    </svg>
  );
}
