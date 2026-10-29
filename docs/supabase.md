# Supabase : la base, les photos et la connexion

Supabase garde les fiches de tes vêtements, leurs photos (dans des dossiers privés) et ton compte. Le plan
gratuit suffit. Compte une quinzaine de minutes. Fais cette étape **avant** le déploiement sur Vercel :
il te faut les trois valeurs de la fin.

> Rien à installer sur ton PC : tout se fait dans le tableau de bord de Supabase, dans le navigateur.

## 1. Créer le projet

1. Crée un compte sur [supabase.com](https://supabase.com) (gratuit). Supabase te fait d'abord créer une
   **organisation** : un nom, le type **Personal** et le plan **Free** suffisent.
2. **New project** : un nom (par exemple `mon-dressing`), un mot de passe de base de données (garde-le
   dans ton gestionnaire de mots de passe : l'app n'en a pas besoin) et la région la plus proche de chez
   toi.
3. Si la création propose des options de sécurité (Data API), garde la **Data API** activée, sur le schéma
   `public` : l'app passe par elle. La case **« Automatically expose new tables »** peut rester comme elle
   est (décochée par défaut sur un projet récent) : l'étape suivante donne elle-même au compte connecté
   les droits sur les tables de l'app.

## 2. Créer les tables

1. Dans le projet : **SQL Editor** > **New query**.
2. Ouvre le fichier [`supabase/schema.sql`](../supabase/schema.sql) sur GitHub et copie **tout** son
   contenu : le plus sûr est le bouton **Copy raw file** (l'icône copier, en haut à droite du fichier).
   Colle-le dans l'éditeur, puis **Run**.
3. Supabase peut afficher un avertissement d'opération **destructive** avant d'exécuter : il vient des
   lignes `drop policy if exists`, qui remplacent les règles de sécurité par leur version à jour. C'est
   normal : confirme l'exécution. Aucune donnée n'est effacée.
4. Le message doit être « Success ». Le script se relance sans dommage.

Vérifie ensuite :

- **Table Editor** : 7 tables (`items`, `outfit_history`, `outfit_plans`, `refusals`, `profile`,
  `tryon_cache`, `spend_ledger`), et **aucune** n'est marquée « Unrestricted » (ce badge signale une
  table sans RLS).
- Dans `items`, les colonnes `legacy_id` et `assembly` existent. Sans elles, la tablette affiche
  « Serveur injoignable ».
- **Storage** : 3 buckets privés, `items`, `profile` et `tryon` (seul `items` sert aujourd'hui). Tu n'as
  aucun bucket à créer à la main.

Pour tout vérifier d'un coup : **SQL Editor** > **New query**, colle cette requête, puis **Run** :

```sql
select c.relname as "table",
       c.relrowsecurity as rls,
       has_table_privilege('authenticated', c.oid, 'select')
         and has_table_privilege('authenticated', c.oid, 'insert')
         and has_table_privilege('authenticated', c.oid, 'update')
         and has_table_privilege('authenticated', c.oid, 'delete') as droits
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;
```

Il faut 7 lignes, avec `true` dans les colonnes `rls` et `droits`. Un `false` dans `droits` : recolle
`schema.sql` à jour (voir [depannage.md](depannage.md#la-tablette)).

## 3. Fermer les inscriptions

**Authentication** > **Sign In / Providers** : désactive « Allow new users to sign up ». L'app n'a qu'un
compte, le tien ; personne d'autre ne peut en créer un depuis l'adresse publique.

## 4. Créer ton compte

1. **Authentication** > **Users** > **Add user** > **Create new user**.
2. Ton adresse e-mail et un **mot de passe**, puis coche **Auto Confirm User**. C'est avec ce mot de passe
   que tu te connecteras sur la tablette et sur le téléphone.
3. Utilise de préférence **la même adresse que celle de ton compte Supabase** : le service d'e-mail par
   défaut de Supabase n'envoie qu'aux adresses de l'équipe du projet, et 2 e-mails par heure au plus. Le
   lien par e-mail n'est qu'un secours : le mot de passe, lui, marche toujours.
4. Évite une boîte Outlook ou Hotmail pour ce lien : son analyseur ouvre chaque lien avant toi, et le lien
   à usage unique est alors déjà grillé.

## 5. Relever les trois valeurs

| Variable | Où la trouver |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | bouton **Connect** en haut du projet : l'URL du projet, `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Project Settings** > **API Keys** (ou **Connect**) : la clé **Publishable**, qui commence par `sb_publishable_`. Si aucune clé Publishable n'apparaît, crée-la sur cette même page |
| `ALLOWED_USER_ID` | **Authentication** > **Users** : clique sur ton utilisateur et copie son **User UID** avec l'icône copier (un uuid de 36 caractères, tirets compris). Le sélectionner à la souris dans la colonne de la liste risque de le couper |

Les deux premières sont publiques par nature : elles finissent dans le JavaScript envoyé au navigateur, et
les règles RLS protègent chaque table. La troisième n'est pas un secret non plus, mais elle n'est lue que
côté serveur.

**Ne copie jamais la clé `secret` (`sb_secret_…`)** : l'app n'en a pas besoin, et elle contourne toutes
les règles de sécurité.

Tu peux maintenant [déployer sur Vercel](vercel.md).

## 6. Après le déploiement : les adresses de connexion

Une fois que tu connais l'adresse de ton app (`https://<projet>.vercel.app`) :

1. **Authentication** > **URL Configuration**.
2. **Site URL** : `https://<projet>.vercel.app` (sinon le lien par e-mail renvoie vers localhost).
3. **Redirect URLs** : ajoute `https://<projet>.vercel.app/auth/callback` et, pour essayer sur ton PC,
   `http://localhost:3000/auth/callback`.
4. N'active pas « Single session per user » : la tablette et le téléphone restent connectés en même temps
   au même compte.

## Plan gratuit : à savoir

- **Mise en pause** : un projet gratuit qui a peu d'activité pendant 7 jours est mis en pause. La tablette
  interroge le serveur toutes les 30 s, ce qui garde le projet actif tant qu'elle est allumée. Après un
  long arrêt : ouvre le projet dans Supabase et clique **Resume project**. Un projet en pause reste
  restaurable pendant un an.
- **Bande passante** : le miroir retélécharge les images à chaque relecture (réveil après 10 min, 18 h,
  minuit, 4 h). Avec une grande garde-robe, surveille la page **Usage** de Supabase.
- Les limites exactes du plan gratuit sont sur [supabase.com/pricing](https://supabase.com/pricing).

Mémo technique du schéma : [`supabase/README.md`](../supabase/README.md).
