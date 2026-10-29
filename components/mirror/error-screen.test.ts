import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Écrans de secours (app/error.tsx, app/global-error.tsx) : le miroir sur « / » (ou une adresse
// inconnue), le téléphone ailleurs. Rendus sans navigateur ; l'adresse vient d'un faux usePathname.

const navigation = vi.hoisted(() => ({ pathname: '/' as string | null }));

vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));
vi.mock('next/link', async () => {
  const react = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      react.createElement('a', { href, ...rest }, children),
  };
});

import GlobalError from '@/app/global-error';
import { ErrorScreen } from '@/components/error-screen';
import { MIRROR_ERROR_TEXT } from './error-screen';

/** Le premier <button> rendu par un composant, cherché dans ses enfants à toute profondeur. */
function findButton(node: ReactNode): ReactElement<{ onClick: () => void }> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === 'button') return child as ReactElement<{ onClick: () => void }>;
    const found = findButton(child.props.children);
    if (found) return found;
  }
  return undefined;
}

/** Le texte du HTML rendu, apostrophes décodées. */
function html(element: ReactElement): string {
  return renderToStaticMarkup(element).replace(/&#x27;/g, "'");
}

beforeEach(() => {
  navigation.pathname = '/';
});

describe('écran de secours', () => {
  it('sur le miroir (« / ») et sur une adresse inconnue : la ligne grise, sans bouton', () => {
    for (const pathname of ['/', null]) {
      navigation.pathname = pathname;
      const markup = html(createElement(ErrorScreen, { retry: () => {} }));
      expect(markup).toContain(MIRROR_ERROR_TEXT);
      expect(markup).toContain('data-screen="mirror"');
      expect(markup).toContain('background:#000');
      expect(markup).not.toContain('<button');
      expect(markup).not.toContain('Réessayer');
    }
  });

  it('sur le téléphone : « Cet écran n’a pas pu s’afficher. » et « Réessayer », qui relance l’écran', () => {
    navigation.pathname = '/gestion';
    const retry = vi.fn();
    const markup = html(createElement(ErrorScreen, { retry }));
    // Comme LoadError : la phrase de la couleur du texte, annoncée (role=alert).
    expect(markup).toContain(`<p role="alert" class="text-body text-ink">Cet écran n'a pas pu s'afficher.</p>`);
    expect(markup).toContain('>Réessayer</button>');
    expect(markup).toContain('href="/gestion"');
    expect(markup).not.toContain(MIRROR_ERROR_TEXT);

    // Le bouton appelle retry() (qui relit aussi les données).
    const button = findButton(ErrorScreen({ retry }));
    expect(button).toBeDefined();
    button?.props.onClick();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('mise en page racine en panne, sur le miroir : document en français, fond noir en ligne', () => {
    const markup = html(createElement(GlobalError, { error: new Error('panne'), retry: () => {} }));
    expect(markup).toMatch(/^<html lang="fr"[^>]*style="background:#000"/);
    expect(markup).toContain('<body class="min-h-full" style="margin:0;background:#000;color:#ccc">');
    expect(markup).toContain('<title>Mon Dressing</title>');
    expect(markup).toContain(MIRROR_ERROR_TEXT);
    expect(markup).not.toContain('panne');
  });

  it('mise en page racine en panne, sur le téléphone : son écran, sans fond noir imposé', () => {
    navigation.pathname = '/gestion/demain';
    const markup = html(createElement(GlobalError, { error: new Error('panne'), retry: () => {} }));
    expect(markup).toMatch(/^<html lang="fr"/);
    expect(markup).not.toContain('background:#000');
    expect(markup).toContain("Cet écran n'a pas pu s'afficher.");
  });
});
