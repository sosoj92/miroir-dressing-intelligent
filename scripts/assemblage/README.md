# Chaîne photos : du dossier de photos portées au paquet d'import (mode silhouette)

Outil du PC, pas de l'app. À partir de photos portées sur fond vert, il fabrique **un zip** que la page
**Importer** de Mon Dressing (`/gestion/import`) transforme en pièces : le miroir assemble ensuite
chaque tenue en une seule silhouette (le haut d'une photo, le bas d'une autre, les bras pliés au bon
endroit). Tout tourne sur le PC, hors ligne une fois installé : aucune photo n'est envoyée ailleurs que
dans ton propre compte, au moment où tu importes le zip. Les photos et le paquet ne vont jamais dans git :
range-les dans un dossier **en dehors du dossier du projet** (`fabriquer.py` refuse un dossier situé dans
le projet, et `.gitignore` écarte images, tableaux, zips, `travail/` et `controle/`).

Windows : testé. Mac Apple Silicon sous macOS 14 ou plus récent (roues de torch `macosx_14_0_arm64`), et
Linux x86_64 ou arm64 avec glibc 2.28 ou plus récent (`manylinux_2_28`) : prévus, **non testés**. Mac
Intel : non pris en charge (torch n'existe plus pour ce processeur).

## Installer (une fois)

| Système | Commande |
|---|---|
| Windows | double-clic sur `INSTALLER_PHOTOS.bat`, à la racine du projet |
| Mac, Linux | `bash installer_photos.sh`, à la racine du projet |

L'installeur demande seulement si tes photos sont en HEIC (iPhone), puis :

| Quoi | D'où | Taille | Où |
|---|---|---|---|
| uv, s'il manque | winget `astral-sh.uv` (Windows) ; script officiel `astral.sh/uv/install.sh`, après confirmation (Mac, Linux) | ~40 Mo | installation de uv |
| Python 3.13 et les dépendances, versions exactes de `uv.lock` (torch sans CUDA, index CPU de PyTorch) | PyPI, download.pytorch.org | ~1 Go installé | `scripts/assemblage/.venv/` |
| Détecteur de visage YuNet `face_detection_yunet_2023mar.onnx`, commit `f12e127` d'OpenCV Zoo, empreinte SHA-256 `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` vérifiée | github.com/opencv/opencv_zoo | 227 Ko | `scripts/assemblage/modeles/` |
| Parseur de vêtements FASHN Human Parser, révision `1f80c34dbab321c5730dda5c3fea279fd3e97498` (public : aucun compte Hugging Face) | huggingface.co/fashn-ai/fashn-human-parser | 245 Mo | `scripts/assemblage/modeles/fashn/` |

Rien d'autre n'est téléchargé, aucune clé n'est demandée. Ensuite, la fabrication ne télécharge plus
rien : si un modèle manque, elle s'arrête et dit de relancer l'installeur. Pour tout désinstaller :
supprimer `scripts/assemblage/.venv/` et `scripts/assemblage/modeles/` (tous deux ignorés par git), puis
`uv cache clean` (le cache de uv garde environ 750 Mo de paquets ; les fichiers de `.venv` en sont des liens
physiques, donc supprimer `.venv` ne libère pas cette place), `uv python uninstall 3.13` si c'est uv qui a
installé Python, et `winget uninstall astral-sh.uv` si c'est l'installeur Windows qui a mis uv.

Mesuré sur un PC de bureau Windows avec une bonne connexion et Python 3.13 déjà présent : 65 s
(torch 118 Mo, FASHN 245 Mo). Compte plusieurs minutes sur une connexion ordinaire.

### Licences des modèles

| Modèle | Licence (d'après sa source) |
|---|---|
| YuNet (OpenCV Zoo, `models/face_detection_yunet/LICENSE`) | MIT, © 2020 Shiqi Yu |
| FASHN Human Parser (fiche du modèle : `license: other`, `nvidia-segformer`) | NVIDIA Source Code License for SegFormer : §3.3, l'œuvre et ses dérivés « may be used or intended for use non-commercially », c'est-à-dire « for research or evaluation purposes only » |

Le parseur est obligatoire (manches, bras pliés, lignes) : la chaîne photos ne sert donc qu'à un usage
non commercial. Ses poids ne sont jamais placés dans le dépôt : chacun les télécharge depuis la source.

## Prendre les photos

Ce que le code exige ou vérifie (sur la photo ramenée à 1600 px de haut, sa hauteur de travail) :

| Règle | Valeur | Si ce n'est pas le cas |
|---|---|---|
| Format | portrait (plus haut que large) | arrêt |
| Hauteur | au moins 1600 px une fois tournée (orientation EXIF appliquée) | arrêt |
| Rapport largeur / hauteur | 3:4 (0,75), à ± 0,06 | avertissement |
| Visage | trouvé par YuNet (de face, yeux visibles) | arrêt, avec la liste des photos |
| Hauteur des yeux | 300 à 460 px depuis le haut (environ 24 % de la hauteur) | avertissement |
| Échelle | écart entre les yeux de 48 à 70 px (tu occupes la hauteur, de la tête aux pieds) | avertissement |
| Même distance à l'appareil | écart entre les yeux à ± 12 % de la médiane des photos | avertissement |
| Centrage | yeux à moins de 12 % de la largeur du milieu | avertissement |
| Pieds | dans le cadre, au plus 1220 px sous les yeux (ce que montre le miroir) | avertissement |

Et ce que le code suppose sans pouvoir le vérifier :

- fond vert uni, du sol jusqu'au-dessus de la tête, bien éclairé ; **rien de vert sur toi** (un vêtement
  vert devient transparent) ;
- appareil fixe (trépied), toujours au même endroit, à la même hauteur et au même zoom : l'échelle
  n'est jamais corrigée d'une photo à l'autre ;
- debout, de face, bras le long du corps, visage vers l'appareil ;
- **une seule pièce change d'une photo à l'autre** : les hauts sont photographiés avec le même bas ; les
  bas avec un haut court qui laisse voir la ceinture ; une veste de préférence fermée ; une robe seule.
  Un bas porté avec un haut rentré ou une veste à manches est à reprendre.

Formats lus : `.jpg`, `.jpeg`, `.png`, quelle que soit la casse, et `.heic` / `.heif` si tu as répondu O
à l'installeur (sinon : iPhone, Réglages > Appareil photo > Formats > Le plus compatible). Avant de tout
photographier, essaie ton fond sur deux ou trois photos : sous Windows, glisse leur dossier sur
`scripts\assemblage\essai-fond.bat` ; ailleurs, option `--fond` ci-dessous.

## Fabriquer le paquet

Mets tes photos dans un dossier en dehors du dossier du projet (pas de sous-dossier), puis :

| Système | Commande |
|---|---|
| Windows | glisse le dossier sur `scripts\assemblage\fabriquer.bat`, ou `scripts\assemblage\fabriquer.bat "C:\chemin\du\dossier"` ; essai du fond : glisse-le sur `scripts\assemblage\essai-fond.bat` |
| Mac, Linux | `bash scripts/assemblage/fabriquer.sh "/chemin/du/dossier"` |

C'est **la même commande** à chaque fois ; elle fait l'étape suivante :

1. **Premier lancement** (quelques secondes) : photos préparées, yeux trouvés, `catalogue.csv` créé avec
   une ligne par photo, et `controle/photos-1.jpg` (les vignettes avec leur nom de fichier). Remplis le
   tableau (section suivante), enregistre-le en CSV, ferme le tableur.
2. **Lancements suivants** : tableau relu avec les règles de l'appli (une erreur dit la ligne et la
   colonne), puis pour chaque photo utilisée : détourage, un passage du parseur (gardé en cache), lignes
   de coupe, centres, bras pliés, manches, couleur ; contrôle du paquet avec les règles de l'import ;
   planches `controle/tenues-*.jpg` (environ 1 s par tenue) ; enfin `mon-dressing-import.zip`. Mesuré
   sur un PC de bureau, processeur seul : 5 à 10 s par photo, plus 15 à 30 s pour charger le parseur au
   premier passage ; 3 à 8 s par photo quand ses classes sont déjà en cache.
