# Licences tierces

*[English version below](#third-party-notices-english)*

Le code de Mon Dressing est sous licence MIT ([LICENSE](LICENSE)). Il s'appuie sur des logiciels, des
modèles et des données d'autres auteurs, chacun sous sa propre licence, relevée ici d'après sa source.

**Aucun de ces fichiers n'est copié dans le dépôt** : les paquets s'installent avec npm (`package-lock.json`)
ou uv (`scripts/assemblage/uv.lock`), et les modèles sont téléchargés depuis leur source officielle, avec
contrôle de leur empreinte, au moment de l'installation. Seule exception : `app/favicon.ico`, l'icône par
défaut de create-next-app (MIT).

Ce relevé n'est pas un avis juridique. Si tu redistribues l'app ou ses modèles, ou si tu t'en sers dans
un cadre commercial, vérifie toi-même les conditions de chaque source.

## Dans l'app (navigateur et serveur)

| Composant | Version | Licence | Rôle |
|---|---|---|---|
| [Next.js](https://github.com/vercel/next.js) | 16.4.3 | MIT | framework de l'app |
| [React](https://github.com/facebook/react), React DOM | 19.3.0 | MIT | interface |
| [@supabase/supabase-js](https://github.com/supabase/supabase-js), [@supabase/ssr](https://github.com/supabase/ssr) | 2.118.0, 0.12.7 | MIT | base, stockage, connexion |
| [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) | 0.133.0 | MIT | fiche automatique d'une photo (facultatif) |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3 | MIT, © Arjun Barrett | lecture des zip d'import et des PNG détourés, dans le navigateur |
| [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) | 0.10.35 | Apache-2.0 | moteur des gestes (JavaScript et wasm, copiés vers `public/mediapipe/wasm/` au build, jamais commités) |
| server-only | 0.0.1 | MIT | garde des modules serveur |

Outils de développement (pas dans l'app servie) : Tailwind CSS 4.3.3 (MIT), TypeScript 5.9.3
(Apache-2.0), ESLint 9.39.5 (MIT), Vitest 5.0.5 (MIT), Playwright 1.64.1 (Apache-2.0). La liste complète
est dans `package-lock.json` ; le texte de chaque licence, dans `node_modules/<paquet>/`.

## Modèles MediaPipe (gestes)

Téléchargés par `scripts/mediapipe-assets.mjs` avant `npm run dev` et `npm run build`, vers
`public/mediapipe/models/` (ignoré par git), puis servis par l'app elle-même. Chaque fichier est vérifié
par son empreinte SHA-256, écrite dans le script.

| Fichier | Source | Licence, d'après sa fiche (model card) |
|---|---|---|
| `pose_landmarker_lite.task` | [storage.googleapis.com/mediapipe-models/…/float16/1/](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task) | Fiche [BlazePose GHUM 3D](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf) : « LICENSED UNDER Apache License, Version 2.0 » |
| `gesture_recognizer.task` | [storage.googleapis.com/mediapipe-models/…/float16/1/](https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task) | Deux parties. Suivi de la main : fiche [Hand Tracking (Lite/Full)](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20(Lite_Full)%20with%20Fairness%20Oct%202021.pdf), « LICENSED UNDER Apache License, Version 2.0 ». Classifieur de gestes : sa [fiche](https://storage.googleapis.com/mediapipe-assets/gesture_recognizer/model_card_hand_gesture_classification_with_faireness_2022.pdf) ne mentionne **aucune licence** |

Pour le classifieur de gestes, aucune licence explicite n'a été trouvée : le fichier est publié par Google
pour MediaPipe, et ce dépôt ne le redistribue pas (chaque installation le télécharge chez Google). La
licence Apache-2.0 du paquet npm couvre le JavaScript et le wasm, pas ces fichiers `.task`, qui ne sont
pas dans le paquet.

`outils/capteurs.html`, une page de démonstration à part, charge `@mediapipe/tasks-vision` 0.10.14 depuis
jsDelivr et `pose_landmarker_full.task` depuis la même adresse de Google (fiche BlazePose GHUM 3D,
Apache 2.0).

## Données et services

| Service | Ce qui y passe | Conditions |
|---|---|---|
| [Open-Meteo](https://open-meteo.com/) | la ville (prévisions, recherche de ville), côté serveur, sans clé | Données sous [CC BY 4.0](https://open-meteo.com/en/licence). Open-Meteo demande un lien à côté de tout endroit où ses données sont affichées, par exemple `<a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>`. L'API gratuite est réservée à un usage non commercial, moins de 10 000 appels par jour ([conditions](https://open-meteo.com/en/terms)). La recherche de ville s'appuie sur GeoNames (CC BY) |
| [Supabase](https://supabase.com/) | fiches, photos des vêtements, connexion | ton compte, ses conditions |
| [Vercel](https://vercel.com/) | l'app en ligne | ton compte ; le plan Hobby est réservé à un usage personnel non commercial |
| [Anthropic, Claude API](https://platform.claude.com/) (facultatif) | une photo à plat, pour remplir sa fiche | ton compte, payant ; par défaut, Anthropic n'utilise pas les données envoyées par l'API pour entraîner ses modèles ([Privacy Center](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training)) |
| [fal.ai](https://fal.ai/), Bria RMBG 2.0 (facultatif) | une photo à plat, pour la détourer | ton compte, payant ; pas pour un PNG déjà détouré |

**Attribution météo** : Weather data by [Open-Meteo.com](https://open-meteo.com/), sous licence
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Chaîne photos du mode silhouette (PC)

Installée par `INSTALLER_PHOTOS.bat` ou `installer_photos.sh` dans `scripts/assemblage/.venv/` et
`scripts/assemblage/modeles/` (ignorés par git). Licences relevées dans les métadonnées des paquets
installés :

| Paquet Python | Version | Licence |
|---|---|---|
| numpy | 2.5.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| opencv-python | 5.0.0.93 | Apache 2.0 |
| pillow | 13.0.0 | MIT-CMU |
| torch (index CPU de PyTorch) | 2.14.1 | Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT |
| transformers | 5.20.2 | Apache 2.0 |
| huggingface-hub | 2.3.0 | Apache-2.0 |
| fashn-human-parser | 0.1.1 | renvoie à la licence du modèle (ci-dessous) |
| pillow-heif (option HEIC) | 1.8.1 | BSD-3-Clause |

| Modèle | Source | Licence |
|---|---|---|
| YuNet, `face_detection_yunet_2023mar.onnx` (repère les yeux) | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet), commit figé `f12e127`, SHA-256 `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` vérifié | MIT, © 2020 Shiqi Yu (`models/face_detection_yunet/LICENSE`) |
| FASHN Human Parser (classes du corps et des vêtements) | [huggingface.co/fashn-ai/fashn-human-parser](https://huggingface.co/fashn-ai/fashn-human-parser), révision `1f80c34dbab321c5730dda5c3fea279fd3e97498`, public (aucun compte) | Fiche du modèle : `license: other`, `nvidia-segformer`. [NVIDIA Source Code License for SegFormer](https://github.com/NVlabs/SegFormer/blob/master/LICENSE), §3.3 : l'œuvre et ses dérivés « may be used or intended for use non-commercially », c'est-à-dire « for research or evaluation purposes only » |

**Conséquence** : le parseur FASHN est obligatoire dans la chaîne photos (manches, bras pliés, lignes de
coupe). Le mode silhouette ne peut donc servir que pour de la recherche ou de l'évaluation, au sens de
cette licence. Le mode simple (photos détourées depuis le téléphone) n'utilise pas ce modèle.

---

# Third-party notices (English)

Mon Dressing's code is MIT-licensed ([LICENSE](LICENSE)). It relies on software, models and data by other
authors, each under its own license, recorded here from its source. **None of these files is copied into
the repository**: packages install through npm or uv, and models download from their official source,
with a checksum, at install time. One exception: `app/favicon.ico`, the create-next-app default icon
(MIT). This is not legal advice: if you redistribute the app or its models, or use them commercially,
check each source's terms yourself.

- **App** (see the first table above): Next.js, React, supabase-js, @supabase/ssr, the Anthropic SDK,
  fflate and server-only are MIT; @mediapipe/tasks-vision is Apache-2.0 (JavaScript and wasm only).
- **MediaPipe models** (downloaded by `scripts/mediapipe-assets.mjs`, never committed): the pose model and
  the hand-tracking part of the gesture recognizer are Apache 2.0 according to their model cards; the
  gesture-classifier model card states **no license**. This repository does not redistribute these files.
- **Open-Meteo**: data under CC BY 4.0; a link must appear next to where its data is displayed (for
  example "Weather data by Open-Meteo.com"); the free API is for non-commercial use, under 10,000 calls a
  day. Weather data by [Open-Meteo.com](https://open-meteo.com/).
- **Photo pipeline (silhouette mode, PC)**: YuNet is MIT (© 2020 Shiqi Yu). FASHN Human Parser is under the
  NVIDIA Source Code License for SegFormer, §3.3: "may be used or intended for use non-commercially",
  meaning "for research or evaluation purposes only". The parser is required by the photo pipeline, so the
  silhouette mode is for research or evaluation only. The simple mode does not use it.
