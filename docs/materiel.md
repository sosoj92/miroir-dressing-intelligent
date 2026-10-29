# Le matériel

Ce qu'il faut pour le miroir, comment le monter, et ce qui a été testé ou non. Les règles qui en
découlent pour le code sont dans [conception.md §2](conception.md#2-matériel-de-référence).

## La liste

| Élément | Ce qu'il faut | Remarque |
|---|---|---|
| Tablette | Android, Chrome à jour, **caméra frontale**, branchée en permanence | La mise en page est pensée pour un écran de 800×1280 px CSS en portrait (par exemple 2560×1600 affiché à l'échelle 2, sur une tablette d'environ 12 pouces). Plus petit ou en paysage, ça marche, la silhouette est simplement plus petite |
| Miroir sans tain | une plaque un peu plus grande que l'écran ; acrylique d'environ 3 mm, ou verre | Il laisse passer la lumière de l'écran et reflète partout ailleurs |
| Fixation | un cadre ou un support mural qui tient la tablette plaquée contre le dos du miroir | Un support magnétique ou un cadre en bois font l'affaire |
| Alimentation | un câble assez long et une prise à proximité | La tablette ne s'éteint jamais |
| Téléphone | n'importe lequel, avec un navigateur | Il gère la garde-robe ; il ne touche jamais la tablette |
| PC | seulement pour le mode silhouette (Windows testé) ou pour essayer l'app | L'app en ligne ne dépend d'aucun ordinateur de la maison |

Pas de manette, pas de télécommande : le miroir se commande avec les bras ([gestes.md](gestes.md)). Un
clavier Bluetooth ou USB reste possible en secours.

## Comment ça marche, un miroir sans tain

Le verre réfléchit la lumière de la pièce, et laisse passer celle qui vient de derrière. Là où l'écran est
noir, tu vois ton reflet ; là où il est allumé, tu vois l'image. D'où les règles de l'app : fond noir pur,
texte clair, vêtements détourés, jamais de photo rectangulaire avec son fond.

Pour un bon résultat :

- la pièce doit être **plus éclairée devant le miroir que derrière** ;
- règle la luminosité de la tablette **au maximum**, à la main (le navigateur ne peut pas la régler), et
  coupe la luminosité adaptative ;
- couvre de noir tout le dos du miroir autour de la tablette : la moindre fuite de lumière se voit.

## La caméra

Un miroir sans tain arrête une grande partie de la lumière : la caméra frontale ne voit presque rien à
travers. Il faut **un trou dans le miroir devant l'objectif**, un peu plus grand que lui. Sur de
l'acrylique, perce doucement, avec un foret adapté et la feuille de protection encore en place.

- Regarde où est la caméra sur ta tablette une fois en portrait : souvent au milieu d'un bord long, donc
  sur un côté. Les gestes marchent quand même, l'image est analysée telle quelle.
- 1080p suffit, l'autofocus n'est pas nécessaire : l'app n'analyse que de petites images (environ
  640×480).

## Où le placer

- **Distance** : les gestes se font **entre 1,5 et 2 m** du miroir. La caméra doit voir au moins tes
  épaules et tes hanches (sinon, aucun geste ne compte), et pour « bas précédent », ta main devant le haut
  des cuisses. Vérifie le cadrage avec `?gestures=debug` ([gestes.md](gestes.md#régler-avec-gesturesdebug)).
- **Hauteur** : la caméra vers la hauteur de ta poitrine ou de ton visage, pas plus bas.
- **Lumière** : une lumière de chambre normale suffit, mieux si elle t'éclaire de face. Évite une fenêtre
  derrière toi : en contre-jour, les mains se voient mal.
- **Chaleur** : la caméra et l'analyse tournent tout le temps. Laisse de l'air derrière la tablette et
  touche-la au bout de quelques heures.
- **Avant de monter la tablette**, connecte-la ([tablette.md](tablette.md)) : à travers la vitre, le
  tactile ne marche plus.

## Ce qui est testé, et ce qui ne l'est pas

| Testé | Pas encore testé |
|---|---|
| L'app dans Chrome sur PC, au clavier et à la webcam | La tablette derrière un vrai miroir sans tain : seuils des gestes, luminosité, chaleur, vitesse du GPU |
| Les tests automatiques en 800×1280 (tablette) et 390×844 (téléphone), avec la fausse caméra de Chromium | Le mode kiosque et le retour après un redémarrage ([tablette.md](tablette.md#ce-qui-reste-à-tester)) |
| La méthode des gestes (zones), calée sur un essai réel à la webcam | Le mode PNG détouré sur un vrai iPhone ou Android |
| La chaîne photos sous Windows | La chaîne photos sur Mac (Apple Silicon) et Linux, et des photos HEIC d'un vrai iPhone |

Si tu montes le miroir, tes mesures (distance, luminosité, scores des gestes dans `?gestures=debug`)
intéressent le projet : ouvre une issue.
