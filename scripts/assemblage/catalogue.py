# Tableau des vêtements, catalogue.csv : une ligne par pièce, remplie dans un tableur (Excel,
# LibreOffice, Numbers, Google Sheets). Il est créé avec une ligne par photo ; une deuxième pièce sur
# la même photo (le haut ET le bas de la tenue de départ) = une ligne copiée avec un autre id.
# Les fiches sont relues avec les MÊMES règles que l'appli (lib/import/assemblage.ts, readItemFields) :
# une erreur dit la ligne et la colonne, avant le moindre calcul.
import csv, io, os, re, unicodedata

NOM = 'catalogue.csv'
COLONNES = ['photo', 'id', 'nom', 'categorie', 'couleur', 'chaleur', 'styles', 'pluie', 'rentre']
OBLIGATOIRES = ['photo', 'id', 'nom', 'categorie']
DEFAUTS = {'couleur': '', 'chaleur': '2', 'styles': 'decontracte', 'pluie': 'non', 'rentre': 'non'}

# mêmes listes et bornes que lib/types.ts et lib/import/assemblage.ts
CATEGORIES = ['haut', 'bas', 'robe', 'veste', 'chaussures', 'accessoire']
STYLES = ['decontracte', 'habille', 'sport']
KEY_PATTERN = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
COLOR_PATTERN = re.compile(r'^#[0-9A-Fa-f]{6}$')
NAME_MAX = 80
MAX_ITEMS = 300

ALIAS_CATEGORIES = {'hauts': 'haut', 'robes': 'robe', 'vestes': 'veste', 'chaussure': 'chaussures',
                    'accessoires': 'accessoire'}
CHALEURS = {'1': 1, '2': 2, '3': 3, 'leger': 1, 'moyen': 2, 'chaud': 3}
OUI = {'oui', 'o', 'x', '1', 'vrai', 'true', 'yes', 'y'}
NON = {'non', 'n', '', '0', 'faux', 'false', 'no'}


class CatalogueError(Exception):
    """Le tableau ne peut pas être relu (fichier ouvert ailleurs, colonnes absentes…)."""


def simple(text):
    """Minuscules sans accents ni espaces autour : « Décontracté » -> « decontracte »."""
    text = unicodedata.normalize('NFKD', str(text)).encode('ascii', 'ignore').decode('ascii')
    return text.strip().lower()


def _read_text(path):
    raw = open(path, 'rb').read()
    for encoding in ('utf-8-sig', 'cp1252'):
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise CatalogueError(f'{NOM} : encodage illisible (enregistre-le en « CSV UTF-8 »).')


def _dialect(text):
    head = text.split('\n', 1)[0]
    counts = {sep: head.count(sep) for sep in (';', ',', '\t')}
    return max(counts, key=counts.get)


def lire(path, obligatoires=OBLIGATOIRES):
    """Lignes du tableau : [(numéro de ligne du tableur, {colonne: texte})], plus l'encodage et le
    séparateur (pour y ajouter des lignes dans le même format)."""
    try:
        text, encoding = _read_text(path)
    except PermissionError as error:
        raise CatalogueError(f'{NOM} est ouvert dans un autre programme : ferme-le puis relance.') from error
    sep = _dialect(text)
    reader = csv.reader(io.StringIO(text), delimiter=sep)
    rows = []
    header = None
    for cells in reader:
        if header is None:
            header = [simple(c).replace(' ', '') for c in cells]
            missing = [c for c in obligatoires if c not in header]
            if missing:
                raise CatalogueError(f'{NOM}, ligne 1 : colonne(s) absente(s) : {", ".join(missing)} '
                                     f'(la première ligne donne le nom des colonnes).')
            continue
        if not any(c.strip() for c in cells): continue
        row = {name: (cells[i].strip() if i < len(cells) else '') for i, name in enumerate(header) if name}
        rows.append((reader.line_num, row))
    if header is None:
        raise CatalogueError(f'{NOM} est vide : supprime-le, il sera recréé.')
    return rows, encoding, sep


def _line(values, sep):
    out = io.StringIO()
    csv.writer(out, delimiter=sep, lineterminator='\r\n').writerow(values)
    return out.getvalue()


def _new_row(photo):
    return [photo['source'], photo['key'], '', ''] + [DEFAUTS[c] for c in COLONNES[4:]]


def creer(path, photos):
    """Crée le tableau : une ligne par photo, id = clé de la photo (stable d'un import à l'autre).
    Point-virgule et UTF-8 avec BOM : Excel en français l'ouvre tel quel par double-clic."""
    text = _line(COLONNES, ';') + ''.join(_line(_new_row(p), ';') for p in photos)
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        f.write(text)


