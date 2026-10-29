# Outils

## `capteurs.html` : voir ce que voit le miroir

Une page de démonstration, à part de l'app : ta webcam, le squelette du corps et les points des mains en
vert, et les zones des gestes du miroir en direct. Pratique pour comprendre les gestes, trouver la bonne
distance, ou filmer une démo. Tout tourne dans ton navigateur : aucune image n'est envoyée ni enregistrée.

Pour cette page seulement, MediaPipe est chargé depuis le CDN jsDelivr et les modèles depuis Google : il
faut une connexion internet. L'app, elle, sert ses propres fichiers.

### L'ouvrir

Le navigateur ne donne la caméra qu'à une page servie en `https://` ou depuis `localhost`. Sers donc le
dossier avec un petit serveur local, au choix, depuis la racine du projet :

```bash
npx serve outils -l 5000
```

puis ouvre `http://localhost:5000/capteurs.html` ; ou, avec Python :

```bash
python -m http.server 8000 --directory outils
```

puis ouvre `http://localhost:8000/capteurs.html` (sous Windows, `py` à la place de `python` si la commande
n'est pas reconnue). Si le port est déjà pris, choisis-en un autre. Autorise la caméra quand le navigateur
la demande.

Touches : **Z** affiche ou cache les zones, **H** le texte, **F** passe en plein écran.

C'est une version simplifiée de la reconnaissance du miroir (sans la garde « de profil » ni le délai
d'armement) : pour régler les vrais seuils, ouvre l'app avec `?gestures=debug`
([docs/gestes.md](../docs/gestes.md#régler-avec-gesturesdebug)).
