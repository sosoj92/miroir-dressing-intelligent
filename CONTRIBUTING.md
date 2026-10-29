# Contribuer à Mon Dressing

Merci de vouloir contribuer ! Le projet a des **règles de design et de vie privée non négociables** :
un miroir sans tain ne pardonne aucune lumière inutile, et une caméra dans une chambre ne pardonne aucune
fuite. Lis ceci avant d'ouvrir une PR.

## Ce qui aide le plus

- **Des retours d'essai sur une vraie tablette derrière un vrai miroir** : distance, lumière, scores des
  gestes dans `?gestures=debug`, chaleur, retour après un redémarrage. Ouvre une issue avec ta tablette,
  ce que tu as mesuré et ce qui a raté.
- Le **mode PNG détouré** essayé avec la galerie d'un vrai iPhone ou Android.
- La **chaîne photos** sur Mac Apple Silicon ou Linux (`installer_photos.sh`, `fabriquer.sh`).
- Une traduction de l'interface (chantier à part : tout est en français aujourd'hui).

## Les règles à respecter

Elles sont détaillées dans [AGENTS.md](AGENTS.md) (valables aussi pour un humain) et
[docs/conception.md](docs/conception.md).

### Le miroir
- Fond `#000` pur, aucune bordure ni zone grise : seuls le texte, les icônes au trait, l'anneau de
  progression et les vêtements détourés s'allument.
- **Pas d'emoji dans l'interface**, ni dégradé, halo, effet de verre, étiquette en majuscules espacées.
  Les pictogrammes sont des icônes au trait.
- Tout marche sans tactile sur la tablette : les gestes des bras, un clavier en secours.

### Le code
- Le choix des tenues (`lib/outfits/`) et la reconnaissance des gestes (`lib/gestures/`) restent des
  **fonctions pures**, testées sans réseau ni caméra. Un seuil de geste est une constante nommée de
  `lib/gestures/constants.ts`.
- Interface en français, avec tutoiement ; code et noms de colonnes en anglais ; commentaires en
  français, dans le style du fichier voisin.
- Pas de nouvelle dépendance sans l'expliquer dans la PR.
- Une règle de produit qui change se reporte dans `docs/conception.md`, à la section que le code cite.
- Un changement de schéma : une migration relançable dans `supabase/migrations/`, et `supabase/schema.sql`
  refait comme leur concaténation ([docs/developpeurs.md](docs/developpeurs.md#changer-le-schéma-de-la-base)).

### Les secrets et la vie privée
- **Jamais de clé, de jeton ni de mot de passe** dans le code, les tests, les fixtures, les captures ou une
  issue. Les valeurs vivent dans `.env.local` (jamais commité) et dans Vercel ; `.env.example` ne liste que
  des noms.
- **Jamais de photo ni de vidéo d'une personne** dans le dépôt, même floutée : les tests utilisent des
  images synthétiques et la mire de la fausse caméra de Chromium. Pas de données tirées de vraies photos
  non plus (repères, contours), ni de noms de vêtements personnels.
- L'image de la caméra ne quitte jamais la tablette ; rien ne part vers un service externe en dehors de ce
  que fixe [docs/conception.md §9](docs/conception.md#9-ce-qui-sort-de-la-tablette-et-vers-où).
- **Documentation généraliste** : aucun matériel présenté comme déjà possédé, aucun chemin, nom d'appareil
  ou réseau personnel ; des exemples et des espaces réservés (`<projet>`).

## Processus : issue → PR → revue

1. **Ouvre une issue** qui décrit le besoin ou le bug (ou commente une issue existante), pour éviter le
   travail en double.
2. **Fork + branche** (`feat/ma-modification`).
3. **PR** vers `main` : description claire, lien vers l'issue, comment tester sur la tablette, et des
   captures des écrans modifiés (800×1280 pour le miroir, 390×844 pour le téléphone ; jamais de personne
   dessus).
4. **Revue** : on vérifie le design, la vie privée, les tests et la doc.

## Avant de committer (checklist)

- [ ] `npm run lint`, `npm run typecheck` et `npm test` passent.
- [ ] `npm run build` et `npm run e2e` passent (un seul `e2e` à la fois : il prend le port 3210).
- [ ] `npm run check:secrets` ne trouve rien, et `git diff` ne contient ni clé, ni jeton, ni donnée
      personnelle.
- [ ] Aucune photo, vidéo ou fixture tirée d'une vraie personne.
- [ ] `docs/` à jour si un comportement visible change.

Merci 🙏
