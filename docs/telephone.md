# Le téléphone

Le téléphone gère la garde-robe ; il ne commande pas le miroir, mais tout ce que tu y changes arrive sur la
tablette en 30 s au plus.

## Se connecter

1. Sur le téléphone, ouvre `https://<projet>.vercel.app/connexion`.
2. Ton e-mail et ton mot de passe (le même compte que la tablette). Tu arrives sur l'accueil :
   **Garde-robe**, **Demain**, **Réglages**, **Importer**.
3. Pour le retrouver vite : menu du navigateur > **Ajouter à l'écran d'accueil**, sur l'adresse
   `https://<projet>.vercel.app/gestion`.

L'adresse sans `/gestion` ouvre le miroir : c'est l'écran de la tablette.

## Première chose : la ville

**Réglages** > ville : cherche la tienne (recherche Open-Meteo). Par défaut, la météo et la date sont celles
de Paris. Règle aussi l'**heure du soir** (18 h par défaut) : à partir de cette heure, le miroir propose la
tenue de demain.

## Ce que tu peux faire

| Écran | Pour |
|---|---|
| **Garde-robe** | voir tes pièces par catégorie ; **Marquer au sale** (toucher une vignette la met au sale ou la remet propre) ; « 3 au sale » ouvre les pièces au sale, avec **Tout est lavé** |
| **Garde-robe** > **Ajouter** | ajouter une pièce par photo à plat : **Prendre une photo** ou **Choisir dans la galerie** ([photos-simple.md](photos-simple.md)) ; marche aussi dans le navigateur du PC, le plus sûr pour un PNG détouré |
| Fiche d'une pièce | corriger le nom, la catégorie, la couleur, la chaleur, les styles, « ok pluie » ; **Changer la photo** ; **Relancer le détourage** ; supprimer |
| **Demain** | 5 tenues proposées pour demain ; **Garder pour demain** fixe le point de départ du miroir ; **Recommencer le choix** efface ce qui a été choisi et refusé |
| **Réglages** > **Tenues écartées** | les tenues refusées d'un poing ; **Remettre** en efface une |
| **Importer** | importer un zip préparé ailleurs : le zip simple ([photos-simple.md](photos-simple.md#le-zip-simple-plusieurs-pièces-dun-coup)) ou le paquet du mode silhouette ([photos-silhouette.md](photos-silhouette.md)) |

Les accessoires et les chaussures s'enregistrent, mais le miroir ne les propose pas.

## Depuis le PC

Les pages **Importer** et **Ajouter** marchent aussi dans le navigateur du PC, connecté au même compte
(`https://<projet>.vercel.app/gestion/import` et `https://<projet>.vercel.app/gestion/garde-robe/ajouter`) :
pratique pour un gros zip, sans le copier sur le téléphone, ou pour un PNG détouré sur le PC, que le
sélecteur de fichiers du PC envoie tel quel. Pendant l'envoi, garde la page ouverte (sur le téléphone, l'app demande à l'écran de rester
allumé). Un import interrompu se relance : il reprend sans doublon.
