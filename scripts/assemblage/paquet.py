# Contrôle du paquet avec les règles de l'appli, puis zip unique prêt à importer (page Importer).
# Les règles sont celles de lib/import/assemblage.ts (parseAssemblyManifest, checkEntry, checkBytes)
# et de lib/assembly/parse.ts (parseAssemblyPhoto, parseAssemblyArms) : un paquet qui passe ici
# passe l'import. Le zip n'est pas compressé (ZIP_STORED : JPEG et WebP le sont déjà).
import json, math, os, re, zipfile

FORMAT, VERSION = 'mon-dressing/assemblage', 1
KEY = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
COLOR = re.compile(r'^#[0-9A-Fa-f]{6}$')
SAFE_PATH = re.compile(r'^[A-Za-z0-9._\-/]+$')
CATEGORIES = ('haut', 'bas', 'robe', 'veste', 'chaussures', 'accessoire')
STYLES = ('decontracte', 'habille', 'sport')
MAX_ITEMS = MAX_PHOTOS = 300
MAX_FILE = 10 * 1024 * 1024          # limite du bucket items, par image
MAX_MANIFEST = 5 * 1024 * 1024
MAX_ZIP = 500 * 1024 * 1024          # fichier choisi sur la page Importer
MAX_SIZE, MAX_ROW, MAX_CENTERS, MAX_ARM_ROWS = 8000, 4000, 400, 400
ARMS_KEYS = {'v', 'arms', 'body', 'sleeves', 'step', 'from', 'L', 'R', 'sleeveL', 'sleeveR', 'wrist', 'cuff'}
ARMS_DIRS = {'arms': 'bras', 'body': 'corps', 'sleeves': 'manches-photo'}


def _num(v, lo, hi):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and lo <= v <= hi

def _pair(v, lo, hi):
    return isinstance(v, list) and len(v) == 2 and _num(v[0], lo, hi) and _num(v[1], lo, hi)

def _row(v, lo=-MAX_ROW, hi=MAX_ROW):
    return v is None or _num(v, lo, hi)

def _layer(v, size):
    if not isinstance(v, dict) or set(v) != {'path', 'box'}: return False
    p, box = v['path'], v['box']
    if not (isinstance(p, str) and len(p) <= 512 and SAFE_PATH.match(p) and p.endswith('.webp')): return False
    if any(part in ('', '.', '..') for part in p.split('/')): return False
    if not (isinstance(box, list) and len(box) == 4 and all(isinstance(b, int) and not isinstance(b, bool) for b in box)):
        return False
    x, y, w, h = box
    return w >= 1 and h >= 1 and x >= -1 and y >= -1 and x + w <= size[0] + 1 and y + h <= size[1] + 1

def _spans(v, width):
    if not isinstance(v, list) or not 0 < len(v) <= MAX_ARM_ROWS: return False
    return all(e is None or (_pair(e, 0, width) and e[0] <= e[1]) for e in v)

def _arms(v, size):
    """= parseAssemblyArms : None si lisible, sinon la raison."""
    if not isinstance(v, dict) or set(v) != ARMS_KEYS: return 'champs'
    if v['v'] != 1 or v['step'] != 5 or v['from'] != 250: return 'version, pas ou première ligne'
    if not _layer(v['arms'], size) or not _layer(v['body'], size): return 'couches'
    if v['sleeves'] is not None and not _layer(v['sleeves'], size): return 'couche des manches'
    for k in ('L', 'R', 'sleeveL', 'sleeveR'):
        if not _spans(v[k], size[0]): return f'bords {k}'
    n = len(v['L'])
    if any(len(v[k]) != n for k in ('R', 'sleeveL', 'sleeveR')): return 'longueurs des bords'
    if 250 + (n - 1) * 5 > size[1]: return 'lignes sous le bas de la photo'
    for k in ('wrist', 'cuff'):
        s = v[k]
        if not isinstance(s, dict) or set(s) != {'L', 'R'} or not all(_row(s[x], 0, size[1]) for x in 'LR'):
            return k
    return None

def _photo(k, p):
    """= readPhoto + parseAssemblyPhoto : None si lisible, sinon la raison."""
    if not isinstance(p, dict): return 'repères absents'
    if p.get('original') != f'photos/{k}.jpg' or p.get('cutout') != f'photos/{k}.webp': return 'noms des photos'
    size, eye = p.get('size'), p.get('eye')
    if not _pair(size, 1, MAX_SIZE) or not _pair(eye, 0, MAX_SIZE) or eye[0] > size[0] or eye[1] > size[1]:
        return 'taille ou yeux'
    c = p.get('centers')
    if not isinstance(c, list) or len(c) > MAX_CENTERS: return 'milieux'
    for i, e in enumerate(c):
        if not _pair(e, -MAX_ROW, MAX_SIZE) or (i and e[0] <= c[i - 1][0]): return 'milieux'
    if not _row(p.get('topLow', 'x')) or not _row(p.get('bottomHigh', 'x')): return 'lignes'
    if not isinstance(p.get('onePiece'), bool) or not isinstance(p.get('tucked'), bool): return 'onePiece ou tucked'
    if p.get('arms') is not None:
        why = _arms(p['arms'], size)
        if why: return f'bras pliés illisibles ({why})'
        for name, folder in ARMS_DIRS.items():
            layer = p['arms'][name]
            if layer is not None and layer['path'] != f'{folder}/{k}.webp': return f'couche {name} inattendue'
    return None

