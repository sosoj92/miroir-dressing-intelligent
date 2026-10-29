# Changelog

Toutes les évolutions notables de Mon Dressing. Format inspiré de
[Keep a Changelog](https://keepachangelog.com/fr/) ; versionnage
[SemVer](https://semver.org/lang/fr/).

## [1.0.0] — 2026-10-29

Première version publique. Un miroir connecté qui propose la tenue du jour selon la météo, commandé aux
gestes des bras, et un téléphone qui gère la garde-robe. Interface en français.

### Miroir (tablette)
- Tenue du jour selon la météo d'Open-Meteo : chaleur, pluie, veste quand le matin est frais, pièces au
  sale écartées, variété, accords de couleurs, refus passés.
- Composition libre : hauts, bas et vestes défilent des mieux adaptés aux moins adaptés ; robes ; « oui »,
  « non », « Recommencer ».
- « Préparer demain » : à partir de l'heure du soir, la tenue du lendemain.
- Commande aux gestes des bras avec MediaPipe, sur la tablette : méthode des zones pour défiler, pouce,
  poing et V tenus 1 s ; garde « de profil » ; clavier de secours et test des touches (`?touches=test`) ;
  réglage avec `?gestures=debug`.
- Veille par présence, écran de secours qui se recharge seul, « · hors ligne » et file d'envoi sans
  réseau.
- Silhouettes assemblées à partir des photos portées, avec bras pliés ; pièces détourées empilées sinon.

### Téléphone
- Garde-robe par catégorie, « au sale » d'un toucher, fiche de chaque pièce.
- Ajout par photo à plat : **PNG déjà détouré gratuit**, sinon détourage Bria sur fal.ai (facultatif) ;
  fiche remplie par Claude (facultatif).
- Page Demain (5 tenues, « Garder pour demain », « Recommencer le choix »), tenues écartées, réglages
  (ville, heure du soir).
- Import d'un zip simple (`Dressing/` avec `db.json` et des PNG détourés) ou du paquet du mode silhouette.

### Mode silhouette (PC)
- `INSTALLER_PHOTOS.bat` (Windows, testé) et `installer_photos.sh` (Mac Apple Silicon et Linux, non
  testés) : Python 3.13 et dépendances aux versions de `uv.lock`, YuNet et FASHN Human Parser téléchargés
  une fois et vérifiés.
- `fabriquer.bat` / `fabriquer.sh` : une seule commande, relancée, fait l'étape suivante ; `catalogue.csv`
  à remplir dans un tableur, lignes de coupe automatiques corrigeables dans `corrections.csv`, planches de
  contrôle, un seul zip à importer ; `essai-fond.bat` pour essayer le fond vert par glisser-déposer. Le
  dossier de photos doit être en dehors du projet (refusé sinon).

### Installation
- Bouton **Deploy with Vercel** avec les trois variables obligatoires ; `supabase/schema.sql` en un seul
  fichier, relançable, qui donne aussi au compte connecté les droits de la Data API sur les tables (projets
  Supabase récents).
- `/api/health` dit si Supabase et `ALLOWED_USER_ID` sont réglés (« invalide » pour un UID mal copié),
  sans jamais montrer de valeur.
- Modèles MediaPipe téléchargés au build depuis Google et vérifiés par leur empreinte, jamais dans le dépôt.
- `INSTALL_WITH_AI.md` (FR/EN) : le guide à coller dans une IA gratuite ; documentation dans `docs/`,
  README FR (défaut) + EN.

### Confidentialité & sécurité
- L'image de la caméra ne quitte jamais la tablette ; photos dans des buckets privés, URL signées.
- Un seul compte, inscriptions fermées, `ALLOWED_USER_ID` vérifié par chaque route.
- Aucun secret dans le dépôt ; `npm run check:secrets` cherche les clés, les valeurs de `.env.local`, les
  images, archives et fixtures personnelles avant chaque commit.

[1.0.0]: https://github.com/sosoj92/miroir-dressing-intelligent/releases/tag/v1.0.0
