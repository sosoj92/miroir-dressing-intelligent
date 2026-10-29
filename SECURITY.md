# Politique de sécurité

Merci de contribuer à la sécurité de ce projet. Mon Dressing tient une **caméra allumée en permanence**
dans une pièce de vie, et garde des **photos personnelles** : les vulnérabilités sont prises au sérieux.

## Signaler une vulnérabilité

**N'ouvre PAS d'issue publique pour une faille de sécurité.** Utilise un canal privé :

1. **De préférence** : GitHub *Private vulnerability reporting*, onglet **Security** > **Report a
   vulnerability** de ce dépôt. Le rapport reste privé jusqu'à la publication d'un correctif.
2. À défaut, ouvre une issue **sans aucun détail technique** qui demande un canal de contact privé.

Merci d'inclure si possible : la description, les étapes pour reproduire, l'impact estimé, et une piste
de correctif. **Ne joins jamais de vraie clé, de jeton, ni de photo d'une personne** : décris-les.

Dans le périmètre, par exemple : une image de la caméra qui sortirait de la tablette ; un accès aux photos
ou aux fiches d'un compte sans session, ou par un autre compte que `ALLOWED_USER_ID` ; une règle RLS ou de
stockage contournable ; une clé lisible côté navigateur ; une redirection ouverte à la connexion.

## Divulgation coordonnée

Le projet s'engage à :

- **accuser réception** rapidement et te tenir informé·e ;
- **corriger** en priorité selon la sévérité ;
- ne rien exposer publiquement **avant** qu'un correctif soit disponible, sauf accord mutuel ;
- **créditer** les personnes qui le souhaitent (GitHub Security Advisory).

C'est un projet personnel sans programme de bug bounty : pas de récompense financière, mais une vraie
reconnaissance et un traitement sérieux.

## Bonnes pratiques côté installation

- **Ne publie jamais une clé.** `ANTHROPIC_API_KEY` et `FAL_KEY` vivent seulement dans les variables
  d'environnement de Vercel (ou dans `.env.local`, jamais commité). Ne les colle ni dans une issue, ni dans
  une conversation avec une IA, ni dans une capture d'écran.
- **N'utilise jamais la clé `secret` de Supabase** (`sb_secret_…`) : l'app n'en a pas besoin, et elle
  contourne toutes les règles RLS.
- Une clé exposée par erreur : **révoque-la tout de suite** (Claude Console > API keys, fal.ai > Keys), puis
  crée-en une autre et **Redeploy** sur Vercel. La retirer de git ne suffit pas : elle reste dans
  l'historique.
- Garde les **inscriptions fermées** dans Supabase et un seul compte : `ALLOWED_USER_ID` est la seule
  barrière contre quelqu'un qui créerait un compte pour dépenser tes crédits.
- La tablette doit ouvrir l'adresse de production en **HTTPS**.
- `npm run check:secrets` cherche, avant chaque commit, des clés dans les fichiers, les valeurs de ton
  `.env.local`, les images, archives et fixtures personnelles, et les fichiers supprimés du disque mais
  encore dans l'index git ; lance-le.
