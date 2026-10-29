import type { APIRequestContext, Page, TestInfo } from '@playwright/test';

// Les tests ne lisent pas .env.local : c'est le serveur qui dit si Supabase est configuré.
export async function isSupabaseConfigured(request: APIRequestContext): Promise<boolean> {
  const response = await request.get('/api/health');
  const body = (await response.json()) as { supabase?: string };
  return body.supabase === 'configurée';
}

export const SUPABASE_MISSING =
  'NEXT_PUBLIC_SUPABASE_URL absente : test Supabase ignoré (remplis .env.local puis relance)';

/** Saute le test tant que Supabase n'est pas configuré, et le dit dans la sortie. */
export async function requireSupabase(
  request: APIRequestContext,
  testInfo: TestInfo,
  skip: (condition: boolean, reason: string) => void,
) {
  const configured = await isSupabaseConfigured(request);
  if (!configured) console.log(`[${testInfo.project.name}] ${testInfo.title} — ${SUPABASE_MISSING}`);
  skip(!configured, SUPABASE_MISSING);
}

/** Captures d'écran rangées par appareil : test-results/captures/<projet>/<nom>.png */
export function capturePath(testInfo: TestInfo, name: string): string {
  return `test-results/captures/${testInfo.project.name}/${name}.png`;
}

/**
 * Écran du téléphone capturé dans les deux thèmes : <nom>.png en clair, <nom>-sombre.png en sombre.
 * La page revient ensuite en clair (thème par défaut de Playwright).
 */
export async function captureBothSchemes(
  page: Page,
  testInfo: TestInfo,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: capturePath(testInfo, name), ...options });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: capturePath(testInfo, `${name}-sombre`), ...options });
  await page.emulateMedia({ colorScheme: 'light' });
}
