#!/usr/bin/env node
// Garde-fou à lancer avant chaque commit, sur ce que git prendrait (fichiers suivis + nouveaux non ignorés) :
//  1. des clés API (motifs ci-dessous) ;
//  2. les valeurs de .env.local (et des autres .env* sauf .env.example), quand ce fichier existe : un uuid
//     ou une URL ne ressemble à aucune clé, mais c'est l'identité du compte. Seul le NOM de la variable
//     s'affiche, jamais sa valeur ;
//  3. toute image, archive, tableau, modèle ou autre binaire (seul app/favicon.ico est permis), et les
//     fixtures tirées de photos ou de journaux personnels (lib/assembly/fixtures, lib/gestures/fixtures) ;
//  4. les fichiers supprimés du disque mais encore dans l'index : un commit les publierait quand même ;
//  5. la version indexée des fichiers modifiés depuis : c'est elle qu'un « git commit » sans « git add »
//     enregistre.
// Usage : node scripts/check-secrets.mjs  (branché sur `npm run check:secrets`)
// Sort avec le code 1 et la liste des emplacements si quelque chose doit sortir du commit.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const PATTERNS = [
  { name: 'clé Anthropic', re: /sk-ant-[A-Za-z0-9_-]{10,}/ },
  { name: 'clé secrète Supabase', re: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: "jeton d'accès Supabase", re: /\bsbp_[0-9a-f]{40}\b/ },
  { name: 'ancienne clé Supabase (JWT)', re: /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'clé fal.ai', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}\b/i },
  { name: 'FAL_KEY renseignée', re: /FAL_KEY\s*[:=]\s*['"`][^'"`\s]{16,}/ },
  { name: 'secret dans une variable NEXT_PUBLIC_', re: /NEXT_PUBLIC_(?:[A-Z0-9]+_)*?(?:SECRET|PRIVATE|SERVICE|TOKEN|FAL|ANTHROPIC|CLAUDE|API_KEY)(?![A-Z0-9])/ },
  { name: 'clé privée', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'clé API en clair', re: /(?:api[_-]?key|secret|token|password|credentials)\w*['"]?\s*[:=]\s*['"`][A-Za-z0-9_\-:+=]{24,}['"`]/i },
  { name: 'variable secrète renseignée', re: /^\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN)\s*[:=]\s*['"]?[A-Za-z0-9_\-:+=\/]{16,}['"]?\s*$/ },
];

// Fichiers que ce script s'autorise à ne pas inspecter pour les motifs : lui-même (il les contient).
const SELF = 'scripts/check-secrets.mjs';
const MAX_BYTES = 2 * 1024 * 1024;
// Le seul binaire du dépôt : l'icône par défaut de create-next-app.
const ALLOWED_BINARY = new Set(['app/favicon.ico']);
// Photos, vidéos, archives, tableaux et modèles : rien de tout cela n'appartient au dépôt.
const FORBIDDEN_EXT =
  /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif|avif|ico|mp4|mov|m4v|webm|mkv|avi|zip|7z|rar|tar|gz|tgz|csv|xlsx?|task|onnx|tflite|pt|pth|safetensors|bin|npy|npz)$/i;
const PERSONAL_DIRS = ['lib/assembly/fixtures/', 'lib/gestures/fixtures/'];
// Valeurs d'environnement trop courtes pour être cherchées sans fausse alerte (« true », « 12 »…).
const MIN_VALUE = 8;

// stderr ignoré : les avertissements de fins de ligne de git ne concernent pas ce contrôle.
function git(args, encoding = 'utf8') {
  return execFileSync('git', args, { encoding, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
}

function listZ(args) {
  try {
    return git(args).split('\0').filter(Boolean);
  } catch {
    console.error('check:secrets : ce dossier doit être un dépôt git (git init).');
    process.exit(2);
  }
}

/** Valeurs des .env* de la racine (sauf .env.example) : [nom, fichier, valeur en minuscules]. */
function envNeedles() {
  const needles = [];
  let names;
  try {
    names = readdirSync('.').filter((name) => /^\.env/.test(name) && name !== '.env.example');
  } catch {
    return needles;
  }
  for (const envFile of names) {
    let text;
    try {
      if (!statSync(envFile).isFile()) continue;
      text = readFileSync(envFile, 'utf8');
    } catch {
      continue;
    }
    for (const raw of text.split(/\r?\n/)) {
      const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let value = m[2];
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
      if (value.length < MIN_VALUE) continue;
      needles.push([m[1], envFile, value.toLowerCase()]);
      // Le sous-domaine d'une URL (la référence du projet Supabase) trahit le compte à lui seul.
      try {
        const host = new URL(value).hostname;
        const label = host.split('.')[0];
        if (label.length >= MIN_VALUE && label !== 'localhost' && !/^[\d.]+$/.test(host)) {
          needles.push([m[1], envFile, label.toLowerCase()]);
        }
      } catch {
        // pas une URL
      }
    }
  }
  return needles;
}

const needles = envNeedles();
const findings = [];

function inspect(file, buffer, label = file) {
  if (buffer.length > MAX_BYTES) {
    findings.push(`${label} — fichier de plus de 2 Mo : rien de si gros n'appartient au dépôt`);
    return;
  }
  if (buffer.includes(0)) {
    if (!ALLOWED_BINARY.has(file)) findings.push(`${label} — fichier binaire (seul app/favicon.ico est permis)`);
    return;
  }
  const lines = buffer.toString('utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (file !== SELF) {
      for (const { name, re } of PATTERNS) {
        if (re.test(line)) findings.push(`${label}:${i + 1} — ${name}`);
      }
    }
    if (needles.length) {
      const lower = line.toLowerCase();
      const seen = new Set();
      for (const [name, envFile, value] of needles) {
        if (!seen.has(name) && lower.includes(value)) {
          seen.add(name);
          findings.push(`${label}:${i + 1} — valeur de ${name} (${envFile})`);
        }
      }
    }
  });
  // .env.example ne doit contenir que des noms : toute valeur non vide est suspecte.
  if (file === '.env.example') {
    lines.forEach((line, i) => {
      const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
      if (m && m[2].trim() !== '') findings.push(`${label}:${i + 1} — valeur renseignée pour ${m[1]}`);
    });
  }
}

