import type { SVGProps } from 'react';

// Pictogrammes au trait (AGENTS.md, Design) : couleur du texte, aucun remplissage.

type IconProps = SVGProps<SVGSVGElement>;

function Stroke({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </Stroke>
  );
}

export function GalleryIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M20 16l-5-5-8 8" />
    </Stroke>
  );
}

/** Coche seule : rond « au sale » des vignettes en mode marquage, styles choisis de la fiche. */
export function CheckIcon(props: IconProps) {
  return (
    <Stroke width={16} height={16} strokeWidth={2.25} {...props}>
      <path d="M6 12.5l4 4 8-9" />
    </Stroke>
  );
}
