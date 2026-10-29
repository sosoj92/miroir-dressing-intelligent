# Préparation des photos : celles du dossier (JPEG ou PNG, quelle que soit la casse de l'extension ;
# HEIC si pillow-heif est installé) sont copiées dans <travail>/photos/<clé>.jpeg, sous une clé valide
# pour l'appli (lettres sans accent, chiffres, _ et -, 64 au plus). Un JPEG est copié octet pour
# octet (son orientation EXIF est appliquée à la lecture, chroma.load) ; un PNG ou un HEIC est
# converti en JPEG, orientation appliquée. Les photos d'origine ne sont jamais modifiées.
# Cadrage exigé : portrait, au moins 1600 px de haut une fois tournée (la chaîne travaille à 1600 px).
import json, os, re, shutil, unicodedata
from PIL import Image, ImageOps

try:  # photos d'iPhone ; facultatif (l'installeur le propose)
    from pillow_heif import register_heif_opener
    register_heif_opener()
    HEIC = True
except ImportError:
    HEIC = False

EXT_JPEG = {'.jpg', '.jpeg'}
EXT_AUTRES = {'.png'}
EXT_HEIC = {'.heic', '.heif'}
MIN_H = 1600                    # hauteur minimale (px), photo tournée
RATIO = 3 / 4                   # largeur / hauteur attendue (portrait 3:4)
RATIO_TOL = 0.06                # écart toléré sur ce rapport avant un avertissement
REGISTRE = 'photos.json'


def cle(stem):
    """Nom de fichier -> clé de l'appli : accents retirés, autres caractères remplacés par « - »."""
    text = unicodedata.normalize('NFKD', stem).encode('ascii', 'ignore').decode('ascii')
    text = re.sub(r'[^A-Za-z0-9_-]+', '-', text).strip('-')[:64].strip('-')
    return text or 'photo'


def sources(dossier):
    """Photos du dossier (pas des sous-dossiers), triées par nom ; et les fichiers HEIC ignorés."""
    found, heic_skipped = [], []
    for name in sorted(os.listdir(dossier), key=str.lower):
        path = os.path.join(dossier, name)
        if name.startswith('.') or not os.path.isfile(path): continue
        ext = os.path.splitext(name)[1].lower()
        if ext in EXT_JPEG or ext in EXT_AUTRES or (ext in EXT_HEIC and HEIC):
            found.append(name)
        elif ext in EXT_HEIC:
            heic_skipped.append(name)
    return found, heic_skipped


def _sha256(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''): h.update(chunk)
    return h.hexdigest()


def preparer(dossier, travail):
    """Copie les photos et vérifie leur cadrage. Renvoie (photos, erreurs, avertissements) ; photos =
    [{'key', 'source', 'path', 'size'}] dans l'ordre des noms de fichiers."""
    out_dir = os.path.join(travail, 'photos')
    os.makedirs(out_dir, exist_ok=True)
    reg_path = os.path.join(travail, REGISTRE)
    registre = {}
    if os.path.exists(reg_path):
        with open(reg_path, encoding='utf-8') as f: registre = json.load(f)
    names, heic_skipped = sources(dossier)
    errors, warnings = [], []
    for name in heic_skipped:
        warnings.append(f'{name} : photo HEIC ignorée. Relance l\'installeur et réponds O à la question HEIC, '
                        f'ou exporte la photo en JPEG (iPhone : Réglages > Appareil photo > Formats > Le plus compatible).')
    photos, used_keys = [], {}
    new_registre = {}
    for name in names:
        src = os.path.join(dossier, name)
        key = cle(os.path.splitext(name)[0])
        base, n = key, 2
        while key.lower() in used_keys:     # deux noms qui donnent la même clé (casse, accents)
            key = f'{base[:60]}-{n}'; n += 1
        used_keys[key.lower()] = name
        dst = os.path.join(out_dir, key + '.jpeg')
        digest = _sha256(src)
        old = registre.get(key)
        try:
            if not (old and old.get('source') == name and old.get('sha256') == digest and os.path.exists(dst)):
                ext = os.path.splitext(name)[1].lower()
                if ext in EXT_JPEG:
                    shutil.copyfile(src, dst)
                else:
                    im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
                    im.save(dst, quality=95)
            with Image.open(dst) as im:
                w, h = ImageOps.exif_transpose(im).size
        except Exception as error:
            errors.append(f'{name} : photo illisible ({type(error).__name__}).')
            continue
        new_registre[key] = {'source': name, 'sha256': digest, 'size': [w, h]}
        if w >= h:
            errors.append(f'{name} : photo en paysage ({w} x {h}) ; prends-la en portrait (debout dans le cadre).')
            continue
        if h < MIN_H:
            errors.append(f'{name} : {h} px de haut, il en faut au moins {MIN_H} '
                          f'(règle l\'appareil sur sa plus grande taille de photo).')
            continue
        if abs(w / h - RATIO) > RATIO_TOL:
            warnings.append(f'{name} : format {w} x {h} ; le format 3:4 (par exemple 3000 x 4000) est celui '
                            f'pour lequel les réglages sont calés.')
        photos.append({'key': key, 'source': name, 'path': dst, 'size': [w, h]})
    # photos retirées du dossier : leur copie part aussi
    for key in registre:
        if key not in new_registre:
            stale = os.path.join(out_dir, key + '.jpeg')
            if os.path.exists(stale): os.remove(stale)
    with open(reg_path, 'w', encoding='utf-8') as f:
        json.dump(new_registre, f, ensure_ascii=False, indent=1)
    return photos, errors, warnings
