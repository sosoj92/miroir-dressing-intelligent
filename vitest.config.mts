import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Ce fichier ne lit aucune variable d'environnement (AGENTS.md).
export default defineConfig({
  resolve: {
    alias: [
      // `server-only` refuse d'être importé hors de Next.js : module vide pour les tests.
      { find: 'server-only', replacement: fileURLToPath(new URL('./test/server-only.ts', import.meta.url)) },
      { find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '.next/**', 'e2e/**'],
  },
});
