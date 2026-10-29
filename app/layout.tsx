import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Mon Dressing', template: '%s · Mon Dressing' },
  description: 'Le miroir qui propose ta tenue du jour.',
  robots: { index: false, follow: false },
};

// Téléphone : cases et menus natifs dans le thème du système, barre du navigateur de la couleur
// du fond (--color-canvas de globals.css, clair et sombre). Le miroir a son propre viewport (app/page.tsx).
export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
    { media: '(prefers-color-scheme: light)', color: '#f2f2f7' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
