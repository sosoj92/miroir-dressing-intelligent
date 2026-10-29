import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Rapports et captures de Playwright.
    "playwright-report/**",
    "test-results/**",
    "blob-report/**",
    // Environnements Python locaux (scripts/assemblage/, ignorés par git) : pas du code de l'app.
    ".venv*/**",
    "**/.venv*/**",
    // Moteur MediaPipe copié depuis node_modules (scripts/mediapipe-assets.mjs, ignoré par git).
    "public/mediapipe/wasm/**",
  ]),
]);

export default eslintConfig;
