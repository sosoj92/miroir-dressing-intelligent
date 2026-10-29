#!/usr/bin/env node
// Prépare les fichiers MediaPipe servis par l'app elle-même (la tablette ne charge rien depuis un
// CDN) ; lancé avant `next dev` et `next build` (predev, prebuild). Ni l'un ni l'autre n'est commité.
// 1. Le moteur (wasm) est copié du paquet npm vers public/mediapipe/wasm : sa version suit le lockfile.
// 2. Les deux modèles (.task) sont téléchargés une fois depuis les URL officielles versionnées de
//    Google vers public/mediapipe/models, puis vérifiés par leur empreinte SHA-256. Un fichier déjà
//    présent et intact n'est pas retéléchargé. Les empreintes sont celles des fichiers officiels
//    (md5 identique à l'en-tête x-goog-hash de storage.googleapis.com).
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = 'mediapipe-assets';

// --- 1. Moteur wasm --------------------------------------------------------------------------

const wasmFrom = join('node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmTo = join('public', 'mediapipe', 'wasm');
mkdirSync(wasmTo, { recursive: true });
const wasmFiles = readdirSync(wasmFrom).filter((name) => /^vision_wasm_(nosimd_)?internal\.(js|wasm)$/.test(name));
if (wasmFiles.length !== 4) {
  console.error(`${NAME} : 4 fichiers attendus dans ${wasmFrom}, ${wasmFiles.length} trouvés.`);
  process.exit(1);
}
for (const name of wasmFiles) copyFileSync(join(wasmFrom, name), join(wasmTo, name));
console.log(`${NAME} : ${wasmFiles.length} fichiers du moteur copiés vers ${wasmTo}`);

// --- 2. Modèles --------------------------------------------------------------------------------

const MODELS_DIR = join('public', 'mediapipe', 'models');
/** Modèles lus par components/mirror/gestures/camera.ts (/mediapipe/models/…). */
const MODELS = [
  {
    file: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    bytes: 5_777_746,
    sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  },
  {
    file: 'gesture_recognizer.task',
    url: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
    bytes: 8_373_440,
    sha256: '97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482',
  },
];
/** Délai maximal d'un téléchargement (le build Vercel a internet ; une connexion lente reste possible). */
const DOWNLOAD_TIMEOUT_MS = 120_000;
const ATTEMPTS = 3;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function isIntact(path, model) {
  if (!existsSync(path)) return false;
  return sha256(readFileSync(path)) === model.sha256;
}

/** Télécharge le modèle ; renvoie un message d'erreur en clair, ou null si tout va bien. */
async function download(model, path) {
  const partial = `${path}.part`;
  let lastError = '';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(model.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`réponse HTTP ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (sha256(data) !== model.sha256) {
        // Un fichier différent de celui attendu n'est jamais gardé (ni servi à la tablette).
        return `empreinte inattendue (${data.length} octets reçus, ${model.bytes} attendus) : fichier refusé`;
      }
      writeFileSync(partial, data);
      renameSync(partial, path);
      return null;
    } catch (error) {
      rmSync(partial, { force: true });
      lastError = error instanceof Error ? (error.name === 'TimeoutError' ? 'délai dépassé' : error.message) : String(error);
    }
  }
  return `téléchargement impossible (${lastError})`;
}

mkdirSync(MODELS_DIR, { recursive: true });
const failures = [];
for (const model of MODELS) {
  const path = join(MODELS_DIR, model.file);
  if (isIntact(path, model)) {
    console.log(`${NAME} : ${model.file} déjà présent et vérifié`);
    continue;
  }
  if (existsSync(path)) {
    console.log(`${NAME} : ${model.file} abîmé ou d'une autre version, nouveau téléchargement`);
    rmSync(path, { force: true });
  } else {
    console.log(`${NAME} : téléchargement de ${model.file} (${(model.bytes / 1e6).toFixed(1)} Mo)…`);
  }
  const error = await download(model, path);
  if (error) failures.push({ model, error });
  else console.log(`${NAME} : ${model.file} téléchargé et vérifié`);
}

if (failures.length > 0) {
  console.error('');
  console.error(`${NAME} : modèle MediaPipe manquant, les gestes ne marcheraient pas.`);
  for (const { model, error } of failures) {
    console.error(`  - ${model.file} : ${error}`);
    console.error(`    Télécharge-le à la main depuis ${model.url}`);
  }
  console.error(`  puis place-le dans ${MODELS_DIR}${process.platform === 'win32' ? '\\' : '/'} et relance la commande.`);
  console.error('  (Vérifie aussi ta connexion à internet, ou un pare-feu qui bloquerait storage.googleapis.com.)');
  // `npm run dev` démarre quand même (le clavier commande tout, sans gestes) ; un build s'arrête :
  // un déploiement sans modèles laisserait la tablette sans gestes.
  if (process.env.npm_lifecycle_event === 'predev') {
    console.error(`${NAME} : l'app démarre quand même, sans les gestes.`);
  } else {
    process.exit(1);
  }
}
