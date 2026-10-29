# Pour les développeurs

Next.js 16 (App Router, Turbopack), TypeScript strict, Tailwind 4, Supabase (Postgres, Storage, Auth),
MediaPipe Tasks Vision dans le navigateur, Vercel. Node **22.12** ou plus récent (`.nvmrc` : 22), npm.
Versions figées : `package-lock.json` est commité et `.npmrc` contient `save-exact=true`.

Les règles du produit sont dans [conception.md](conception.md) ; les consignes de code, de design et de
secrets, dans [AGENTS.md](../AGENTS.md) ; la façon de proposer un changement, dans
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Commandes

| Commande | Ce qu'elle fait |
|---|---|
| `npm ci` | installe les dépendances aux versions du lockfile |
| `npm run dev` | serveur local sur `http://localhost:3000` ; avant, `scripts/mediapipe-assets.mjs` copie le moteur MediaPipe et télécharge les modèles s'ils manquent |
| `npm run build` | build de production ; même préparation avant (`prebuild`). Marche sans `.env.local` |
| `npm run start` | sert le build |
| `npm run lint` | ESLint (`next lint` n'existe plus dans Next 16) |
| `npm run typecheck` | `next typegen && tsc --noEmit` (sans `typegen`, les types de routes manquent sur un clone neuf) |
| `npm test` | Vitest, une fois, sans réseau ni variable d'environnement (quelques secondes) |
| `npm run e2e` | Playwright : build, puis serveur sur le port **3210**, puis les tests. Avant la première fois : `npx playwright install chromium` |
| `npm run check:secrets` | dans les fichiers suivis par git et les nouveaux fichiers non ignorés : des clés, les valeurs de `.env.local` (seul le nom de la variable s'affiche), toute image, archive, tableau ou fixture personnelle (seul `app/favicon.ico` est permis), et les fichiers supprimés du disque mais encore dans l'index (il faut un dépôt git) |

Avant de proposer un changement : `lint`, `typecheck`, `test`, `build`, `e2e` et `check:secrets` passent.

### Les tests

- **Vitest** : les fonctions pures (`lib/outfits/`, `lib/gestures/`, `lib/mirror/`, `lib/assembly/`…),
  l'import, les server actions avec un faux Supabase. Aucun appel réseau, aucune clé.
- **Playwright**, trois projets : `tablette` (800×1280, DPR 2, tout sauf `@camera`), `camera` (la même
  tablette avec la fausse caméra de Chromium, une mire, jamais une personne) et `telephone` (390×844,
  DPR 3). Playwright ne lit pas `.env.local` : les tests qui ont besoin de Supabase interrogent
  `/api/health` et se mettent en « skip » sans lui. Les captures vont dans
  `test-results/captures/<projet>/<écran>.png`.
- **Fixtures d'assemblage** : les tests de `lib/assembly` (et un bloc de `lib/mirror/deck.test.ts`) qui
  comparent le rendu TypeScript à la référence Python lisent `lib/assembly/fixtures/*.json`. Ces fichiers
  sont tirés de vraies photos : ils ne sont pas dans le dépôt (ignorés par git, refusés par
  `check:secrets`), et sur un clone ces tests sont **sautés**. Pour les produire depuis ton propre paquet :
  `scripts/assemblage/ref_fixture.py`. Ils ne passent alors entièrement que si ton jeu couvre les cas
  qu'ils attendent (au moins une paire au ventre étiré ; dans `paires.json`, les libellés exacts
  `bras nus`, `ventre étiré`, `manches longues`, `manches longues et ventre étiré`, et chacune des raisons
  du rendu actuel) : la liste complète est dans
  [`scripts/assemblage/README.md`](../scripts/assemblage/README.md#outil-de-développement--ref_fixturepy).
  Un cas manquant fait échouer le test qui le cherche, sans rien dire d'un bug de l'app.

## Les dossiers

| Dossier | Contenu |
|---|---|
| `app/` | les routes : `/` (miroir), `/connexion`, `/auth/callback`, `/gestion/…` (téléphone), `/api/…` (`health`, `me`, `miroir`) |
| `components/mirror/` | l'écran du miroir, la caméra et les gestes (`gestures/camera.ts`), le debug, l'écran de secours |
| `components/wardrobe/`, `components/gestion/` | les écrans du téléphone |
| `components/assembly/` | les silhouettes assemblées (canvas, vignettes) et leur cache de pré-rendu |
| `lib/outfits/` | `generateOutfits`, le score, les titres simples (fonctions pures) |
| `lib/gestures/` | la machine à états des gestes et ses constantes (fonctions pures) |
| `lib/mirror/` | l'état du miroir, la navigation, la file d'envoi, la caméra (pur) |
| `lib/assembly/` | le plan de dessin et le rendu canvas d'une silhouette assemblée |
| `lib/import/` | les deux imports : zip simple (`prototype.ts`, `zip.ts`, `images.ts`) et paquet d'assemblage (`assemblage*.ts`) |
| `lib/images/` | réduction des photos, détection des PNG détourés (`png-alpha.ts`), envoi dans Storage |
| `lib/items/`, `lib/keys/`, `lib/weather/`, `lib/geocoding/`, `lib/dates.ts` | fiches, touches de secours, météo et villes (Open-Meteo), dates dans le fuseau du profil |
| `lib/server/` | côté serveur seulement : variables d'environnement (`env.ts`), session (`auth.ts`), Claude, fal.ai, Storage |
| `lib/supabase/` | clients Supabase (navigateur, serveur) et lecture de la configuration publique |
| `supabase/` | `schema.sql` (tout le schéma) et `migrations/` (le même en quatre étapes) |
| `scripts/` | `mediapipe-assets.mjs`, `check-secrets.mjs`, et `assemblage/` (la chaîne photos du PC, en Python) |
| `e2e/` | les tests Playwright et leurs données synthétiques |
| `outils/` | `capteurs.html`, une page de démonstration des gestes, hors de l'app |
| `docs/` | cette documentation |

Points d'architecture à garder en tête :

- Le middleware s'appelle `proxy.ts` (Next 16) ; `cacheComponents` est actif : toute lecture de session va
  dans un `<Suspense>`.
- Chaque server action et chaque route vérifie elle-même le compte avec `requireUser()`
  (`lib/server/auth.ts`) : 401 sans session, 403 si l'id n'est pas `ALLOWED_USER_ID`. Seules exceptions :
  `/api/health` et `/auth/callback`.
- Les secrets ne sont lus que dans `lib/server/env.ts` (`import 'server-only'`).
- Les images de la caméra ne sortent jamais du navigateur ; les modèles MediaPipe sont servis par l'app.

## Changer le schéma de la base

Ajoute une migration dans `supabase/migrations/` (relançable : `if not exists`, jamais de suppression de
données), puis refais `supabase/schema.sql` comme la concaténation des migrations, dans l'ordre :
`supabase/schema.test.ts` vérifie qu'ils restent égaux. Une nouvelle table a besoin de RLS et de son
`grant select, insert, update, delete on public.<table> to authenticated` : depuis le 30 mai 2026, un
projet Supabase neuf n'expose plus d'office les tables de `public` à la Data API (voir
`…000300_grants.sql`).

## Récupérer une nouvelle version

Le bouton Deploy de Vercel a créé ton propre dépôt à partir de celui-ci ; il ne suit pas ses nouvelles
versions tout seul. Pour en récupérer une, dans un clone de **ton** dépôt :

```bash
git remote add upstream https://github.com/sosoj92/miroir-dressing-intelligent
git fetch upstream
git merge upstream/main
git push
```

Si Git refuse de fusionner deux historiques sans lien, la première fois, ajoute
`--allow-unrelated-histories` au `merge`. Vercel redéploie à chaque `push`. Lis le
[CHANGELOG](../CHANGELOG.md) : si le schéma a changé, recolle `supabase/schema.sql` dans le SQL Editor
(il se relance sans dommage).
