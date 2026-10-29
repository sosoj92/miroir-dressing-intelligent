# La tablette

À faire **avant** de monter la tablette derrière le miroir : une fois la vitre posée, le tactile ne passe
plus. Il te faut l'adresse de ton app (`https://<projet>.vercel.app`, voir [vercel.md](vercel.md)) et ton
compte (e-mail et mot de passe, voir [supabase.md](supabase.md)).

## 1. Se connecter

1. Sur la tablette, ouvre **Chrome** à l'adresse de production, `https://<projet>.vercel.app`.
2. L'écran affiche « Tablette non connectée ». Touche **Se connecter**.
3. Entre ton e-mail et ton mot de passe. Tu reviens au miroir.

La tablette reste connectée ensuite : la session ne s'expire pas d'elle-même. Le lien par e-mail
(« Recevoir un lien par e-mail ») marche aussi, mais seulement s'il est ouvert **sur la tablette, dans
Chrome** : un lien ouvert ailleurs mène au message « Ouvre le lien dans le navigateur où tu l'as demandé ».

## 2. Autoriser la caméra

Au premier affichage du miroir, **deux demandes** peuvent se suivre : celle d'Android, qui autorise Chrome à
utiliser la caméra, puis celle de Chrome, qui autorise ton site. Réponds chaque fois l'option **permanente**
(du type « Lorsque vous utilisez l'appli » pour Android, **Autoriser** pour le site), jamais « Uniquement
cette fois » : sinon l'autorisation expire, et personne ne pourra la redonner derrière la vitre. Les
libellés exacts varient selon la version d'Android et de Chrome. Si tu as refusé par erreur : icône à
gauche de l'adresse > **Autorisations** > **Caméra** > **Autoriser**, puis recharge la page (et, côté
Android, **Paramètres** > **Applications** > **Chrome** > **Autorisations** > **Appareil photo**).

**La caméra exige le HTTPS.** Sur `https://<projet>.vercel.app`, c'est bon. Une tablette qui ouvre
`http://<IP-du-PC>:3000` (ton PC sur le réseau local) affiche le miroir mais n'a **pas de gestes** : seul
`localhost` fait exception, et il ne désigne que l'appareil lui-même.

## 3. Garder l'écran allumé

L'app ne garde pas l'écran allumé d'elle-même sur le miroir : règle-le dans Android.

- **Paramètres** > **Affichage** > **Mise en veille de l'écran** : la durée la plus longue. Ou, dans les
  **Options pour les développeurs**, **Rester activé** (l'écran ne s'éteint jamais pendant la charge).
  Ces options sont cachées au départ : **Paramètres** > **À propos de la tablette** (parfois dans
  **Informations sur le logiciel**), touche **7 fois** **Numéro de build** ; elles apparaissent ensuite dans
  les paramètres (souvent sous **Système**).
- **Verrouillage de l'écran** : **Aucun**. Sinon, après une coupure, la tablette reste sur l'écran de
  verrouillage.
- **Luminosité** au maximum, **luminosité adaptative** coupée.
- Les noms exacts varient selon la marque et la version d'Android.

L'app gère sa propre veille : après 2 min sans personne devant le miroir, elle n'affiche plus que l'heure,
et se réveille quand quelqu'un arrive.

## 4. Plein écran et retour après un redémarrage

Personne ne pourra toucher l'écran derrière la vitre : après une coupure de courant, l'app doit revenir
seule. Ce n'est **pas encore dans le code** (pas d'application installable ni de cache hors ligne) : ça se
règle sur la tablette. Pistes, à essayer :

- **Chrome seul** : le plus simple. Sa barre d'adresse reste visible en haut, et elle s'allume derrière le
  miroir. Un cache noir sur cette zone, ou l'épinglage d'écran d'Android, peut suffire pour commencer.
- **Termux:Boot** (gratuit) : relance l'adresse dans Chrome au démarrage de la tablette. Il faut deux
  applis, **Termux** et **Termux:Boot**, installées toutes les deux depuis **F-Droid** (les versions du
  Play Store sont anciennes, et les deux doivent venir de la même source). Ouvre Termux:Boot une fois,
  puis, dans Termux, crée un script dans le dossier `~/.termux/boot/` qui lance
  `am start -a android.intent.action.VIEW -d https://<projet>.vercel.app`, et rends-le exécutable
  (`chmod +x`). Il faut aussi autoriser Termux à **Afficher par-dessus les autres applis**. Le détail est
  dans la documentation de Termux:Boot (wiki de Termux).
- **Fully Kiosk Browser** : plein écran, lancement au démarrage, rechargement au retour du réseau, écran
  toujours allumé. **L'accès à la caméra par un site web y est une fonction payante** (licence par
  appareil), indispensable aux gestes.

Ce que l'app fait déjà d'elle-même : si un écran plante, elle affiche « Souci d'affichage, nouvel essai dans
un instant » et se recharge seule (30 s, 2 min, puis toutes les 10 min) ; sans Wi-Fi, elle garde la tenue
affichée et l'indique par « · hors ligne ».

## 5. Monter et régler

1. Branche la tablette, monte-la derrière le miroir ([materiel.md](materiel.md)).
2. Place-toi entre 1,5 et 2 m et essaie les gestes ([gestes.md](gestes.md)).
3. Pour régler : un clavier branché à la tablette, ou ouvre `https://<projet>.vercel.app/?gestures=debug`
   avant de monter la tablette. Il affiche les zones des gestes, l'état de tes mains et les scores.

## Ce qui reste à tester

- Les seuils des gestes, derrière un vrai miroir, avec la caméra de la tablette.
- La vitesse du moteur des gestes sur le processeur graphique d'une tablette (l'app passe d'elle-même sur
  le processeur central si le GPU est trop lent).
- Le retour après un redémarrage avec Termux:Boot ou Fully Kiosk Browser.
- La chaleur au bout de quelques heures.

Si tu as essayé, ouvre une issue avec ce que tu as observé.
