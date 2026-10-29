# Base Supabase

Mémo technique. Le pas à pas complet de l'installation est dans `docs/`.

## Schéma

- `schema.sql` : tout le schéma en un fichier. Sur un projet neuf : **SQL Editor** > **New query**, colle tout le fichier, **Run**. Il se relance sans dommage.
- `migrations/` : le même contenu en quatre étapes, dans l'ordre des noms (`…000000_init`, `…000100_items_legacy_id`, `…000200_items_assembly`, `…000300_grants`). Une base qui n'a reçu que les premières doit recevoir les suivantes : le code lit `legacy_id` et `assembly` à chaque lecture des pièces (sans elles, `/api/miroir` répond 500 et la tablette affiche « Serveur injoignable »).
- `…000300_grants` donne au rôle `authenticated` (le compte connecté) `select`, `insert`, `update` et `delete` sur les 7 tables. Un projet créé depuis le 30 mai 2026 n'expose plus d'office les nouvelles tables de `public` à la Data API (case « Automatically expose new tables » décochée), et la règle s'étend aux projets existants le 30 octobre 2026 : sans ces droits, chaque requête répond « permission denied » (42501). Rien pour `anon` ni `service_role`, que l'app n'utilise pas ; RLS reste la barrière par ligne.
- `schema.sql` doit rester la concaténation exacte des migrations : `supabase/schema.test.ts` le vérifie.
- L'éditeur SQL de Supabase peut demander de confirmer une opération « destructive » : ce sont les `drop policy if exists` qui remplacent les règles RLS et de stockage. Aucune donnée n'est effacée.

## À vérifier après le Run

- **Table Editor** : 7 tables (`items`, `outfit_history`, `outfit_plans`, `refusals`, `profile`, `tryon_cache`, `spend_ledger`), aucune marquée « Unrestricted » (badge d'une table sans RLS). La requête de vérification de `docs/supabase.md` (étape 2) affiche RLS et droits table par table.
- Table `items` : les colonnes `legacy_id` (text) et `assembly` (jsonb) existent.
- **Storage** : 3 buckets privés `items`, `profile`, `tryon` (seul `items` sert aujourd'hui).

## Réglages Auth

1. **Authentication** > **Sign In / Providers** : désactive « Allow new users to sign up » (un seul compte).
2. **Authentication** > **Users** > **Add user** > **Create new user** : e-mail, mot de passe, et coche « Auto Confirm User ». La connexion principale se fait par mot de passe.
3. Copie son **User UID** : c'est `ALLOWED_USER_ID`.
4. Après le premier déploiement, **Authentication** > **URL Configuration** :
   - **Site URL** : `https://<projet>.vercel.app` (sinon le lien par e-mail renvoie vers localhost) ;
   - **Redirect URLs** : `http://localhost:3000/auth/callback` et `https://<projet>.vercel.app/auth/callback`.
5. N'active pas « Single session per user » : la tablette et le téléphone restent connectés en même temps au même compte.

`/api/health` dit ensuite si `NEXT_PUBLIC_SUPABASE_…` et `ALLOWED_USER_ID` sont renseignées (« configurée » / « définie », « absente », ou « invalide » pour un UID mal copié ; jamais la valeur). Ne colle jamais une clé dans un fichier suivi par git.
