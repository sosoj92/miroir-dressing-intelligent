import { expect, test } from '@playwright/test';
import { captureBothSchemes } from './support';

// Garde-robe (téléphone), jouée en 390×844 (telephone) et en 800×1280 (tablette).
// Sans session, chaque écran le dit au lieu de planter, que Supabase soit configuré ou non.

const ITEM_ID = '0a1b2c3d-0000-4000-8000-00000000a11d';

const SCREENS = [
  { path: '/gestion/garde-robe', heading: 'Garde-robe', capture: 'garde-robe-sans-session' },
  { path: '/gestion/garde-robe/ajouter', heading: 'Ajouter un vêtement', capture: 'garde-robe-ajouter-sans-session' },
  { path: `/gestion/garde-robe/${ITEM_ID}`, heading: 'Vêtement', capture: 'garde-robe-fiche-sans-session' },
  { path: '/gestion/garde-robe/au-sale', heading: 'Au sale', capture: 'garde-robe-au-sale-sans-session' },
] as const;

test.describe('garde-robe sans session', () => {
  for (const screen of SCREENS) {
    test(`${screen.path} demande une connexion`, async ({ page }, testInfo) => {
      const response = await page.goto(screen.path);
      expect(response, 'réponse HTTP').not.toBeNull();
      expect(response!.status(), 'pas d’erreur serveur').toBeLessThan(500);

      await expect(page.getByRole('heading', { level: 1, name: screen.heading, exact: true })).toBeVisible();
      await expect(page.getByText('Connexion requise')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Connecte-toi' })).toHaveAttribute('href', '/connexion');

      // Aucun défilement horizontal sur le téléphone.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      await captureBothSchemes(page, testInfo, screen.capture, { fullPage: true });
    });
  }

  test('sans session, ni le lien « Ajouter » ni le champ photo ne sont proposés', async ({ page }) => {
    await page.goto('/gestion/garde-robe');
    await expect(page.getByText('Connexion requise')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ajouter', exact: true })).toHaveCount(0);

    await page.goto('/gestion/garde-robe/ajouter');
    await expect(page.getByText('Connexion requise')).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
  });

  test('une fiche à l’id mal formé répond « introuvable », sans erreur serveur', async ({ page }, testInfo) => {
    const response = await page.goto('/gestion/garde-robe/pas-un-identifiant');
    expect(response, 'réponse HTTP').not.toBeNull();
    expect(response!.status()).toBeLessThan(500);
    // app/not-found.tsx : page en français, avec le retour vers la gestion.
    await expect(page.getByRole('heading', { level: 1, name: 'Page introuvable' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mon Dressing', exact: true })).toHaveAttribute('href', '/gestion');
    await expect(page.getByText('Connexion requise')).toHaveCount(0);
    await captureBothSchemes(page, testInfo, 'garde-robe-fiche-introuvable');
  });
});