def ajouter(path, photos, rows, encoding, sep):
    """Ajoute en fin de tableau une ligne vide pour chaque photo qu'aucune ligne ne cite. Renvoie les
    photos ajoutées."""
    cited = {simple(r.get('photo', '')) for _, r in rows}
    new = [p for p in photos if simple(p['source']) not in cited and simple(p['key']) not in cited]
    if not new: return []
    raw = open(path, 'rb').read()
    tail = '' if raw.endswith(b'\n') or not raw else '\r\n'
    try:
        with open(path, 'a', encoding='utf-8' if encoding == 'utf-8-sig' else encoding, errors='replace', newline='') as f:
            f.write(tail + ''.join(_line(_new_row(p), sep) for p in new))
    except PermissionError as error:
        raise CatalogueError(f'{NOM} est ouvert dans un autre programme : ferme-le puis relance.') from error
    return new


def _bool(value):
    v = simple(value)
    if v in OUI: return True
    if v in NON: return False
    return None


def valider(rows, photos):
    """Relit les lignes. Renvoie (pièces, photos rentrées, erreurs, avertissements). Une pièce :
    {id, name, category, color ('auto' ou #RRGGBB ou None), warmth, styles, rain_ok, photo (clé), ligne}.
    Mêmes règles que readItemFields de lib/import/assemblage.ts ; les erreurs sont toutes listées."""
    by_name = {}
    for p in photos:
        by_name[simple(p['source'])] = p['key']
        by_name.setdefault(simple(p['key']), p['key'])
    items, errors, warnings = [], [], []
    ids, tucked_by = {}, {}
    for line, r in rows:
        def err(col, message):
            errors.append(f'{NOM}, ligne {line}, colonne « {col} » : {message}')
        name = re.sub(r'\s+', ' ', r.get('nom', '')).strip()
        cat = simple(r.get('categorie', ''))
        if not name and not cat:
            warnings.append(f'{NOM}, ligne {line} : nom et catégorie vides, photo « {r.get("photo", "")} » non utilisée.')
            continue
        key = by_name.get(simple(r.get('photo', '')))
        if key is None:
            err('photo', f'« {r.get("photo", "")} » ne correspond à aucune photo du dossier.')
        item_id = r.get('id', '')
        if not KEY_PATTERN.match(item_id):
            err('id', f'« {item_id} » refusé (lettres sans accent, chiffres, _ et -, 64 au plus, sans espace).')
        elif item_id in ids:
            err('id', f'« {item_id} » est déjà l\'id de la ligne {ids[item_id]} : chaque pièce a son id '
                      f'(par exemple {item_id}-bas pour la deuxième pièce d\'une photo).')
        else:
            ids[item_id] = line
        if not name:
            err('nom', 'vide.')
        elif len(name) > NAME_MAX:
            err('nom', f'{len(name)} caractères, {NAME_MAX} au plus.')
        cat = ALIAS_CATEGORIES.get(cat, cat)
        if cat not in CATEGORIES:
            err('categorie', f'« {r.get("categorie", "")} » inconnue ({", ".join(CATEGORIES)}).')
        raw_color = r.get('couleur', '').strip()
        color = 'auto'
        if raw_color and simple(raw_color) != 'auto':
            c = raw_color if raw_color.startswith('#') else '#' + raw_color
            if simple(raw_color) == 'aucune': color = None
            elif COLOR_PATTERN.match(c): color = c.upper()
            else: err('couleur', f'« {raw_color} » : #RRGGBB attendu (par exemple #1F2A44), ou vide pour la couleur calculée.')
        warmth = CHALEURS.get(simple(r.get('chaleur', DEFAUTS['chaleur'])) or DEFAUTS['chaleur'])
        if warmth is None:
            err('chaleur', f'« {r.get("chaleur", "")} » : 1, 2 ou 3 attendu (léger, moyen, chaud).')
        styles = []
        raw_styles = r.get('styles', DEFAUTS['styles']) or DEFAUTS['styles']
        for part in re.split(r'[+,;/\s]+', simple(raw_styles)):
            if not part: continue
            if part not in STYLES:
                err('styles', f'« {part} » inconnu ({", ".join(STYLES)}, plusieurs reliés par +).')
            elif part not in styles:
                styles.append(part)
        rain = _bool(r.get('pluie', ''))
        if rain is None:
            err('pluie', f'« {r.get("pluie", "")} » : oui ou non attendu.')
        tucked = _bool(r.get('rentre', ''))
        if tucked is None:
            err('rentre', f'« {r.get("rentre", "")} » : oui ou non attendu.')
        if key is not None and tucked is not None:
            if key in tucked_by and tucked_by[key][0] != tucked:
                err('rentre', f'« {r.get("rentre", "")} » alors que la ligne {tucked_by[key][1]} dit l\'inverse pour '
                              f'la même photo (oui si le haut est rentré dans le bas SUR CETTE PHOTO).')
            tucked_by.setdefault(key, (tucked, line))
        items.append({'id': item_id, 'name': name, 'category': cat, 'color': color, 'warmth': warmth,
                      'styles': styles, 'rain_ok': rain, 'photo': key, 'ligne': line})
    if not items and not errors:
        errors.append(f'{NOM} : aucune pièce remplie (au moins un nom et une catégorie).')
    if len(items) > MAX_ITEMS:
        errors.append(f'{NOM} : {len(items)} pièces, {MAX_ITEMS} au plus par paquet.')
    tucked = {k for k, (v, _) in tucked_by.items() if v}
    return items, tucked, errors, warnings
