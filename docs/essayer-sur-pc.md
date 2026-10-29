# Essayer sur ton PC

Pas besoin de tablette ni de miroir pour voir l'app tourner : le PC fait les deux écrans, avec le clavier
(et la webcam, si tu veux essayer les gestes).

## Le plus simple : ton app en ligne, dans Chrome

Une fois l'app déployée ([vercel.md](vercel.md)) :

1. Ouvre `https://<projet>.vercel.app` dans Chrome sur ton PC : c'est l'écran du miroir. Connecte-toi
   (« Se connecter »).
2. Pour voir la mise en page de la tablette : **F12** > icône **appareil** (Toggle device toolbar) >
   dimensions **800 × 1280**.
3. Commande au clavier : ← → (haut), ↑ ↓ (bas), V (veste), Entrée (oui), Retour arrière (non), deux fois R
   (recommencer). Une touche réveille l'écran après 2 min de veille.
4. Avec une webcam, autorise la caméra : les gestes marchent comme sur la tablette
   ([gestes.md](gestes.md)). Ajoute `?gestures=debug` à l'adresse pour voir les zones.
5. Dans un autre onglet, `https://<projet>.vercel.app/gestion` : l'écran du téléphone.

## En local, sur ton PC

Pour modifier le code, ou tout essayer sans rien mettre en ligne.

Il te faut **Node.js 22.12 ou plus récent** ([nodejs.org](https://nodejs.org), version LTS ; le fichier
`.nvmrc` dit 22) et **git**. Et un projet Supabase ([supabase.md](supabase.md)) : l'app n'a pas de mode
hors ligne.

```bash
git clone https://github.com/sosoj92/miroir-dressing-intelligent
cd miroir-dressing-intelligent
npm ci
```

Puis copie le modèle des variables. Windows (PowerShell ou Invite de commandes) :

```
copy .env.example .env.local
```

Mac, Linux (ou Git Bash sous Windows) :

```bash
cp .env.example .env.local
```

Ouvre `.env.local` dans un éditeur de texte et remplis les trois valeurs obligatoires (les mêmes que dans
Vercel). Ce fichier n'est jamais commité. Ne le colle nulle part, et ne l'envoie à personne.

```bash
npm run dev
```

- `http://localhost:3000` : le miroir ; `http://localhost:3000/gestion` : le téléphone.
- Au premier lancement, `npm run dev` télécharge les deux modèles des gestes chez Google (14 Mo, vérifiés
  par leur empreinte). Sans internet, l'app démarre quand même, au clavier, sans gestes.
- `localhost` compte comme sécurisé : la webcam marche sans HTTPS.
- Pour le lien par e-mail en local, `http://localhost:3000/auth/callback` doit être dans les **Redirect
  URLs** de Supabase ([supabase.md](supabase.md#6-après-le-déploiement--les-adresses-de-connexion)).
- Sans `.env.local`, les pages s'affichent mais rien ne marche : « Mon Dressing n'est pas encore
  configuré » sur le miroir, « La connexion n'est pas encore configurée » sur la connexion.
- Après un changement de `.env.local`, arrête (`Ctrl+C`) et relance `npm run dev`.

Une tablette sur le même réseau qui ouvrirait `http://<IP-du-PC>:3000` n'aurait **pas de caméra** (pas de
HTTPS) : pour la tablette, passe par l'adresse Vercel.

Tests, build et architecture du code : [developpeurs.md](developpeurs.md).
