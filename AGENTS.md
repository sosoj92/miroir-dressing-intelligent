# Mon Dressing — instructions pour un agent

Ce fichier s'adresse à un assistant de code (IA) qui aide à installer, modifier ou dépanner le projet. Il
résume les règles à respecter. Ces règles priment sur les habitudes de l'agent.

Mon Dressing est un miroir connecté : une tablette Android derrière un miroir sans tain propose chaque matin
des tenues tirées de la garde-robe de la personne qui l'installe, et se commande aux gestes des bras ; un
téléphone gère la garde-robe. Le produit complet est décrit dans `docs/conception.md` : lis la section
concernée avant toute tâche (les commentaires du code y renvoient, « docs/conception.md §5 »). Le
parcours d'installation est dans `README.md` et `docs/`.

Travaille sur ce qui est demandé, rien de plus. Quand un choix de produit n'est pas tranché dans
`docs/conception.md` (§11), pose la question à la personne au lieu de choisir à sa place.

## Stack
- Next.js 16.4 (App Router, Turbopack) + TypeScript strict + Tailwind 4 (via `@tailwindcss/turbopack`, sans config postcss). Versions figées : lockfile commité et `.npmrc` avec `save-exact=true`.
- Node 22.12 ou plus récent (`engines` dans `package.json`, `.nvmrc`), npm.
- Supabase : Postgres, Storage (buckets privés) et Auth (un seul compte). Schéma complet : `supabase/schema.sql`.
- Déploiement sur Vercel. Sur la tablette, l'app tourne dans Chrome (pas d'application installable).
- Gestes : MediaPipe Tasks Vision dans le navigateur. Le moteur et les modèles sont préparés par `scripts/mediapipe-assets.mjs` (predev, prebuild) et servis par l'app. Les images de la caméra ne quittent jamais la tablette.
- API externes appelées **uniquement côté serveur** (route handlers, server actions) :
  - Claude API (fiche d'un vêtement ajouté par photo à plat), facultative ;
  - fal.ai : Bria, seulement pour le détourage d'une photo à plat, facultatif. Un PNG déjà détouré ne l'appelle pas. Pas d'essayage virtuel ;
  - Open-Meteo (sans clé).
- Assemblage des photos portées (`docs/conception.md` §7) : la préparation tourne sur le PC dans `scripts/assemblage/` (Python 3.13 par uv : Pillow, NumPy, OpenCV, torch, transformers, FASHN Human Parser ; versions dans `uv.lock`), le rendu dans le navigateur (`lib/assembly/`, canvas). Les photos portées ne vont vers aucun service externe. Les photos personnelles ne sont jamais commitées : seuls les scripts le sont.

## Commandes
- `npm run dev` : serveur local ;
- `npm run build` : build de production ;
- `npm run test` : `vitest run`, jamais en mode watch. Tests unitaires sans réseau ;
- `npm run e2e` : `playwright test`, avec trois projets : `tablette` (800×1280, DPR 2, tous les tests sauf ceux marqués `@camera`), `camera` (la même tablette avec la fausse caméra de Chromium, une mire : les tests `@camera` de `e2e/miroir.spec.ts`) et `telephone` (390×844, DPR 3). Le serveur de test tourne sur le port 3210 : un seul `npm run e2e` à la fois, et vérifie avant que ce port est libre. Les captures vont dans `test-results/captures/<projet>/<écran>.png`. Playwright ne charge pas `.env.local` : un test qui a besoin de Supabase interroge `/api/health` et se met en « skip » s'il est absent ;
- `npm run lint` : `eslint` (`next lint` n'existe plus dans Next 16) ;
- `npm run typecheck` : `next typegen && tsc --noEmit` (sans `typegen`, les types de routes manquent sur un clone neuf) ;
- `npm run check:secrets` : `node scripts/check-secrets.mjs`, qui cherche, dans ce que git prendrait (fichiers suivis, nouveaux non ignorés, version indexée des fichiers modifiés), des clés, les valeurs de `.env.local` (seul le nom de la variable s'affiche), toute image, archive, tableau ou fixture personnelle (seul `app/favicon.ico` est permis), et les fichiers supprimés du disque mais encore dans l'index (il faut un dépôt git).

Les deux `NEXT_PUBLIC_*` sont recopiées au moment du build : relance `npm run build` (ou **Redeploy** sur Vercel) après tout changement de `.env.local` ou des variables Vercel.

Ne remplace jamais `AGENTS.md`, `docs/`, `.env.example`, `.gitignore` ni `scripts/` par des versions générées (`agentRules: false` dans `next.config.ts` empêche `next dev` d'écrire dans ce fichier).

## Secrets — règle n° 1
- IMPORTANT : **jamais de clé API dans le code, dans git, dans les logs, les tests, les fixtures ni les captures d'écran.**
- Où vivent les valeurs :
  - en local, dans `.env.local` (jamais commité) ;
  - en ligne, dans les variables d'environnement Vercel ;
  - `.env.example` liste les noms, sans aucune valeur.
- Variables : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` et `ALLOWED_USER_ID` (obligatoires) ; `ANTHROPIC_API_KEY` et `FAL_KEY` (facultatives, payantes). Aucune autre.
- Les secrets (`ANTHROPIC_API_KEY`, `FAL_KEY`) ne sont lus que dans `lib/server/env.ts`, qui commence par `import 'server-only'`. Le reste du code serveur importe ce module.
- Côté navigateur, seules `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` sont lues. Écris-les en entier (`process.env.NEXT_PUBLIC_SUPABASE_URL`) : Next.js ne remplace ni `process.env[nom]` ni une déstructuration.
- Aucun secret dans une variable `NEXT_PUBLIC_*` : Next.js les recopie dans le JavaScript envoyé au navigateur.
- Les fichiers de config (`next.config.ts`, `playwright.config.ts`, `vitest.config.mts`) ne lisent que `process.env.CI` et `NODE_ENV`. Dans `vitest.config.mts`, `server-only` est remplacé par un module vide (`resolve.alias`).
- Supabase :
  - l'app n'utilise que la clé **publishable**, côté navigateur comme côté serveur, avec la session du compte. La clé `secret` (`sb_secret_…`) n'est jamais nécessaire : ne la demande pas et ne la mets nulle part ;
  - la clé publishable n'est acceptable dans le navigateur que parce que RLS est activé sur **chaque** table et sur `storage.objects`. Chaque fichier est rangé sous `<user_id>/…`, et les policies vérifient `(storage.foldername(name))[1] = auth.uid()::text` ;
  - côté serveur, vérifie le compte avec `getClaims()` ou `getUser()`, jamais avec `getSession()`.
- Chaque server action et chaque route handler vérifie lui-même le compte avec `requireUser()` (`lib/server/auth.ts`, qui s'appuie sur `getClaims()`) : 401 sans session, 403 si l'id n'est pas `ALLOWED_USER_ID`. L'app n'a qu'un compte, et les inscriptions sont fermées.
- Seules exceptions, publiques par nature : `/api/health` (ne renvoie que l'état des variables : « configurée » ou « absente » pour Supabase, « définie », « absente » ou « invalide » pour `ALLOWED_USER_ID`, jamais une valeur) et `/auth/callback` (vérifie `ALLOWED_USER_ID` après l'échange et déconnecte tout autre compte).
- Ne demande jamais à la personne qui installe de coller une clé, un jeton ou un mot de passe dans la conversation. C'est la personne qui installe qui remplit `.env.local` et les variables Vercel, et qui lance `npx supabase login` ou `npx vercel login` dans son terminal. Toi, tu dis quoi faire et tu attends.
- N'affiche jamais le contenu de `.env.local` ni des variables d'environnement : pas de `cat`, `type`, `printenv`, `vercel env pull` vers le terminal, ni `console.log(process.env)`. Pour vérifier qu'une variable existe, n'affiche que son nom, suivi de « définie » ou « absente ».
- Si tu trouves une clé dans le code ou l'historique : arrête-toi, ne la recopie nulle part et signale-la. Elle devra être révoquée.

## Données et vie privée
- Photos des vêtements et photos portées : buckets Supabase **privés**, affichage par URL signée à durée limitée. Jamais de bucket public.
- Ce qui sort de la tablette, et vers où, est fixé par `docs/conception.md` §9. N'envoie rien d'autre à un service externe.
- Jamais de photo ni de vidéo d'une personne dans git, les tests, les fixtures ou les captures. Les tests utilisent des images synthétiques et la mire de la fausse caméra de Chromium. Les fixtures tirées de vraies photos (`lib/assembly/fixtures/*.json`) et les journaux de gestes (`lib/gestures/fixtures/`) restent hors du dépôt.
- Le dossier de photos de la chaîne du PC se range **en dehors** du dépôt (`fabriquer.py` refuse un dossier situé dedans). `.gitignore` écarte en plus images, zips, CSV, `db.json`, `Dressing/`, `travail/` et `controle/`, et `check:secrets` les refuse s'ils sont suivis : ne contourne jamais ces règles (`git add -f`).
- Jamais de valeur tirée d'un vrai compte dans le code ou les tests (UID, URL ou référence de projet, e-mail) : des valeurs factices seulement (`0a1b2c3d-0000-4000-8000-0000000000aa`, `projet.supabase.co`, `moi@example.com`).

## Règles de code
- Interface en français, avec tutoiement. Code, noms de variables et colonnes de base en anglais. Commentaires en français, dans la densité du fichier voisin.
- Le choix des tenues (`lib/outfits/`) et la reconnaissance des gestes (`lib/gestures/`) sont des fonctions pures, testées sans réseau ni caméra. Les seuils des gestes sont des constantes nommées (`lib/gestures/constants.ts`).
- Tout doit marcher sans tactile sur la tablette : les gestes des bras devant la caméra (pas de manette), les touches d'un clavier en secours. Le téléphone sert à gérer la garde-robe.
- Next.js 16 :
  - le middleware s'appelle `proxy.ts`, avec un export nommé `proxy` ;
  - `cacheComponents` est actif : toute lecture de session va dans un `<Suspense>` ;
  - dans un route handler, appelle `await connection()` avant tout try/catch, sinon le catch avale l'arrêt du prérendu au build.
- Migrations de base dans `supabase/migrations/`, relançables ; `supabase/schema.sql` reste leur concaténation exacte (`supabase/schema.test.ts`). Jamais de migration destructrice (suppression de colonne ou de données) sans le demander. Une nouvelle table a besoin de RLS **et** de son `grant select, insert, update, delete … to authenticated` (comme `…000300_grants.sql`) : un projet Supabase récent n'expose plus d'office les tables à la Data API.
- Pas de nouvelle dépendance sans le dire et expliquer pourquoi.
- Ne déploie pas en production et ne pousse pas sur `main` (la branche de production Vercel) sans l'accord de la personne.

## Design
- Mode miroir : fond `#000` pur partout, aucune bordure ni zone grise, sinon ça se voit à travers le miroir. Ne sont allumés que :
  - le texte ;
  - les icônes au trait ;
  - l'anneau de progression ;
  - les vêtements détourés ;
  - la silhouette assemblée à partir des photos portées, sans son fond.
- Interdits, parce qu'ils donnent à une interface l'air d'avoir été générée par une IA :
  - dégradés, halos, ombres colorées, effets de verre ;
  - bordures en pointillés, barres de couleur décoratives à côté des titres ;
  - petites étiquettes en majuscules espacées ou en monospace ;
  - rangées de pastilles arrondies de même poids, cartes dans des cartes ;
  - icônes ou illustrations de vêtements à la place des photos ;
  - emojis, étincelles, boutons « idées de l'IA » ;
  - textes d'aide qui remplissent l'écran ;
  - fond bleu nuit avec accent orange, fond crème avec titres à empattements.
- Les pictogrammes sont des icônes au trait, pas des emojis. Chaque élément à l'écran a une fonction : dans le doute, ne l'ajoute pas.
- Titre de section : 15 px gris décalé de 16 px au-dessus d'une liste groupée ; 17 px semibold sans décalage au-dessus de photos.

## Aider à installer
- Suis l'ordre du `README.md` : Supabase (`supabase/schema.sql`, inscriptions fermées, compte avec mot de passe et Auto Confirm, UID), puis le déploiement Vercel, puis les adresses de connexion dans Supabase, puis le téléphone, les vêtements et la tablette.
- Une commande ou une étape à la fois ; demande ce qui s'est affiché avant de continuer.
- Pour diagnostiquer, commence par `https://<projet>.vercel.app/api/health`, puis `docs/depannage.md`.
- Le mode silhouette repose sur un parseur sous licence de recherche ou d'évaluation seulement : dis-le avant de le proposer, sans l'adoucir.

## Avant de dire « fini »
1. `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run e2e` et `npm run check:secrets` passent.
2. Une capture Playwright de chaque écran modifié en 800×1280 (et en 390×844 pour les écrans du téléphone), regardée et comparée à `docs/conception.md`.
3. Un résumé court : ce qui a changé, comment le tester sur la tablette, ce qui reste à faire.

## Quand tu te trompes deux fois sur la même chose
Ajoute une ligne ici pour que ça ne se reproduise pas (garde ce fichier court).
