# Dépannage

Commence presque toujours par ouvrir `https://<projet>.vercel.app/api/health`. Tout va bien quand tu lis :

```json
{"ok":true,"supabase":"configurée","ALLOWED_USER_ID":"définie"}
```

La page ne montre jamais les valeurs. Elle dit seulement si les variables sont là (« configurée »,
« définie »), absentes, ou, pour `ALLOWED_USER_ID`, « invalide » (renseignée, mais pas un uuid).

**Après tout changement de variable dans Vercel : Deployments > ⋯ > Redeploy.** Sans redéploiement, le
changement ne fait rien ([vercel.md](vercel.md#3-changer-une-variable)).

## La tablette

| Tu vois | Cause probable | Que faire |
|---|---|---|
| « Serveur injoignable, nouvel essai dans un instant » | Le schéma de la base est incomplet : il manque les colonnes `legacy_id` ou `assembly` de la table `items` | Recolle tout [`supabase/schema.sql`](../supabase/schema.sql) dans le SQL Editor, puis **Run** (il se relance sans dommage) |
| | Les droits de la Data API manquent (projet Supabase récent, tables collées avec une ancienne version de `schema.sql`) : Vercel > le projet > **Logs** affiche « permission denied for table » (code 42501) | Recolle tout `supabase/schema.sql` **à jour**, puis lance la requête de vérification ([supabase.md, étape 2](supabase.md#2-créer-les-tables)) : 7 lignes, `true` partout |
| | `ALLOWED_USER_ID` absente ou invalide (`/api/health` le dit) | Recopie l'UID depuis Supabase > Authentication > Users, puis **Redeploy** |
| | Le projet Supabase est en pause (plan gratuit, après 7 jours sans activité) | Supabase > le projet > **Resume project** |
| | Pas de réseau | La tablette réessaie toute seule |
| « Mon Dressing n'est pas encore configuré » | `NEXT_PUBLIC_SUPABASE_URL` ou `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` manque, ou a été ajoutée sans redéployer | Vérifie les deux dans Vercel, puis **Redeploy** |
| « Tablette non connectée » | Pas de session (premier lancement, ou session perdue) | Touche « Se connecter » (avant de monter la tablette) |
| « Ce compte n'a pas accès à Mon Dressing » | Tu es connecté avec un autre compte que celui de `ALLOWED_USER_ID` | Vérifie que l'UID dans Vercel est bien celui de ton compte |
| « Souci d'affichage, nouvel essai dans un instant » | Un écran a planté | La page se recharge seule (30 s, 2 min, puis toutes les 10 min) ; une touche recharge tout de suite. Si ça revient, ouvre une issue |
| « Aucune tenue disponible » | Aucun haut ni robe propre (ou aucun bas propre sans robe) | Remets des pièces propres depuis le téléphone (Garde-robe > « au sale ») |
| « Météo indisponible » | Open-Meteo ne répond pas, ou limite d'appels (les adresses de Vercel sont partagées, la limite peut tomber plus tôt) | Rien à faire : la météo revient seule. La tenue reste proposée |
| « · hors ligne » au bout de la date | Pas de réseau | La tablette garde la tenue affichée ; tes choix partent au retour du réseau |
| L'écran s'éteint | Mise en veille d'Android | [tablette.md](tablette.md#3-garder-lécran-allumé) |

## La connexion

| Tu vois | Cause probable | Que faire |
|---|---|---|
| « La connexion n'est pas encore configurée. » | Variables `NEXT_PUBLIC_…` absentes (ou pas de redéploiement) | Comme « pas encore configuré » ci-dessus |
| « Adresse ou mot de passe incorrect. » | L'e-mail ou le mot de passe est faux, ou le compte n'a pas été confirmé | Retape l'adresse et le mot de passe. Si tu viens de créer le compte et n'as encore ajouté aucun vêtement, tu peux le supprimer dans Supabase > **Authentication** > **Users** et le recréer avec **Auto Confirm User** (puis son nouvel UID dans Vercel, et **Redeploy**). **Sinon, ne le supprime pas : tous ses vêtements partiraient avec lui** ; connecte-toi par le lien par e-mail |
| « Trop de tentatives. Réessaie dans une minute. » | Trop d'essais de suite | Attends une minute |
| « La connexion a échoué. Réessaie. » | Le mot de passe est bon, mais le serveur n'a pas pu vérifier le compte : `ALLOWED_USER_ID` absente ou invalide, pas de réseau, ou projet Supabase en pause | Ouvre `/api/health` ; vérifie le réseau ; Supabase > le projet > **Resume project** |
| Le lien par e-mail n'arrive pas | Le service d'e-mail par défaut de Supabase n'envoie que 2 e-mails par heure, et seulement aux adresses de l'équipe du projet | Connecte-toi avec le mot de passe ; ou utilise pour le compte l'adresse de ton compte Supabase |
| « Ce lien n'est plus valable. Demande-en un nouveau. » | Le lien a déjà servi (une boîte Outlook ou Hotmail ouvre chaque lien pour l'analyser), ou il a expiré (1 h) | Connecte-toi avec le mot de passe, ou demande un lien vers une autre boîte |
| « Ouvre le lien dans le navigateur où tu l'as demandé » | Le lien a été ouvert dans un autre navigateur que celui de la demande | Ouvre l'e-mail sur le même appareil, dans le même navigateur |
| Le lien renvoie vers `localhost` | La **Site URL** de Supabase est restée sur localhost | [supabase.md, étape 6](supabase.md#6-après-le-déploiement--les-adresses-de-connexion) |

## La caméra et les gestes

| Tu vois | Cause probable | Que faire |
|---|---|---|
| « Caméra refusée : gestes coupés. » | L'autorisation a été refusée, ou donnée « Uniquement cette fois » | Chrome : icône à gauche de l'adresse > Autorisations > Caméra > **Autoriser**, puis recharge |
| « Caméra occupée par une autre appli. » | Une autre appli tient la caméra (visio, appli photo, logiciel de webcam) | Ferme-la ; le miroir réessaie toutes les 30 s |
| « Gestes indisponibles pour l'instant. » | Le moteur des gestes ne se charge pas (modèles absents, mémoire) | Recharge la page. Si ça dure : dans Vercel, regarde le journal du build (ligne `mediapipe-assets`) et redéploie |
| Aucun geste, aucune ligne grise | La page est ouverte en `http://` (pas `https://` ni `localhost`) | Ouvre l'adresse Vercel en `https://` |
| Rien ne réagit aux bras | Trop près, trop loin, ou de profil ; épaules ou hanches hors champ | `?gestures=debug` ([gestes.md](gestes.md#régler-avec-gesturesdebug)) |
| Le V est mal reconnu de loin | Main trop petite dans l'image, ou mal éclairée | Rapproche-toi (1,5 m), éclaire ta main de face, doigts écartés ; ou V au clavier |

## Les photos et les fiches

| Tu vois | Cause probable | Que faire |
|---|---|---|
| « Détourage indisponible : FAL_KEY absente. … » | Pas de `FAL_KEY` | Choisis un PNG déjà détouré ([photos-simple.md](photos-simple.md#1-un-png-déjà-détouré-gratuit)), ou règle `FAL_KEY` |
| « Fiche automatique indisponible : ANTHROPIC_API_KEY absente. » | Pas de clé Anthropic | Remplis la fiche toi-même, ou règle la clé |
| « Fiche automatique indisponible pour le moment : remplis-la toi-même. » | L'appel à Claude a échoué : crédits épuisés, ou clé pas rattachée à un espace de travail | Console Claude : vérifie les crédits, et crée une clé rattachée à un espace de travail ([vercel.md](vercel.md#4-les-clés-facultatives-payantes)) |
| « Photo à refaire » sur une pièce, ou la pièce n'apparaît sur le miroir que par son nom | Pas d'image détourée | Fiche > **Changer la photo** avec un PNG détouré, ou **Relancer le détourage** (avec `FAL_KEY`) |
| Le PNG choisi passe par « Détourage et fiche en cours… » | La galerie l'a converti en JPEG, ou il n'a pas assez de transparence | Ajoute-le depuis le navigateur du PC, qui envoie le fichier tel quel ([photos-simple.md](photos-simple.md#1-un-png-déjà-détouré-gratuit)) |
| « Ce fichier n'est pas un db.json du prototype. » | Le zip ne contient pas de `db.json` lisible (et ce n'est pas un paquet du mode silhouette) | Vérifie le format ([photos-simple.md](photos-simple.md#le-zip-simple-plusieurs-pièces-dun-coup)) |
| « Ce fichier est trop gros. » | Plus de 500 Mo | Fais plusieurs zips |
| Les fiches importées reprennent leurs anciennes valeurs | Réimport d'un paquet du mode silhouette : le tableau du PC fait foi | Corrige dans `catalogue.csv`, puis réimporte |

## Le PC

| Tu vois | Cause probable | Que faire |
|---|---|---|
| `npm run check:secrets` : « ce dossier doit être un dépôt git » | Le dépôt a été téléchargé en ZIP | Utilise `git clone` |
| Le build s'arrête sur `mediapipe-assets` | Le téléchargement des modèles a échoué (réseau) | Relance ; le message dit quel fichier poser à la main, et où |
| `npm ci` affiche « EBADENGINE », ou les tests ne démarrent pas | Node trop ancien | Node 22.12 ou plus récent (`node --version`) |
| La chaîne photos s'arrête | Photo en paysage, trop petite, sans visage, ou modèle absent | Le message le dit ; [photos-silhouette.md](photos-silhouette.md#1-prendre-les-photos) ; pour un modèle absent, relance l'installeur |

Toujours bloqué ? Ouvre une issue avec ce que dit `/api/health` et le message exact. **Ne colle jamais de
clé, de jeton ni le contenu de `.env.local`** dans une issue.
