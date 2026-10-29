# Mode silhouette : tes tenues assemblées sur toi

Dans ce mode, tu te photographies **en portant** chaque vêtement, toujours au même endroit, devant un fond
vert. Un outil du PC en fait un paquet ; le miroir assemble ensuite chaque tenue en une seule silhouette :
le haut d'une photo, le bas d'une autre, les bras pliés au bon endroit. Rien n'est généré : tout est
photographié.

> ⚠️ **Licence : recherche ou évaluation seulement.** La chaîne photos a besoin du parseur de vêtements
> FASHN Human Parser, sous NVIDIA Source Code License for SegFormer : l'œuvre et ses dérivés « may be used
> or intended for use non-commercially », c'est-à-dire « for research or evaluation purposes only »
> ([THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)). Si ça ne te convient pas, reste au
> [mode simple](photos-simple.md), qui n'en a pas besoin.

Tout tourne sur ton PC, hors ligne une fois installé : tes photos ne vont nulle part ailleurs que dans ton
propre compte Supabase, au moment où tu importes le zip. Range-les dans un dossier **en dehors du dossier
du projet** (par exemple dans Documents ou Images) : l'outil refuse un dossier situé dans le projet, pour
qu'un `git add` ne les emporte jamais avec le code.

## Ce qu'il te faut

