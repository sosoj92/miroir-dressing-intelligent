import type { SVGProps } from 'react';

// Pictogrammes du miroir : icônes au trait, jamais d'emoji (AGENTS.md, Design ; docs/conception.md §4).

const stroke: SVGProps<SVGSVGElement> = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

/** `size` : hauteur en px (40 sur le miroir, lisible à 1–2 m). */
type IconProps = { className?: string; size?: number };

/** ← → : défiler. */
export function ScrollIcon({ className, size = 24 }: IconProps) {
  return (
    <svg viewBox="0 0 44 24" width={(size * 44) / 24} height={size} className={className} {...stroke}>
      <path d="M3 12h13M8 7l-5 5 5 5" />
      <path d="M41 12H28M36 7l5 5-5 5" />
    </svg>
  );
}

/** ↑ ↓ : changer le bas. */
export function UpDownIcon({ className, size = 24 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...stroke}>
      <path d="M8 3v13M3 8l5-5 5 5" />
      <path d="M16 21V8M11 16l5 5 5-5" />
    </svg>
  );
}

/** Pouce levé : oui. */
export function ThumbUpIcon({ className, size = 24 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...stroke}>
      <path d="M7 10v10H4.5A1.5 1.5 0 0 1 3 18.5v-7A1.5 1.5 0 0 1 4.5 10H7Z" />
      <path d="M7 10l3.6-6.3a1.6 1.6 0 0 1 2.9.9V9h5a2 2 0 0 1 2 2.4l-1.3 6.8A2.2 2.2 0 0 1 17 20H7" />
    </svg>
  );
}

/** Signe V (deux doigts levés) : veste suivante. Dans la légende, devant « veste ». */
export function VictoryIcon({ className, size = 24 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...stroke}>
      <path d="M8.6 11.4 6.6 4.4a1.5 1.5 0 0 1 2.9-.8L12 10.6l2.5-7a1.5 1.5 0 0 1 2.9.8l-2 7" />
      <path d="M15.4 11.4a1.6 1.6 0 0 1 3.1.6V16a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5v-2.3a2.3 2.3 0 0 1 2.1-2.3" />
      <path d="M6.5 15c2-1.1 4.6-1.3 7.2-.5" />
    </svg>
  );
}

/** Poing fermé : non. */
export function FistIcon({ className, size = 24 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...stroke}>
      <path d="M7 11V8.5a1.75 1.75 0 0 1 3.5 0V11" />
      <path d="M10.5 10.5v-3a1.75 1.75 0 0 1 3.5 0v3" />
      <path d="M14 10.5V8a1.75 1.75 0 0 1 3.5 0v2.5" />
      <path d="M17.5 10v-.5a1.75 1.75 0 0 1 3.5 0V14a7 7 0 0 1-7 7h-2.5A6.5 6.5 0 0 1 5 14.5V13a2 2 0 0 1 2-2h4.5a1.75 1.75 0 0 1 0 3.5H9" />
    </svg>
  );
}
