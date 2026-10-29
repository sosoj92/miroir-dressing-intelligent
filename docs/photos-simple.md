# Mode simple : tes vêtements en photos détourées

Le mode simple n'a besoin que du téléphone. Chaque vêtement est une image détourée (le vêtement seul, sur
fond transparent). Sur le miroir, une tenue s'affiche **en pièces empilées** (la veste, le haut, le bas),
pas sur ta silhouette : pour ça, c'est le [mode silhouette](photos-silhouette.md).

Trois façons de faire, à mélanger comme tu veux :

| Façon | Coût | Pour |
|---|---|---|
| [1. Un PNG déjà détouré](#1-un-png-déjà-détouré-gratuit) | gratuit | une pièce à la fois, détourée sur le PC (le plus sûr) ou sur le téléphone |
| [2. Une photo ordinaire, détourée par fal.ai](#2-une-photo-ordinaire-détourée-par-falai-payant) | environ 0,018 $ la photo | une pièce à la fois, sans rien détourer toi-même |
| [3. Le zip simple](#le-zip-simple-plusieurs-pièces-dun-coup) | gratuit | beaucoup de pièces d'un coup, préparées sur le PC |

Dans les cas 1 et 2, la **fiche** (nom, catégorie, couleur, chaleur, styles, pluie) est remplie par Claude
si `ANTHROPIC_API_KEY` est réglée ([vercel.md](vercel.md#4-les-clés-facultatives-payantes)) ; sinon, tu la
remplis toi-même. Tu peux toujours la corriger avant d'enregistrer.

## Bien photographier une pièce à plat

- Le vêtement entier dans le cadre, posé bien à plat, sur un fond uni qui contraste (un drap clair pour un
  vêtement foncé, et l'inverse).
- Une lumière franche, sans ombre portée ni reflet.
- Une pièce par photo.

## 1. Un PNG déjà détouré (gratuit)

### Le plus sûr : sur le PC

1. Copie la photo sur le PC et **détoure-la** avec un outil qui enregistre un **PNG à fond transparent**,
   par exemple Paint sous Windows 11 (« Supprimer l'arrière-plan ») ou Aperçu sur Mac. Avant
   d'enregistrer, vérifie que le fond est bien transparent (en damier), puis enregistre en **PNG**.
2. Dans le navigateur du PC, connecte-toi à ton app (`https://<projet>.vercel.app/connexion`), puis ouvre
   `https://<projet>.vercel.app/gestion/garde-robe/ajouter` > **Choisir dans la galerie**, et choisis ce
   PNG. Le sélecteur de fichiers d'un PC envoie le fichier tel quel : il ne le convertit pas en JPEG.
3. Si l'écran affiche **« Fiche en cours… »** (et non « Détourage et fiche en cours… »), ton PNG a été
   reconnu comme détouré : fal.ai n'est pas appelé, rien n'est dépensé. Le serveur le revérifie de son
   côté.
4. Vérifie la fiche et **Enregistre**.

### Sur le téléphone (non testé)

Même chose depuis **Garde-robe** > **Ajouter** > **Choisir dans la galerie**, avec une image détourée par
le téléphone, par exemple :

- iPhone (iOS 16 ou plus récent) : dans Photos, maintiens le doigt sur le vêtement jusqu'à ce qu'il se
  détache, puis **Partager** > **Enregistrer l'image** : l'image détourée arrive dans la galerie
  (« Copier », lui, ne la met que dans le presse-papiers) ;
- Android : dans l'éditeur de la galerie, l'outil qui détoure le sujet ou efface l'arrière-plan, puis
  enregistre une copie.

Ce que l'app vérifie : un fichier **PNG** (pas WebP ni HEIC) avec de la transparence, au moins 1 % de
pixels entièrement transparents et au moins un pixel opaque, 4096 px de côté au plus. Si ce n'est pas le
cas, la photo est traitée comme une photo ordinaire (cas 2).

> **Non testé sur un vrai téléphone.** Ce mode est vérifié par les tests automatiques et avec un vrai PNG
> transparent, pas encore avec la galerie d'un iPhone ou d'un Android. Si ta galerie convertit le PNG en
> JPEG au moment de le choisir, la transparence est perdue : l'écran affiche alors « Détourage et fiche en
> cours… », et la photo suit le chemin de fal.ai, ou reste sans détourage si `FAL_KEY` n'est pas réglée.
> Passe alors par le PC (ci-dessus). Dis-nous ce qui marche chez toi (issue).

Une pièce déjà enregistrée sans détourage (« Photo à refaire ») : ouvre sa fiche, **Changer la photo**, et
choisis le PNG.

## 2. Une photo ordinaire, détourée par fal.ai (payant)

Avec `FAL_KEY` réglée dans Vercel ([vercel.md](vercel.md#4-les-clés-facultatives-payantes)), n'importe
quelle photo à plat est détourée côté serveur par Bria RMBG 2.0 sur fal.ai, pour environ 0,018 $ l'image
(crédits prépayés chez fal.ai).

**Garde-robe** > **Ajouter** > **Prendre une photo** (ou **Choisir dans la galerie**). L'écran affiche
« Détourage et fiche en cours… (jusqu'à une minute) », puis la fiche. Si le détourage échoue, la fiche
propose **Relancer le détourage**.

Sans `FAL_KEY`, la photo est enregistrée sans détourage, avec la note « Détourage indisponible : FAL_KEY
absente. Une photo PNG déjà détourée (fond transparent) passe sans elle. ». Sur le miroir, une pièce sans
détourage n'apparaît que par son nom.

La photo est envoyée à fal.ai par une adresse signée valable 10 min, sans stockage chez fal.ai au-delà
d'une heure ; elle va aussi à Claude si la fiche automatique est réglée. Rien d'autre ne sort.

## Le zip simple (plusieurs pièces d'un coup)

Pour importer beaucoup de pièces, prépare sur le PC un dossier `Dressing/`, **en dehors du dossier du
projet** si tu l'as cloné (tes photos n'ont rien à faire dans git), puis zippe-le :

```
Dressing/
├── db.json
└── photos/
    ├── veste-01.png
    ├── haut-01.png
    └── bas-01.png
```

Un `db.json` minimal :

```json
{
  "pieces": [
    { "id": "veste-01", "name": "Veste en jean", "category": "veste", "color": "#3A5A80",
      "warmth": "moyen", "occasions": ["quotidien"], "rain": false, "status": "dispo",
      "cutout": "veste-01.png" },
    { "id": "haut-01", "name": "Pull col roulé marine", "category": "haut", "color": "#1F2A44",
      "warmth": "chaud", "occasions": ["quotidien", "habille"], "rain": false, "status": "dispo",
      "cutout": "haut-01.png" },
    { "id": "bas-01", "name": "Jean brut", "category": "bas", "color": "#22304A",
      "warmth": "moyen", "occasions": ["quotidien"], "rain": true, "status": "dispo",
      "cutout": "bas-01.png" }
  ]
}
```

| Champ | Obligatoire | Valeurs |
|---|---|---|
| `id` | oui | lettres sans accent, chiffres, `_`, `-`, 1 à 64 caractères, unique. Il identifie la pièce : réimporter le même `id` met la pièce à jour, sans doublon |
| `category` | oui | `haut`, `veste` ou `bas` **seulement** (les autres pièces sont écartées et comptées) |
| `name` | non | 80 caractères au plus ; vide : « Haut », « Veste » ou « Bas » |
| `color` | non | `#RRGGBB`, ou `null` |
| `warmth` | non | `leger`, `moyen` ou `chaud` (`moyen` par défaut) |
| `occasions` | non | `quotidien` et `detente` deviennent « décontracté » ; `habille` et `sport` restent ; vide : décontracté |
| `rain` | non | `true` si la pièce va sous la pluie |
| `status` | non | `dispo` = propre ; toute autre valeur = au sale ; absent = propre |
| `cutout` | non, mais sans lui la pièce n'a pas d'image | nom d'un **PNG** transparent dans `photos/` |
| `photo` | non | nom d'une photo d'origine dans `photos/` (JPEG, PNG ou WebP), gardée sur la fiche sans être détourée |
| `createdAt` | non | date ISO, par exemple `2026-10-01T09:00:00Z` |

Règles des noms de fichiers : lettres sans accent, chiffres, `.`, `_`, `-`, commençant par une lettre ou un
chiffre, sans « .. » ; 10 Mo au plus par image. Le type est lu dans le fichier lui-même, pas dans son
extension.

Facultatif aussi, au même niveau que `pieces` : `wears` (tenues portées : `[{ "date": "AAAA-MM-JJ",
"haut": "<id>", "veste": "<id>", "bas": "<id>" }]`), `refusals` (tenues refusées : `[{ "haut": …,
"veste": …, "bas": … }]`), `plans` (tenues prévues : `{ "AAAA-MM-JJ": { "haut": …, "veste": …, "bas": …,
"confirmed": true } }`, seules les dates à partir d'aujourd'hui sont importées) et `settings.city`
(`{ "name": …, "lat": …, "lon": …, "timezone": "Europe/Paris" }`). Le détail : [conception.md
§3.1](conception.md#31-import-dun-dossier-dressing-zip-simple-format-dbjson).

Puis :

1. Zippe le dossier `Dressing/` (Windows : clic droit > **Compresser dans un fichier ZIP** ; Mac : clic droit
   > **Compresser**). `db.json` peut être à la racine du zip ou dans un dossier.
2. Dans l'app, **Importer** > **Choisir un fichier**, sur le téléphone ou dans le navigateur du PC connecté
   à ton compte.
3. Le bilan s'affiche : « 3 pièces importées », et le nombre de « photos à refaire » (pièces sans `cutout`
   lisible).

On peut aussi importer `db.json` seul : les fiches arrivent sans images.