| Quoi | Détail |
|---|---|
| Un PC | **Windows : testé.** Mac Apple Silicon sous macOS 14 ou plus récent, et Linux x86_64 ou arm64 avec glibc 2.28 ou plus récent : prévus, **non testés**. Mac Intel : non pris en charge (torch n'y existe plus) |
| De la place | environ 1,1 Go (l'environnement Python, environ 870 Mo, et le parseur, 245 Mo) |
| Un fond vert | uni, du sol jusqu'au-dessus de ta tête, bien éclairé (tissu ou papier d'incrustation) |
| Un appareil photo fixe | un téléphone sur trépied suffit ; un retardateur ou une télécommande aide |

## 1. Prendre les photos

Les règles que l'outil **vérifie** (sur la photo ramenée à 1600 px de haut) :

| Règle | Valeur | Sinon |
|---|---|---|
| Format | portrait (plus haut que large) | arrêt |
| Hauteur | au moins 1600 px, une fois l'orientation appliquée | arrêt |
| Visage | trouvé par le détecteur (de face, yeux visibles) | arrêt, avec la liste des photos |
| Rapport largeur / hauteur | 3:4 (0,75), à ± 0,06 près | avertissement |
| Hauteur des yeux | 300 à 460 px depuis le haut (environ 24 % de la hauteur) | avertissement |
| Échelle | écart entre les yeux de 48 à 70 px : tu occupes toute la hauteur, de la tête aux pieds | avertissement |
| Même distance à chaque photo | écart entre les yeux à ± 12 % de la médiane des photos | avertissement |
| Centrage | yeux à moins de 12 % de la largeur du milieu | avertissement |
| Pieds | dans le cadre, au plus 1220 px sous les yeux (ce que montre le miroir) | avertissement |

Et ce qu'il **suppose** sans pouvoir le vérifier :

- **Appareil fixe** : même place, même hauteur, même zoom pour toutes les photos. L'échelle n'est jamais
  corrigée d'une photo à l'autre.
- **Rien de vert sur toi** : un vêtement vert devient transparent.
- Debout, de face, **bras le long du corps**, visage vers l'appareil.
- **Une seule pièce change d'une photo à l'autre** :
  - les hauts, toujours avec le même bas ;
  - les bas, avec un haut court qui laisse voir la ceinture ;
  - une veste, de préférence fermée ;
  - une robe, seule.

  Un bas porté avec un haut rentré ou une veste à manches laisse voir ce haut à la ceinture : reprends-le
  avec un haut court.

Formats lus : `.jpg`, `.jpeg`, `.png` (toute casse), et `.heic` / `.heif` si tu as répondu O à la question
de l'installeur. Sinon, sur iPhone : **Réglages** > **Appareil photo** > **Formats** > **Le plus
compatible**.

**Teste ton fond vert avant de tout photographier** : prends 2 photos (un haut, un bas), range-les dans un
dossier à part, installe la chaîne (étape 2), puis :

- Windows : glisse ce dossier sur **`scripts\assemblage\essai-fond.bat`** ;
- Mac, Linux : `bash scripts/assemblage/fabriquer.sh "/chemin/du/dossier" --fond` (voir
  [« Taper une commande »](#taper-une-commande)).

Regarde ensuite `controle/fond/*.jpg`, dans ce dossier : le sujet détouré sur fond noir. S'il reste du vert
autour de toi, ou si un bout de vêtement a disparu, améliore l'éclairage ou le fond avant de continuer.

## 2. Installer la chaîne photos (une fois)

Télécharge le dépôt (`git clone`, ou **Code** > **Download ZIP** sur GitHub), puis :

| Système | Commande |
|---|---|
| Windows | double-clic sur **`INSTALLER_PHOTOS.bat`**, à la racine du projet |
| Mac, Linux | `bash installer_photos.sh`, à la racine du projet |

L'installeur demande seulement si tes photos sont en HEIC, puis installe :

- [uv](https://docs.astral.sh/uv/) s'il manque (par winget sous Windows ; par le script officiel d'Astral,
  après confirmation, sur Mac et Linux) ;
- Python 3.13 et les dépendances aux versions exactes de `scripts/assemblage/uv.lock` (torch sans CUDA :
  tout tourne sur le processeur), dans `scripts/assemblage/.venv/` ;
- une fois, les deux modèles, dans `scripts/assemblage/modeles/` : le détecteur de visage YuNet (OpenCV
  Zoo, empreinte vérifiée) et le parseur FASHN Human Parser (Hugging Face, public, sans compte).

Aucune clé, aucun compte, aucune photo envoyée. Mesuré sur un PC de bureau Windows avec une bonne connexion
et Python 3.13 déjà présent : 65 s ; compte plusieurs minutes sur une connexion ordinaire.

Pour tout désinstaller :

1. supprime `scripts/assemblage/.venv/` et `scripts/assemblage/modeles/` ;
2. vide le cache de uv, qui garde une copie des paquets (environ 750 Mo ; les fichiers de `.venv` en sont
   des liens, d'où la place qui ne revient qu'à cette étape) : `uv cache clean` ;
3. si c'est uv qui a installé Python 3.13 : `uv python uninstall 3.13` ;
4. si c'est l'installeur qui a mis uv : `winget uninstall astral-sh.uv` sous Windows ; sur Mac et Linux,
   suis la page de désinstallation de [uv](https://docs.astral.sh/uv/).

## 3. Fabriquer le paquet

Mets tes photos dans un dossier **en dehors du dossier du projet**, sans sous-dossier (l'outil ne les
modifie jamais), puis :

| Système | Commande |
|---|---|
| Windows | glisse le dossier sur **`scripts\assemblage\fabriquer.bat`**, ou `scripts\assemblage\fabriquer.bat "C:\chemin\du\dossier"` |
| Mac, Linux | `bash scripts/assemblage/fabriquer.sh "/chemin/du/dossier"` |

C'est **la même commande à chaque fois** ; elle fait l'étape suivante :

1. **Premier lancement** (quelques secondes) : les photos sont préparées, les yeux trouvés, et l'outil
   crée `catalogue.csv` (une ligne par photo) et `controle/photos-1.jpg` (les vignettes avec leur nom de
   fichier). Il s'arrête là.
2. **Remplis `catalogue.csv`** (ci-dessous) dans un tableur, enregistre-le en CSV, ferme le tableur.
3. **Relance la même commande** : l'outil relit le tableau (une erreur dit la ligne et la colonne), puis
   fabrique tout. À la fin : `controle/tenues-*.jpg` et `mon-dressing-import.zip`, dans ton dossier.
4. **Regarde `controle/tenues-*.jpg`** : chaque haut et chaque veste sur un bas de référence, chaque bas sous
   un haut de référence, chaque robe seule, tels que le miroir les dessine. Si une coupe est fausse,
   corrige-la dans `corrections.csv` et relance.

Options : `--fond` (seulement le détourage, dans `controle/fond/` ; sous Windows, `essai-fond.bat` le fait
par glisser-déposer) ; `--regles` (en plus, des vignettes graduées dans `controle/regles/`, avec la ligne du
bas du haut en orange et celle du haut du bas en bleu). Une option ne passe pas par le glisser-déposer :
tape la commande.

### Taper une commande

- **Windows** : dans l'Explorateur, ouvre le dossier du projet, clique dans la barre d'adresse, tape `cmd`
  puis **Entrée** : une fenêtre noire s'ouvre, déjà dans ce dossier. Tape alors, avec les guillemets (le
  chemin de ton dossier se copie depuis la barre d'adresse de l'Explorateur) :

  ```
  scripts\assemblage\fabriquer.bat "C:\chemin\du\dossier" --regles
  ```

- **Mac, Linux** : ouvre le **Terminal**, tape `cd ` (avec l'espace), glisse le dossier du projet dans la
  fenêtre, **Entrée**. Tape ensuite `bash scripts/assemblage/fabriquer.sh ` (avec l'espace), glisse ton
  dossier de photos dans la fenêtre (le Terminal écrit son chemin, sans guillemets à ajouter), puis tape
  ` --regles` et **Entrée**. Tapé à la main, avec des guillemets, cela donne :

  ```bash
  bash scripts/assemblage/fabriquer.sh "/chemin/du/dossier" --regles
  ```

Remplace `--regles` par `--fond` pour l'essai du fond.

Temps mesurés sur un PC de bureau Windows, processeur seul : 5 à 10 s par photo, plus 15 à 30 s pour charger
le parseur au premier passage ; 3 à 8 s par photo quand le parseur est déjà passé sur elle (cache) ; environ
1 s par planche.

## Le tableau `catalogue.csv`

Créé avec des points-virgules, en UTF-8 : Excel en français l'ouvre par un double-clic. À la relecture, `;`,
`,` ou tabulation sont acceptés, en UTF-8 ou Windows-1252 ; les majuscules et les accents des valeurs sont
ignorés, les colonnes en plus aussi. **Une ligne par pièce**, dans cet ordre :

| Colonne | Ce que tu mets | Rempli d'avance |
|---|---|---|
| `photo` | le nom du fichier de la photo | oui |
| `id` | l'identifiant de la pièce : lettres sans accent, chiffres, `_`, `-`, 1 à 64, unique. **Garde-le** : au réimport, la pièce est retrouvée par lui | oui (tiré du nom de la photo) |
| `nom` | 1 à 80 caractères, par exemple « Pull col roulé marine » | non |
| `categorie` | `haut`, `bas`, `robe`, `veste`, `chaussures` ou `accessoire` (pluriels acceptés) | non |
| `couleur` | vide ou `auto` : calculée d'après la photo ; `#RRGGBB` (le `#` peut manquer) ; `aucune` | non |
| `chaleur` | `1`, `2`, `3`, ou `leger`, `moyen`, `chaud` | `2` |
| `styles` | `decontracte`, `habille`, `sport` ; plusieurs, reliés par `+` (ou `,`, `/`, espace) ; vide = décontracté | `decontracte` |
| `pluie` | `oui` ou `non` (aussi `o`, `n`, `x`, `1`, `0`, `vrai`, `faux`) ; vide = non | `non` |
| `rentre` | `oui` si le haut est rentré dans le bas **sur cette photo** ; vide = non | `non` |

- Une photo à ne pas utiliser : laisse `nom` et `categorie` vides (la ligne est ignorée, avec un
  avertissement).
- Deux pièces sur la même photo (par exemple le haut et le bas de ta tenue de départ) : copie la ligne et
  donne-lui un autre `id` (`photo07-bas` pour la photo `photo07.jpg`). `rentre` vaut pour la photo : deux
  lignes de la même photo qui se contredisent sont refusées.
- Une ligne à moitié remplie est une erreur, avec sa ligne et sa colonne. Entre 1 et 300 pièces par paquet.
- Une photo ajoutée plus tard : remets-la dans le dossier et relance ; une ligne vide est ajoutée en fin de
  tableau, le reste n'est jamais réécrit.

La couleur calculée est la médiane des pixels sûrs du vêtement. Elle donne presque toujours le même
résultat qu'une couleur choisie à la main pour ce qui compte dans l'app (pièce foncée éclaircie sur le
miroir ; couleur vive ou neutre pour les accords), mais la teinte exacte peut différer : corrige-la dans la
colonne si besoin.

## `corrections.csv` (facultatif)

Les deux lignes de coupe d'une photo sont calculées automatiquement : `top_low` (le point le plus bas du
haut, veste comprise, sans les manches) et `bottom_high` (le point le plus haut du bord du bas), en pixels
sous les yeux. Sur un jeu de photos réel, elles tombent à 2 ou 3 px près de deux lectures faites à la main,
avec de rares écarts plus grands (un coin d'ourlet collé à une manche, par exemple).

Pour en corriger une, crée `corrections.csv` dans ton dossier : `photo;top_low;bottom_high`, une ligne par
photo à corriger. Une valeur est un nombre de px sous les yeux, `aucune` (ligne inconnue : haut qui descend
très bas, bas caché par une veste longue), ou vide (la valeur automatique est gardée). Les valeurs calculées
sont dans `travail/lignes-auto.csv`, au même format : copie la ligne et change le nombre. `--regles` montre
la règle graduée.

## 4. Importer

Dans Mon Dressing, page **Importer** (sur le téléphone, ou dans le navigateur du PC connecté à ton compte :
`https://<projet>.vercel.app/gestion/import`) > **Choisir un fichier** > `mon-dressing-import.zip`. Un seul
zip, sans découpage : la page accepte 500 Mo, 10 Mo par image, 300 pièces et 300 photos par paquet. Garde
la page ouverte pendant l'envoi.

**Pour réimporter** (photos ajoutées, fiches corrigées) : refais le zip et importe-le de nouveau. Chaque
pièce est mise à jour par son `id` : **le tableau du PC fait foi**. Le nom, la catégorie, la couleur, la
chaleur, les styles et « pluie » reviennent aux valeurs de `catalogue.csv`, même si tu les as changés sur
le téléphone entre-temps (« au sale » est gardé). Corrige donc une fiche dans le tableau plutôt que sur le
téléphone.

Une pièce du mode silhouette n'a pas de « Changer la photo » : elle se change en réimportant le paquet.

## Pour aller plus loin

- Le format du dossier de travail, du paquet et de `manifest.json`, et le rôle de chaque module :
  [`scripts/assemblage/README.md`](../scripts/assemblage/README.md).
- Les règles du rendu (coupe, bras pliés, alignement) : [conception.md §7](conception.md#7-assemblage-des-photos-portées-mode-silhouette).