3. **Regarde `controle/tenues-*.jpg`** : chaque haut et chaque veste sur un bas de référence, chaque bas
   sous un haut de référence, chaque robe seule, tels que le miroir les dessine (sur fond noir). Si une
   coupe est fausse, corrige-la dans `corrections.csv` et relance.
4. Dans Mon Dressing, page **Importer** (téléphone, ou navigateur du PC connecté au compte) : choisis
   `mon-dressing-import.zip`. Un seul zip, sans découpage (la page accepte 500 Mo, 10 Mo par image,
   300 pièces et 300 photos par paquet).

Une photo ajoutée plus tard : remets-la dans le dossier et relance ; une ligne vide est ajoutée en fin de
`catalogue.csv`. Le tableau du PC fait foi : au réimport, chaque pièce est mise à jour par son `id`
(nom, catégorie, couleur, chaleur, styles, pluie) ; corrige donc une fiche ici plutôt que sur le
téléphone, et garde les mêmes `id`.

Options : `--fond` (étapes 1 et 2 de la préparation, puis `controle/fond/<clé>.jpg` : le sujet détouré
sur fond noir, sans rien fabriquer d'autre) ; `--regles` (en plus, `controle/regles/<clé>.png` :
vignettes graduées en px sous les yeux avec les lignes retenues, `top_low` en orange, `bottom_high` en
bleu). Une option ne passe pas par le glisser-déposer : `essai-fond.bat` fait `--fond` ; pour `--regles`,
la marche à suivre dans un terminal (Windows : `cmd` tapé dans la barre d'adresse de l'Explorateur, dans
le dossier du projet) est dans [`docs/photos-silhouette.md`](../../docs/photos-silhouette.md#taper-une-commande).

### Le dossier, après coup

| Chemin | Quoi |
|---|---|
| `<dossier>/*.jpg …` | tes photos, jamais modifiées |
| `catalogue.csv` | le tableau des vêtements (créé, puis seulement complété) |
| `corrections.csv` | facultatif, écrit par toi |
| `mon-dressing-import.zip` | le paquet à importer |
| `controle/` | planches à regarder : `photos-*.jpg`, `tenues-*.jpg`, `fond/`, `regles/` |
| `travail/photos/<clé>.jpeg` | copies renommées (un JPEG est copié octet pour octet ; PNG et HEIC convertis) |
| `travail/photos.json`, `reperes.json` | clés, empreintes, yeux (recalculés si une photo change) |
| `travail/fashn/` | cartes du parseur, une par photo, avec l'empreinte de la photo |
| `travail/lignes-auto.csv`, `rapport.json` | lignes calculées, temps et mesures par photo |
| `travail/paquet/` | le contenu du zip |

La clé d'une photo vient de son nom de fichier : accents retirés, autres caractères que lettres,
chiffres, `_` et `-` remplacés par `-`, 64 caractères au plus (`Été 1.JPG` → `Ete-1`). C'est la seule
convention de clé de toute la chaîne.

## `catalogue.csv`

Point-virgule, UTF-8 avec BOM (Excel en français l'ouvre par double-clic). À la relecture, `;`, `,` ou
tabulation et UTF-8 ou Windows-1252 sont acceptés ; les majuscules et les accents des valeurs sont
ignorés, les colonnes en plus aussi. Une ligne par pièce :

| Colonne | Valeurs | Créé avec |
|---|---|---|
| `photo` | nom du fichier de la photo (ou sa clé) | le nom du fichier |
| `id` | lettres sans accent, chiffres, `_`, `-`, 1 à 64, unique : identifiant stable de la pièce (`legacy_id`) | la clé de la photo |
| `nom` | 1 à 80 caractères (espaces multiples réduits) | vide |
| `categorie` | `haut`, `bas`, `robe`, `veste`, `chaussures`, `accessoire` (pluriels acceptés) | vide |
| `couleur` | vide ou `auto` : calculée d'après la photo ; `#RRGGBB` (le `#` peut manquer) ; `aucune` | vide |
| `chaleur` | `1`, `2`, `3` ou `leger`, `moyen`, `chaud` | `2` |
| `styles` | `decontracte`, `habille`, `sport`, plusieurs reliés par `+` (ou `,`, `/`, espace) ; vide = `decontracte` | `decontracte` |
| `pluie` | `oui` / `non` (aussi `o`, `n`, `x`, `1`, `0`, `vrai`, `faux`) ; vide = non | `non` |
| `rentre` | `oui` si le haut est rentré dans le bas **sur cette photo** ; vide = non | `non` |

- Une photo inutile : laisse `nom` et `categorie` vides (avertissement, la ligne est ignorée).
- Deux pièces sur une même photo (le haut ET le bas de la tenue de départ) : copie la ligne et donne un
  autre `id` (par exemple `photo07-bas` pour la photo `photo07.jpg`). `rentre` vaut pour la photo : deux lignes de la même photo
  qui se contredisent sont refusées.
- Une ligne à moitié remplie est une erreur, avec la ligne et la colonne.
- Les règles sont celles de l'appli (`readItemFields`, `lib/import/assemblage.ts`), et le paquet entier
  est revérifié avant le zip avec celles de `parseAssemblyManifest` et `lib/assembly/parse.ts`.

La couleur calculée est la médiane des pixels sûrs du vêtement (classes du parseur selon la catégorie).
Comparée à des couleurs choisies à la main sur un jeu réel, elle donne le même verdict pour les deux
usages de l'appli (pièce foncée éclaircie sur le miroir ; couleur vive ou neutre pour les accords) dans
plus de 9 cas sur 10 ; la teinte exacte peut différer.

## `corrections.csv` (facultatif)

`photo;top_low;bottom_high`, une ligne par photo à corriger. `photo` : nom du fichier ou clé. Valeur : un
nombre de px sous les yeux, `aucune` (ligne inconnue, null dans le manifeste), ou vide (ligne
automatique gardée). Les valeurs calculées sont dans `travail/lignes-auto.csv` (même format, à copier) ;
`--regles` montre la règle graduée.

- `top_low` : point le plus bas de tous les vêtements du haut (veste comprise), sans les manches ni ce
  qui pend (tirette, cordon) ; `aucune` si le haut descend plus bas que 860 px sous les yeux.
- `bottom_high` : point le plus haut du bord supérieur du bas, côtés compris ; `aucune` s'il est caché
  (haut long, veste longue).

## Ce qui est automatique, ce qui reste à faire

| Automatique | À la main |
|---|---|
| clés, orientation, contrôles de format et de cadrage | les photos, selon le protocole |
| milieu et écart des yeux (YuNet) | remplir `catalogue.csv` : nom, catégorie, chaleur, styles, pluie, rentré |
| détourage du fond vert | regarder `controle/tenues-*.jpg` |
| classes du parseur, une fois par photo | corriger une coupe dans `corrections.csv` si besoin |
| lignes `topLow` / `bottomHigh`, `onePiece` (vrai si une robe est sur la photo), centres du buste | importer le zip depuis la page Importer |
| couches et données des bras pliés, manches des hauts et des vestes | |
| couleur proposée, validation, planches, zip | |

Lignes automatiques, comparées sur un jeu de photos réel à des lectures faites à la main sur des
vignettes graduées : écart médian de 2 à 3 px, et de rares écarts au-delà de 12 px (par exemple un coin
d'ourlet collé à une manche) ; `corrections.csv` les rattrape. Avec les lignes lues à la main données dans
`corrections.csv`, le paquet est identique, à l'octet près pour les repères et les bras pliés, à celui
de l'ancienne chaîne manuelle.

## Les modules

| Fichier | Rôle |
|---|---|
| `fabriquer.py` | point d'entrée unique (`fabriquer.bat`, `fabriquer.sh`), enchaîne les étapes, option `--installer` |
| `modeles.py` | téléchargement vérifié et chargement hors ligne des deux modèles |
| `preparation.py` | lecture des photos, clés, copies, contrôles de format |
| `align.py` | milieu et écart des yeux (YuNet) |
| `catalogue.py` | création, complément et relecture de `catalogue.csv` |
| `chroma.py` | incrustation du fond vert (seuils réglés pour un fond vert uni) |
| `mesures.py` | lignes automatiques, centres robustes, couleur proposée |
| `bras.py` | cartes du parseur en cache, couches et données des bras pliés, par photo |
| `build_assets.py` | contenu du paquet, une photo à la fois, et `manifest.json` |
| `paquet.py` | contrôle avec les règles de l'appli, zip unique (`ZIP_STORED`) |
| `planche.py` | planches de contrôle |
| `bras_plan.py`, `canvas_np.py` | plan de dessin d'une tenue (la référence de `lib/assembly`) et son exécution NumPy avec la sémantique du canvas 2D, pour les planches |
| `ref_fixture.py` | outil de développement, voir plus bas |

Aucun module ne lit de fichier à son import ; un seul dossier de travail, passé en argument.

## Contenu du paquet

| Fichier | Quoi |
|---|---|
| `manifest.json` | fiches et repères (format ci-dessous), JSON compact |
| `photos/<clé>.jpg` | photo d'origine, 1600 px de haut |
| `photos/<clé>.webp` | photo détourée (fond transparent), taille de la photo |
| `manches/<id>.webp` | manches et mains d'un haut ou d'une veste sous son ourlet (par pièce, rendu sans bras pliés) |
| `bras/<clé>.webp` | bras pliés : bras, mains, bracelets et manches sous l'ourlet seuls (par photo, rognée) |
| `corps/<clé>.webp` | bras pliés : photo détourée sans les bras, corps caché sous les bras complété (par photo, rognée) |
| `manches-photo/<clé>.webp` | bras pliés : manches du haut sous l'ourlet (par photo, rognée ; seulement si la photo en a) |

`bras/`, `corps/` et `manches-photo/` existent pour chaque photo d'un haut, d'une veste ou d'un bas
(pas pour une robe ni un accessoire). Les couches sont en WebP (couleur avec perte, qualité 88 ; alpha
sans perte), RGBA non prémultiplié, rognées à leurs pixels d'alpha non nul plus **1 px transparent de
chaque côté**, même au-delà du cadre de la photo (précondition du rendu canvas).

## Format de `manifest.json`

`format: "mon-dressing/assemblage"`, `version: 1`, `margin` (6), `feather` (10), `photos`, `items`.
Le champ `arms` est facultatif : une app qui ne le connaît pas importe le paquet et dessine la
silhouette sans bras pliés. Repère commun : px de la photo (x vers la droite, y vers le bas, origine en
haut à gauche, photo de `size` = [largeur, hauteur]) ; « sous les yeux » = y − `eye[1]`.

`items[]` : `legacy_id` (l'`id` du tableau), `name`, `category`, `color` (`#RRGGBB` ou null), `warmth`
(1 à 3), `styles`, `rain_ok`, `photo` (clé), `sleeves` (`manches/<legacy_id>.webp` ou null).

`photos[<clé>]` : `original`, `cutout`, `size`, `eye` ([x, y], 0,1 px), `eyeDist`, `centers` ([ligne
sous les yeux, x] tous les 10 px), `topLow`, `bottomHigh` (px sous les yeux ou null), `onePiece`,
`tucked`, et, facultatif (version 1 du champ), **`arms`** (bras pliés) :

| Champ | Type | Sens |
|---|---|---|
| `v` | entier | version du champ `arms` : 1 |
| `arms` | `{path, box}` | couche bras : `path` = `bras/<clé>.webp` ; `box` = [x, y, w, h] entiers, origine de l'image rognée dans la photo et sa taille (x, y peuvent valoir −1 ; x + w, y + h peuvent dépasser `size` de 1) |
| `body` | `{path, box}` | couche corps : `corps/<clé>.webp`, même `box` |
| `sleeves` | `{path, box}` ou null | couche manches : `manches-photo/<clé>.webp`, null si la photo n'a pas de manche sous l'ourlet |
| `step`, `from` | entiers | 5 et 250 : l'élément i des tableaux ci-dessous décrit la ligne `rel = from + i × step` px sous les yeux, c'est-à-dire la ligne `round(eye[1] + rel)` de la photo (arrondi au pair) |
| `L`, `R` | tableaux de [xmin, xmax] ou null | bords des bras de ce côté sur cette ligne, en colonnes de la photo (0,1 px ; médiane glissante sur 9 lignes) ; null : pas de bras. `L` = colonnes < `eye[0]` (moitié gauche de l'image), `R` = colonnes ≥ `eye[0]`. Même longueur n pour les quatre tableaux (lignes jusqu'au bas de la photo) |
| `sleeveL`, `sleeveR` | idem | bords des manches sous l'ourlet (classe « haut » du parseur, sur les côtés) |
| `wrist` | `{L, R}`, nombre ou null | poignet : première ligne (px sous les yeux, 0,1) à partir de 250 où la main de ce côté a au moins 15 px |
| `cuff` | `{L, R}`, nombre ou null | bas de manche : dernière ligne (px sous les yeux) où la manche de ce côté a au moins 10 px |

Le plan de dessin d'une tenue se calcule à partir de ces seules données (`bras_plan.draw_plan`,
[docs/conception.md §7](../../docs/conception.md#7-assemblage-des-photos-portées-mode-silhouette)) ;
`lib/assembly/fixtures/arms-reference.json`, généré en local par `ref_fixture.py bras` et non fourni dans
le dépôt, en donne des exemples avec les opérations canvas attendues.

## Outil de développement : `ref_fixture.py`

Pour le code de l'app, pas pour fabriquer un paquet. À partir d'un `manifest.json`, il écrit les valeurs
de référence que les tests TypeScript de `lib/assembly` doivent retrouver (données seulement, aucune
image) :

```
.venv/Scripts/python.exe -I ref_fixture.py <manifest.json> <reference.json>
.venv/Scripts/python.exe -I ref_fixture.py bras <manifest.json> <paires.json> <arms-reference.json>
```

(`.venv/bin/python` sur Mac et Linux.) `paires.json` : `[["<id du haut>", "<id du bas>", "ce que la
paire couvre"], …]`, un 4e élément facultatif `lower`, `upper` ou `cross` (voir l'en-tête du script).
À régénérer si les règles changent : le TypeScript doit rester identique au Python, qui est la
référence. Les fixtures tirées de photos personnelles ne se commitent pas (`.gitignore`, et
`npm run check:secrets` les refuse).

Sorties : `lib/assembly/fixtures/reference.json` (`margin`, `photos` avec leurs repères sans `arms`,
`items` = id → photo et catégorie, `cases` = toutes les paires haut × bas) et
`lib/assembly/fixtures/arms-reference.json`. Sans ces deux fichiers, les tests qui les lisent sont
sautés. Avec eux, ils ne passent entièrement que si le jeu couvre les cas que ces tests attendent ;
sinon ils échouent sur le cas manquant, ce qui ne dit rien d'un bug de l'app :

- `reference.json` : au moins une paire dont le ventre est étiré (`stretch` non nul) ;
- `paires.json`, avec exactement ces libellés (3e élément) : `bras nus`, `ventre étiré`,
  `manches longues`, `manches longues et ventre étiré` ; un même haut dans une paire `bras nus` et dans
  une paire `ventre étiré` ; et, en tout, au moins une paire en mode « bras pliés » (raison nulle) et
  exactement ces raisons du rendu actuel, ni plus ni moins : `haut long`, `haut plus long que la zone
  mesurée` (topLow null), `pas de données de bras` (cas `lower` ou `upper`) et `précondition : stripSides,
  kPositive` (le cas `cross`). L'en-tête de `ref_fixture.py` dit quelle paire choisir pour chaque cas.
