import { expect, test } from '@playwright/test';
import { captureBothSchemes, isSupabaseConfigured, requireSupabase } from './support';

// Écrans du téléphone, joués en 390×844 (telephone) et en 800×1280 (tablette).
test.describe('connexion', () => {
  test("la page de connexion s'affiche", async ({ page }, testInfo) => {
    await page.goto('/connexion');
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    await expect(page.getByLabel('Adresse e-mail')).toBeVisible();
    await expect(page.getByLabel('Mot de passe')).toHaveAttribute('type', 'password');
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Recevoir un lien par e-mail' })).toBeEnabled();
    await captureBothSchemes(page, testInfo, 'connexion');
  });

  test('sans Supabase, le formulaire le dit au lieu de planter', async ({ page, request }) => {
    test.skip(await isSupabaseConfigured(request), 'Supabase configuré : ce test vise le mode sans clés');
    await page.goto('/connexion');
    await page.getByLabel('Adresse e-mail').fill('moi@example.com');
    await page.getByRole('button', { name: 'Recevoir un lien par e-mail' }).click();
    // Un échec, pas une confirmation : role=alert, de la couleur du texte (dans <main> : Next.js a
    // son propre role="alert").
    const alert = page.getByRole('main').getByRole('alert');
    await expect(alert).toHaveText("La connexion n'est pas encore configurée.");
    const colors = await alert.evaluate((element) => ({
      text: getComputedStyle(element).color,
      ink: getComputedStyle(document.body).color,
    }));
    expect(colors.text).toBe(colors.ink);
  });

  test('un lien sans code renvoie vers la connexion avec un message', async ({ page }, testInfo) => {
    await page.goto('/auth/callback');
    await expect(page).toHaveURL(/\/connexion\?erreur=lien$/);
    // Dans <main> : Next.js ajoute aussi son propre role="alert" (annonce des changements de page).
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      "Ce lien n'est plus valable. Demande-en un nouveau.",
    );
    await captureBothSchemes(page, testInfo, 'connexion-lien-expire');
  });

  test("le message d'un lien raté ne pousse pas le formulaire", async ({ page }) => {
    // Il n'arrive qu'après le chargement (useSearchParams) : il s'écrit sous les champs.
    await page.goto('/connexion');
    const field = page.getByLabel('Adresse e-mail');
    const before = await field.boundingBox();
    await page.goto('/connexion?erreur=lien&depuis=miroir');
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      "Ce lien n'est plus valable. Demande-en un nouveau.",
    );
    expect((await field.boundingBox())?.y).toBe(before?.y);
  });

  test('le retour au miroir passe par une table fixe, jamais par une adresse libre', async ({ page, baseURL }) => {
    const context = page.context();
    const host = new URL(baseURL ?? 'http://localhost').hostname;
    const fromCookie = async () => (await context.cookies()).find((cookie) => cookie.name === 'connexion-depuis');
    // Aucun appel à Supabase : la demande de lien échoue tout de suite, le cookie est déjà posé.
    await page.route(/\/auth\/v1\//, (route) => route.abort());

    // Lien demandé depuis le miroir : un cookie de valeur fixe, envoyé seulement à /auth.
    await page.goto('/connexion?depuis=miroir');
    await page.getByLabel('Adresse e-mail').fill('moi@example.com');
    await page.getByRole('button', { name: 'Recevoir un lien par e-mail' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
    expect(await fromCookie()).toMatchObject({ value: 'miroir', path: '/auth', sameSite: 'Lax' });

    // Lien raté : la connexion garde le retour au miroir pour le nouvel essai, le cookie est effacé.
    await page.goto('/auth/callback');
    await expect(page).toHaveURL(/\/connexion\?erreur=lien&depuis=miroir$/);
    await expect(page.getByLabel('Adresse e-mail')).toBeVisible();
    expect(await fromCookie()).toBeUndefined();

    // Toute autre valeur est ignorée, et la query n'est pas lue.
    await context.addCookies([{ name: 'connexion-depuis', value: 'https://exemple.com', domain: host, path: '/auth' }]);
    await page.goto('/auth/callback?depuis=miroir');
    await expect(page).toHaveURL(/\/connexion\?erreur=lien$/);

    // Un lien demandé ensuite depuis le téléphone n'hérite pas du miroir.
    await context.addCookies([{ name: 'connexion-depuis', value: 'miroir', domain: host, path: '/auth' }]);
    await page.goto('/connexion');
    await page.getByLabel('Adresse e-mail').fill('moi@example.com');
    await page.getByRole('button', { name: 'Recevoir un lien par e-mail' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
    expect(await fromCookie()).toBeUndefined();
  });

  test('un lien ouvert sans vérificateur PKCE renvoie vers la connexion', async ({ page, request }, testInfo) => {
    // Aucun appel réseau : sans le cookie du vérificateur PKCE (lien ouvert dans un autre
    // navigateur), @supabase/ssr échoue avant d'appeler Supabase. Il faut quand même les
    // NEXT_PUBLIC_* pour créer le client, et ALLOWED_USER_ID (lu avant l'échange, sinon « lien »).
    await requireSupabase(request, testInfo, test.skip);
    await page.goto('/auth/callback?code=code-invalide');
    await expect(page).toHaveURL(/\/connexion\?erreur=navigateur$/);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      "Ouvre le lien dans le navigateur où tu l'as demandé.",
    );
    await captureBothSchemes(page, testInfo, 'connexion-autre-navigateur');
  });
});

test.describe('gestion', () => {
  // Sans session (et même sans Supabase configuré), chaque écran du téléphone répond sans erreur
  // serveur et demande une connexion.
  const screens = [
    { path: '/gestion', heading: 'Mon Dressing', capture: 'gestion-sans-session' },
    { path: '/gestion/import', heading: 'Importer', capture: 'import-sans-session' },
    { path: '/gestion/reglages', heading: 'Réglages', capture: 'reglages-sans-session' },
    { path: '/gestion/demain', heading: 'Demain', capture: 'demain-sans-session' },
    { path: '/gestion/ecartees', heading: 'Tenues écartées', capture: 'ecartees-sans-session' },
  ];

  for (const screen of screens) {
    test(`sans session, ${screen.path} demande une connexion`, async ({ page }, testInfo) => {
      const response = await page.goto(screen.path);
      expect(response?.status(), 'pas d’erreur serveur').toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: screen.heading, exact: true })).toBeVisible();
      await expect(page.getByText('Connexion requise')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Connecte-toi' })).toHaveAttribute('href', '/connexion');
      // Rien de privé ne s'affiche sans session.
      await expect(page.getByText('Choisir un fichier')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Garde-robe' })).toHaveCount(0);
      await captureBothSchemes(page, testInfo, screen.capture, { fullPage: true });
    });
  }

  test("l'onglet de l'accueil s'appelle « Mon Dressing »", async ({ page }) => {
    await page.goto('/gestion');
    await expect(page).toHaveTitle('Mon Dressing');
    await page.goto('/gestion/reglages');
    await expect(page).toHaveTitle('Réglages · Mon Dressing');
  });

  test("les sous-pages ramènent à l'accueil de la gestion", async ({ page }) => {
    await page.goto('/gestion/reglages');
    await expect(page.getByRole('link', { name: 'Mon Dressing', exact: true })).toHaveAttribute('href', '/gestion');
  });

  test('le titre est au même endroit sur tous les écrans, accueil et connexion compris', async ({ page }) => {
    const tops: Record<string, number | undefined> = {};
    for (const path of ['/gestion', '/connexion', '/gestion/reglages', '/gestion/garde-robe', '/gestion/ecartees']) {
      await page.goto(path);
      const heading = page.getByRole('heading', { level: 1 });
      await expect(heading).toBeVisible();
      tops[path] = (await heading.boundingBox())?.y;
    }
    // Sous la barre du haut (44 px, vide sur l'accueil et la connexion), à 84 px partout.
    expect(new Set(Object.values(tops)), JSON.stringify(tops)).toEqual(new Set([84]));
  });

  test("le filet sous la barre du haut n'apparaît que quand le contenu passe dessous", async ({ page }) => {
    // Une fenêtre basse : l'écran sans session défile un peu.
    await page.setViewportSize({ width: 390, height: 200 });
    await page.goto('/gestion/reglages');
    await expect(page.getByText('Connexion requise')).toBeVisible();
    const bar = page.locator('main > div.sticky').first();
    const edge = () =>
      bar.evaluate((element) => ({
        color: getComputedStyle(element, '::after').backgroundColor,
        height: element.getBoundingClientRect().height,
      }));

    await expect.poll(edge).toEqual({ color: 'rgba(0, 0, 0, 0)', height: 44 });
    await page.evaluate(() => window.scrollTo(0, 40));
    // Gris neutre du séparateur (#c6c6c8 en clair) ; la barre garde ses 44 px.
    await expect.poll(edge).toEqual({ color: 'rgb(198, 198, 200)', height: 44 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(edge).toEqual({ color: 'rgba(0, 0, 0, 0)', height: 44 });
  });

  test('le filet apparaît aussi quand la barre se colle à moins d’un pixel près', async ({ page }) => {
    // Sur iPhone, le défilement avance par tiers de pixel : au seul rappel de l'observateur, le haut
    // de la barre peut être à 0,7 px. Chromium arrondit scrollTo au pixel : la page est décalée de
    // 0,7 px à la place (16,7 px au lieu de 16).
    await page.setViewportSize({ width: 390, height: 200 });
    await page.goto('/gestion/reglages');
    await expect(page.getByText('Connexion requise')).toBeVisible();
    await page.locator('main').evaluate((main) => {
      main.style.paddingTop = '16.7px';
    });
    const bar = page.locator('main > div.sticky').first();
    const edge = () => bar.evaluate((element) => getComputedStyle(element, '::after').backgroundColor);

    await expect.poll(edge).toBe('rgba(0, 0, 0, 0)');
    await page.evaluate(() => window.scrollTo(0, 16));
    expect(await bar.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(0.7, 1);
    await expect.poll(edge).toBe('rgb(198, 198, 200)');
    await page.evaluate(() => window.scrollTo(0, 40));
    await expect.poll(edge).toBe('rgb(198, 198, 200)');
  });

  test('sur la garde-robe, la barre du haut n’a pas de filet : seule la bande collée en porte un', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 200 });
    await page.goto('/gestion/garde-robe');
    await expect(page.getByRole('heading', { level: 1, name: 'Garde-robe' })).toBeVisible();
    const bar = page.locator('main > div.sticky').first();
    await page.evaluate(() => window.scrollTo(0, 40));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(16);
    expect(
      await bar.evaluate((element) => ({
        stuck: element.hasAttribute('data-stuck'),
        color: getComputedStyle(element, '::after').backgroundColor,
      })),
    ).toEqual({ stuck: false, color: 'rgba(0, 0, 0, 0)' });
  });

  test('les boutons texte ont la même écriture : taille du texte, graisse normale', async ({ page }) => {
    await page.goto('/gestion');
    const signIn = page.getByRole('link', { name: 'Connecte-toi' });
    await expect(signIn).toBeVisible();
    expect(await signIn.evaluate((element) => getComputedStyle(element).fontWeight)).toBe('400');

    await page.goto('/connexion');
    const font = (name: string) =>
      page.getByText(name, { exact: true }).evaluate((element) => {
        const style = getComputedStyle(element);
        return `${style.fontSize} ${style.fontWeight}`;
      });
    expect(await font('Recevoir un lien par e-mail')).toBe(await font('Adresse e-mail'));
  });
});

test.describe('thème', () => {
  test('le téléphone suit le thème du système, le miroir reste en sombre', async ({ page }) => {
    // Cases et menus natifs dans le thème du système ; barre du navigateur de la couleur du fond.
    await page.goto('/connexion');
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'light dark');
    await expect(page.locator('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]')).toHaveAttribute(
      'content',
      '#000000',
    );
    await expect(page.locator('meta[name="theme-color"][media="(prefers-color-scheme: light)"]')).toHaveAttribute(
      'content',
      '#f2f2f7',
    );
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light dark');

    // Système en clair (par défaut dans Playwright) : le miroir garde son color-scheme sombre.
    await page.goto('/');
    await expect(page.locator('main[data-screen="mirror"]')).toBeAttached();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  });
});