def _item(it, i, photos):
    """= readItem + readItemFields : None si lisible, sinon le message."""
    if not isinstance(it, dict): return f'pièce n° {i + 1} : fiche illisible'
    lid = it.get('legacy_id')
    if not isinstance(lid, str) or not KEY.match(lid): return f'pièce n° {i + 1} : identifiant refusé'
    name = it.get('name')
    if not isinstance(name, str) or not 1 <= len(re.sub(r'\s+', ' ', name).strip()) <= 80: return f'{lid} : nom'
    if it.get('category') not in CATEGORIES: return f'{lid} : catégorie'
    if it.get('color') is not None and not (isinstance(it['color'], str) and COLOR.match(it['color'])): return f'{lid} : couleur'
    if it.get('warmth') not in (1, 2, 3) or isinstance(it.get('warmth'), bool): return f'{lid} : chaleur'
    st = it.get('styles')
    if not isinstance(st, list) or not 0 < len(st) <= len(STYLES) or any(s not in STYLES for s in st): return f'{lid} : styles'
    if not isinstance(it.get('rain_ok'), bool): return f'{lid} : rain_ok'
    if it.get('photo') not in photos: return f'{lid} : photo absente du manifeste'
    if it.get('sleeves') is not None and it['sleeves'] != f'manches/{lid}.webp': return f'{lid} : manches inattendues'
    return None

def fichiers(manifest):
    """Images que l'import envoie (= uploadPlan) : photo d'origine, détourée, couches, manches."""
    out = []
    for k in dict.fromkeys(it['photo'] for it in manifest['items']):
        p = manifest['photos'][k]
        out += [p['original'], p['cutout']]
        arms = p.get('arms')
        if arms:
            out += [arms[n]['path'] for n in ('arms', 'body', 'sleeves') if arms[n]]
    out += [it['sleeves'] for it in manifest['items'] if it['sleeves']]
    return out

def verifier(manifest, dossier):
    """Erreurs (liste vide si le paquet passera l'import)."""
    errors = []
    if manifest.get('format') != FORMAT or manifest.get('version') != VERSION: return ['format ou version du manifeste']
    photos, items = manifest.get('photos'), manifest.get('items')
    if not isinstance(photos, dict) or not 0 < len(photos) <= MAX_PHOTOS: errors.append(f'photos : 1 à {MAX_PHOTOS}')
    if not isinstance(items, list) or not 0 < len(items) <= MAX_ITEMS: errors.append(f'pièces : 1 à {MAX_ITEMS}')
    if errors: return errors
    for k, p in photos.items():
        if not KEY.match(k): errors.append(f'photo « {k} » : nom refusé')
        else:
            why = _photo(k, p)
            if why: errors.append(f'photo {k} : {why}')
    seen = set()
    for i, it in enumerate(items):
        why = _item(it, i, photos)
        if why: errors.append(why)
        elif it['legacy_id'] in seen: errors.append(f'identifiant en double : {it["legacy_id"]}')
        seen.add(it.get('legacy_id'))
    if errors: return errors
    size = os.path.getsize(os.path.join(dossier, 'manifest.json'))
    if size > MAX_MANIFEST: errors.append(f'manifest.json : {size} octets, {MAX_MANIFEST} au plus')
    for rel in fichiers(manifest):
        path = os.path.join(dossier, rel)
        if not os.path.exists(path): errors.append(f'fichier absent : {rel}'); continue
        if os.path.getsize(path) > MAX_FILE: errors.append(f'fichier trop lourd : {rel} (10 Mo au plus)'); continue
        with open(path, 'rb') as f: head = f.read(12)
        ok = head[:3] == b'\xff\xd8\xff' if rel.endswith('.jpg') else (head[:4] == b'RIFF' and head[8:12] == b'WEBP')
        if not ok: errors.append(f'{rel} : type d\'image inattendu')
    return errors

def zipper(manifest, dossier, zip_path):
    """Zip unique : manifest.json à la racine puis chaque image envoyée, une seule fois. Renvoie sa taille."""
    os.makedirs(os.path.dirname(os.path.abspath(zip_path)), exist_ok=True)
    part = zip_path + '.part'
    with zipfile.ZipFile(part, 'w', zipfile.ZIP_STORED) as z:
        z.write(os.path.join(dossier, 'manifest.json'), 'manifest.json')
        for rel in dict.fromkeys(fichiers(manifest)):
            z.write(os.path.join(dossier, rel), rel)
    os.replace(part, zip_path)
    return os.path.getsize(zip_path)
