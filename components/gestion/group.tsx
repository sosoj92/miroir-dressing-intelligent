import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight } from './icons';

// Liste groupée du téléphone (direction A, comme les réglages d'un iPhone) : un encart aux coins
// arrondis, des lignes séparées par un filet, sans bordure autour. La même recette pour tous les
// écrans de la gestion (accueil, réglages, fiche, connexion, tenues écartées).

/**
 * Le filet entre deux lignes commence sous le texte (16 px du bord gauche) et touche le bord droit,
 * comme sur iPhone : posé sous chaque ligne sauf la dernière (::after, la ligne est en relative).
 * Une ligne touchée (active:bg-fill) garde toute sa largeur.
 */
const listClass =
  'overflow-hidden rounded-xl bg-surface *:not-last:after:pointer-events-none *:not-last:after:absolute *:not-last:after:right-0 *:not-last:after:bottom-0 *:not-last:after:left-4 *:not-last:after:h-px *:not-last:after:bg-separator';

/**
 * Classe d'une ligne, pour une ligne faite à la main (libellé qui coche une case, bouton…).
 * Sans couleur de texte : la ligne prend celle de la page (text-ink), ou `text-accent` ajouté.
 * Le contour de focus est tracé à l'intérieur : l'encart (overflow-hidden) couperait celui du dehors.
 * En relative : le filet de l'encart se pose en bas de la ligne.
 */
export const rowClass =
  'relative flex min-h-11 items-center justify-between gap-4 px-4 py-[11px] text-body focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent';

/**
 * Ligne qui contient un champ (texte, ou caché sur toute la ligne : menu, couleur) : le contour de
 * focus du champ est tracé autour de la ligne. Un champ caché va en `absolute inset-0 h-full w-full
 * opacity-0`, sinon il garde sa largeur propre.
 */
export const fieldRowClass = `${rowClass} has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-accent`;

/** Ligne bouton (résultat d'une recherche, « Refaire le test des touches ») : toute la largeur, à gauche. */
export const buttonRowClass = `${rowClass} w-full text-left active:bg-fill disabled:opacity-60`;

/**
 * Ligne bouton au libellé centré : un bouton seul dans son encart (« Choisir dans la galerie »,
 * « Supprimer ce vêtement », « Recommencer le choix ») et la confirmation sur place (« Supprimer » |
 * « Annuler »). En prune (`text-accent`) quand il ajoute ou ouvre, de la couleur du texte quand il efface.
 */
export const centeredButtonRowClass = `${buttonRowClass} justify-center`;

/**
 * Un encart de lignes (Row, ou lignes faites avec rowClass, enfants directs pour garder les filets),
 * avec un titre de section facultatif au-dessus, en casse normale.
 */
export function Group({ title, className = '', children }: { title?: string; className?: string; children: ReactNode }) {
  if (!title) return <div className={`${listClass} ${className}`}>{children}</div>;

  return (
    <section className={`flex flex-col ${className}`}>
      <h2 className="px-4 pb-1.5 text-footnote text-muted">{title}</h2>
      <div className={listClass}>{children}</div>
    </section>
  );
}

type RowProps = {
  /** Libellé, à gauche. */
  children: ReactNode;
  /** Valeur à droite, en gris (« 3 au sale », « Prévue ») ; rien si vide. */
  value?: string;
} & (
  | {
      /** Toute la ligne mène à cette adresse, avec un chevron à droite. */
      href: string;
      control?: never;
    }
  | {
      href?: undefined;
      /** Contrôle à droite (Switch…), après la valeur. Pas dans une ligne lien. */
      control?: ReactNode;
    }
);

/** Une ligne d'un Group : libellé à gauche ; valeur, contrôle ou chevron à droite. */
export function Row({ children, value, control, href }: RowProps) {
  const label = <span className="min-w-0">{children}</span>;
  const shown = value ? <span className="text-muted">{value}</span> : null;

  if (href) {
    return (
      <Link href={href} className={`${rowClass} active:bg-fill`}>
        {label}
        <span className="flex shrink-0 items-center gap-1.5">
          {shown}
          <ChevronRight className="size-5 text-muted" />
        </span>
      </Link>
    );
  }

  return (
    <div className={rowClass}>
      {label}
      {shown || control ? (
        <span className="flex shrink-0 items-center gap-3">
          {shown}
          {/* -my-[11px] : un contrôle de 44 px (zone à toucher) garde la ligne à 44 px de haut. */}
          {control ? <span className="-my-[11px] flex items-center">{control}</span> : null}
        </span>
      ) : null}
    </div>
  );
}