// 4. Supprimés du disque, encore dans l'index.
const deleted = new Set(listZ(['ls-files', '--deleted', '-z']));
for (const file of deleted) {
  findings.push(`${file} — supprimé du disque mais encore dans l'index : git rm --cached -- "${file}"`);
}

// 1 à 3. Ce qui est sur le disque.
for (const file of listZ(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])) {
  if (/(^|\/)\.env/.test(file) && !file.endsWith('.env.example')) {
    findings.push(`${file} — fichier de variables d'environnement : il doit être ignoré par git (.gitignore)`);
    continue;
  }
  if (PERSONAL_DIRS.some((dir) => file.startsWith(dir))) {
    findings.push(`${file} — fixture tirée de données personnelles : jamais dans le dépôt`);
    continue;
  }
  if (FORBIDDEN_EXT.test(file) && !ALLOWED_BINARY.has(file)) {
    findings.push(`${file} — image, archive, tableau ou modèle : rien de tel n'appartient au dépôt`);
    continue;
  }
  if (deleted.has(file)) continue;
  let buffer;
  try {
    if (!statSync(file).isFile()) continue;
    buffer = readFileSync(file);
  } catch {
    continue;
  }
  inspect(file, buffer);
}

// 5. La version indexée des fichiers modifiés depuis le dernier « git add ».
const changed = listZ(['diff', '--name-only', '-z']).filter((file) => !deleted.has(file));
if (changed.length) {
  const wanted = new Set(changed);
  const blobs = [];
  for (const entry of listZ(['ls-files', '--stage', '-z'])) {
    const tab = entry.indexOf('\t');
    const file = entry.slice(tab + 1);
    if (wanted.has(file)) blobs.push([file, entry.slice(0, tab).split(' ')[1]]);
  }
  // Une seule commande pour tous les contenus : « <sha> blob <taille>\n<contenu>\n » par fichier
  // (« <sha> missing\n » sans contenu si l'objet manque).
  const out = blobs.length
    ? execFileSync('git', ['cat-file', '--batch'], {
        input: blobs.map(([, sha]) => sha).join('\n') + '\n',
        maxBuffer: 1 << 30,
        stdio: ['pipe', 'pipe', 'ignore'],
      })
    : Buffer.alloc(0);
  let at = 0;
  for (const [file] of blobs) {
    const eol = out.indexOf(10, at);
    if (eol < 0) break;
    const [, type, size] = out.subarray(at, eol).toString('latin1').split(' ');
    if (type !== 'blob') {
      at = eol + 1;
      continue;
    }
    const content = out.subarray(eol + 1, eol + 1 + Number(size));
    at = eol + 1 + Number(size) + 1;
    inspect(file, content, `${file} (version indexée)`);
  }
}

if (findings.length) {
  console.error('À retirer avant de commiter — ne commite pas, et révoque toute clé concernée :');
  for (const f of findings) console.error('  ' + f);
  process.exit(1);
}
console.log(
  needles.length
    ? 'check:secrets : aucun secret trouvé (valeurs de .env* comprises).'
    : 'check:secrets : aucun secret trouvé.',
);
