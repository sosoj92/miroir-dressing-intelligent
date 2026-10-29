# Les gestes

Le miroir se commande avec les bras, devant la caméra de la tablette, sans manette ni tactile. Tout est
analysé sur la tablette par MediaPipe : l'image de la caméra n'est ni envoyée, ni enregistrée, ni affichée.

Place-toi **entre 1,5 et 2 m**, de face : la caméra doit voir tes épaules et tes hanches (sinon aucun geste
ne compte). Les règles complètes et les seuils : [conception.md §5](conception.md#5-contrôles-aucun-tactile-sur-la-tablette-pas-de-manette).

## Défiler : la méthode des zones

Chaque geste commence **main devant la poitrine** : la main « s'arme ». Puis tu l'emmènes dans une zone.

| Pour | Le geste (à ta droite = ton côté droit, face au miroir) | Au clavier |
|---|---|---|
| Haut suivant | main devant la poitrine, puis sortie sur le côté, **à ta droite** | → |
| Haut précédent | main devant la poitrine, puis sortie sur le côté, **à ta gauche** | ← |
| Bas suivant | main devant la poitrine, puis **au-dessus de la tête** | ↑ |
| Bas précédent | main devant la poitrine, puis **vers le bas, devant les cuisses** | ↓ |
| Rien | bras au repos le long du corps | |

- Un mouvement net suffit : la main n'a pas besoin de s'arrêter devant la poitrine.
- Pour défiler encore, **repasse devant la poitrine**. Une main laissée en l'air ne défile qu'une fois, et
  une main qui n'est pas repassée devant la poitrine depuis 1 s revient au repos.
- Deux défilements sont séparés d'au moins 0,5 s. Deux bras ouverts en grand ne font qu'un défilement.
- **De profil, rien ne compte** : devant un miroir, on se tourne souvent pour se voir de côté, et les épaules
  se confondent alors dans l'image.
- Une main posée sur la tête ne fait rien ; une main qui passe devant la poitrine puis au-dessus de la tête
  (se recoiffer) donne « bas suivant ».

## Valider : les gestes tenus

Main levée au-dessus de la taille, à peu près immobile, **tenue 1 s**. Un anneau se remplit autour de
l'icône du geste, en bas de l'écran.

| Geste | Pour | Au clavier |
|---|---|---|
| Pouce levé | **oui** : enregistre la tenue affichée (« Bonne journée », ou « Prête pour demain » le soir) | Entrée |
| Poing fermé | **non** : écarte ce que tu vois, et montre autre chose | Retour arrière |
| V (deux doigts) | **veste suivante** (sans veste, puis chaque veste) | V |
| (aucun) | **recommencer** : depuis le téléphone (page Demain), ou deux fois R au clavier | R, R |

- Après un geste tenu, 1,5 s de pause ; il faut relâcher le geste pour le refaire.
- « Oui » et « non » attendent que la nouvelle silhouette soit dessinée : on n'enregistre jamais une tenue
  qu'on n'a pas vue.
- Sur l'écran, les gestes sont des icônes au trait, sans emoji.

## Présence et veille

- **Arriver devant le miroir le réveille**, et rien d'autre : un geste déjà commencé ne compte qu'une fois
  relâché.
- Après **2 min sans personne** ni touche, le miroir n'affiche plus que l'heure, en grand (gris moyen de
  7 h à 22 h, très sombre la nuit).
- Rien ne se déclenche pendant la veille.

## Le clavier de secours

Un clavier branché à la tablette (USB ou Bluetooth), ou celui du PC pour essayer : flèches, V, Entrée,
Retour arrière, R, comme dans les tableaux. N'importe quelle touche réveille l'écran.

Un clavier aux touches inhabituelles (petit clavier Bluetooth, télécommande qui envoie des touches) :
ouvre `https://<projet>.vercel.app/?touches=test` sur la tablette. L'écran demande d'appuyer sur la touche de
chaque action et les enregistre. Les quatre actions de base (haut suivant et précédent, oui, non) sont
obligatoires, les autres facultatives.

## Régler avec `?gestures=debug`

Ouvre `https://<projet>.vercel.app/?gestures=debug` sur la tablette (ou `http://localhost:3000/?gestures=debug`
sur ton PC). Par-dessus le miroir, sur fond noir, sans jamais montrer l'image de la caméra :

- les zones (poitrine, côtés, ligne du haut, ligne du bas, taille, cuisses) et tes mains (point plein :
  armée ; cercle : au repos), retournées comme dans un miroir ;
- le moteur utilisé (GPU ou CPU) et les images par seconde ;
- la présence : « Personne », « Présente », « Recule » (épaules ou hanches mal vues), « De profil » ;
- le geste reconnu et son **score** (il en faut 0,6), l'état de chaque main et le dernier geste parti.

C'est l'outil pour trouver la bonne distance et la bonne lumière derrière la vitre.

## Essayer les gestes sans l'app

[`outils/capteurs.html`](../outils/capteurs.html) est une page de démonstration à ouvrir sur ton PC : ta
webcam, le squelette du corps et des mains en vert, et les zones du miroir en direct. Rien n'est envoyé ni
enregistré. Comment l'ouvrir : [`outils/README.md`](../outils/README.md).

## Si un geste passe mal

| Ce que tu vois | Essaie |
|---|---|
| Rien ne réagit | `?gestures=debug` : si la présence dit « Recule », recule (épaules et hanches doivent être vues) ; si elle dit « Personne », plus de lumière sur toi |
| Le V est mal reconnu de loin | rapproche-toi un peu (1,5 m), éclaire ta main de face, doigts bien écartés, paume vers le miroir, main à hauteur de poitrine ; regarde son score dans le debug. Au clavier : V |
| « Bas précédent » ne part pas | descends la main bien devant les cuisses, pas sur le côté |
| Des défilements partent seuls | vérifie que tu es de face ; une main qui passe devant la poitrine en marchant peut s'armer |
| Une ligne grise sous la météo (« Caméra refusée… », « Caméra occupée… », « Gestes indisponibles… ») | [depannage.md](depannage.md#la-caméra-et-les-gestes) |

Les seuils sont des constantes nommées (`lib/gestures/constants.ts`), réglées sur un essai réel. Derrière
un vrai miroir, ils restent à confirmer : tes mesures intéressent le projet (issue).
