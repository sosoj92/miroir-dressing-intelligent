# Vercel : mettre l'app en ligne

Vercel héberge l'app et lui donne une adresse en HTTPS, que la caméra de la tablette exige. Le plan
**Hobby** est gratuit, pour un usage personnel non commercial. Fais d'abord [Supabase](supabase.md) : il
te faut ses trois valeurs.

## 1. Le bouton Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsosoj92%2Fmiroir-dressing-intelligent&project-name=miroir-dressing&repository-name=miroir-dressing-intelligent&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,ALLOWED_USER_ID&envDescription=Les%203%20valeurs%20de%20ton%20projet%20Supabase%20%28URL%2C%20cl%C3%A9%20Publishable%2C%20UID%20de%20ton%20compte%29.&envLink=https%3A%2F%2Fgithub.com%2Fsosoj92%2Fmiroir-dressing-intelligent%2Fblob%2Fmain%2Fdocs%2Fsupabase.md%235-relever-les-trois-valeurs)

1. Clique le bouton et connecte-toi à Vercel avec ton compte GitHub.
2. Vercel crée **une copie du dépôt dans ton GitHub** (c'est elle qu'il déploie). Avant, il te fait
   choisir le compte GitHub où la créer, autoriser son app GitHub (un écran d'autorisation de GitHub :
   accepte) et nommer la copie : garde le nom proposé ; la case « privé » convient très bien. Il te
   demande ensuite les trois variables :

| Variable | Valeur |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | l'URL du projet Supabase, `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | la clé Publishable, `sb_publishable_…` |
| `ALLOWED_USER_ID` | l'UID de ton compte (Authentication > Users) |

3. **Deploy**. Le build prend quelques minutes : il installe les paquets, télécharge les deux modèles
   MediaPipe des gestes chez Google (14 Mo, vérifiés par leur empreinte), puis construit l'app.
4. À la fin, Vercel affiche l'adresse de production, du type `https://<projet>.vercel.app` (aussi dans
   **Settings** > **Domains**).

## 2. Vérifier

Ouvre `https://<projet>.vercel.app/api/health`. Tu dois lire :

```json
{"ok":true,"supabase":"configurée","ALLOWED_USER_ID":"définie"}
```

| Tu lis | Ce que ça veut dire |
|---|---|
| `"supabase":"absente"` | une des deux variables `NEXT_PUBLIC_SUPABASE_…` manque, ou tu l'as ajoutée sans redéployer |
| `"ALLOWED_USER_ID":"absente"` | la variable manque |
| `"ALLOWED_USER_ID":"invalide"` | elle est renseignée, mais ce n'est pas un uuid : recopie l'UID |

La page ne montre jamais les valeurs elles-mêmes.

Retourne ensuite dans Supabase pour l'[étape 6 : les adresses de connexion](supabase.md#6-après-le-déploiement--les-adresses-de-connexion).

## 3. Changer une variable

**Settings** > **Environment Variables**, modifie la valeur, puis **Deployments** > le dernier
déploiement > **⋯** > **Redeploy**.

**Redéploie après chaque changement** : les deux variables `NEXT_PUBLIC_…` sont recopiées dans le code au
moment du build, et un changement sans redéploiement ne fait rien.

## 4. Les clés facultatives (payantes)

Elles ne servent qu'à l'ajout d'une photo à plat depuis le téléphone ([photos-simple.md](photos-simple.md)).
Sans elles, la fiche se remplit à la main et une photo PNG déjà détourée sert telle quelle.

| Variable | À quoi elle sert | Où la créer | Coût |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | remplir la fiche d'une photo (nom, catégorie, couleur, chaleur, styles, pluie) avec Claude | [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys) (Claude Console > Settings > API keys) > **Create key** | crédits prépayés ; modèle `claude-opus-5-5`, 4 $ par million de jetons en entrée, 20 $ en sortie |
| `FAL_KEY` | détourer une photo à plat (Bria RMBG 2.0) | [fal.ai](https://fal.ai) > Dashboard > Keys | environ 0,018 $ l'image |

Pour la clé Anthropic : **rattache-la à un espace de travail** (par exemple le Default Workspace) au
moment de la créer. L'app n'envoie pas d'identifiant d'espace de travail, et une clé qui n'est rattachée à
aucun est refusée par l'API. La clé (`sk-ant-…`) ne s'affiche qu'une fois : colle-la directement dans
Vercel, nulle part ailleurs.

Ajoute ces variables dans **Settings** > **Environment Variables** (environnement Production), puis
**Redeploy**.

## À savoir

- **La tablette doit ouvrir l'adresse de production** (`https://<projet>.vercel.app`). La protection de
  déploiement par défaut couvre les adresses de preview, qui demandent une connexion Vercel : derrière le
  miroir, personne ne pourrait la faire.
- **Durée des fonctions** : l'ajout d'une photo peut durer jusqu'à 120 s (`maxDuration`). Sur Hobby, avec
  Fluid compute, actif par défaut sur un projet neuf, le maximum est de 300 s.
- **Ton dépôt est une copie** : il ne suit pas les nouvelles versions de ce projet toutes seules. Pour en
  récupérer une, voir [developpeurs.md](developpeurs.md#récupérer-une-nouvelle-version).
- Rien dans le code ne contient de domaine en dur : un domaine personnel est possible, mais pas
  nécessaire. Si tu en ajoutes un, ajoute aussi son `/auth/callback` dans Supabase.
