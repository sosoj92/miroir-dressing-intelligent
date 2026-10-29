import type { Metadata, Viewport } from 'next';
import { Mirror } from '@/components/mirror/mirror';

// Écran miroir (tablette, derrière le miroir sans tain). La page reste statique : aucune lecture
// de session côté serveur (donc jamais de 500 sans session). Le composant client lit
// /api/miroir, calcule les tenues dans le navigateur et répond aux gestes des bras (caméra
// frontale, MediaPipe sur l'appareil) et, en secours, au clavier (docs/conception.md §4, §5, §7 bis).
export const metadata: Metadata = { title: 'Miroir' };

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#000000',
  colorScheme: 'dark',
};

export default function MirrorPage() {
  return <Mirror />;
}
