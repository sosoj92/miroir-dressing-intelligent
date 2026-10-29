import { defineConfig } from '@playwright/test';

// Ce fichier ne lit que process.env.CI (AGENTS.md).
const PORT = 3210;

/** Tablette Android testée, 800 × 1280 en portrait (docs/conception.md §2). */
const TABLET = { browserName: 'chromium' as const, viewport: { width: 800, height: 1280 }, deviceScaleFactor: 2 };

/** Tests qui ont besoin de la fausse caméra de Chromium (gestes, docs/conception.md §5) : projet « camera ». */
const CAMERA_TAG = /@camera/;

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // Tablette : tous les tests, sauf ceux de la caméra. Sans caméra, Chromium de test répond
      // « pas de caméra » : le miroir n'affiche rien de plus et marche au clavier.
      name: 'tablette',
      grepInvert: CAMERA_TAG,
      use: TABLET,
    },
    {
      // La même tablette, avec la fausse caméra de Chromium (une mire, jamais une personne) et
      // l'autorisation déjà donnée : les tests @camera du miroir.
      name: 'camera',
      testMatch: /miroir\.spec\.ts$/,
      grep: CAMERA_TAG,
      use: {
        ...TABLET,
        permissions: ['camera'],
        launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
      },
    },
    {
      // Téléphone : seulement les écrans du téléphone.
      name: 'telephone',
      testMatch: /telephone\.spec\.ts$/,
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
