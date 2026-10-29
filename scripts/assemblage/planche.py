# Planches à regarder avant d'importer (dossier controle/ du dossier de travail) :
#   photos-<n>.jpg   vignettes des photos avec leur nom de fichier, pour remplir catalogue.csv ;
#   tenues-<n>.jpg   chaque haut et chaque veste sur un bas de référence, chaque bas sous un haut de
#                    référence, chaque robe seule : RENDU DU MIROIR (bras_plan.draw_plan exécuté par
#                    canvas_np, sur fond noir), à partir des seuls fichiers du paquet ;
#   regles/<clé>.png vignettes graduées (px sous les yeux) avec les lignes retenues (--regles).
import os, sys, unicodedata
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bras_plan, canvas_np
from chroma import load, key

TILE_W, TILE_H = 240, 411       # vignette d'une tenue (scène 800 x 1370 réduite)
COLS, ROWS = 8, 3               # vignettes par planche
UPPER = ('haut', 'veste')


FONTS = ['arial.ttf', 'segoeui.ttf', 'DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf',
         '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
_fonts = {}

def _font(size=14):
    """Police du système avec les accents ; sinon celle de Pillow, et les accents sont retirés (_text)."""
    if size not in _fonts:
        for name in FONTS:
            try:
                _fonts[size] = (ImageFont.truetype(name, size), True); break
            except OSError:
                continue
        else:
            _fonts[size] = (ImageFont.load_default(size=size), False)
    return _fonts[size]

def _text(text, accents):
    return text if accents else unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii')


def _sheets(tiles, out_dir, prefix, tile_w, tile_h):
    """Range les vignettes [(image, légende)] en planches de COLS x ROWS ; renvoie leurs chemins."""
    os.makedirs(out_dir, exist_ok=True)
    for old in os.listdir(out_dir):
        if old.startswith(prefix + '-') and old.endswith('.jpg'): os.remove(os.path.join(out_dir, old))
    per = COLS * ROWS
    font, accents = _font()
    paths = []
    for s in range(0, len(tiles), per):
        chunk = tiles[s:s + per]
        rows = (len(chunk) + COLS - 1) // COLS
        sheet = Image.new('RGB', (min(COLS, len(chunk)) * tile_w, rows * (tile_h + 40)), (24, 24, 24))
        d = ImageDraw.Draw(sheet)
        for i, (im, caption) in enumerate(chunk):
            x, y = (i % COLS) * tile_w, (i // COLS) * (tile_h + 40)
            sheet.paste(im, (x + (tile_w - im.width) // 2, y))
            for j, text in enumerate(caption[:2]):
                d.text((x + 6, y + tile_h + 4 + 17 * j), _text(text[:30], accents), fill=(235, 235, 235), font=font)
        path = os.path.join(out_dir, f'{prefix}-{s // per + 1}.jpg')
        sheet.save(path, quality=85)
        paths.append(path)
    return paths


def photos(entries, out_dir):
    """entries : [(chemin de la photo préparée, légende 1, légende 2)]."""
    tiles = []
    for path, a, b in entries:
        im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
        im.thumbnail((TILE_W, TILE_H))
        tiles.append((im, [a, b]))
    return _sheets(tiles, out_dir, 'photos', TILE_W, TILE_H)


def _stage(man, paquet, ka, kb=None, item_sleeves=None):
    """Tenue telle que la dessine le miroir (RGB sur noir, 800 x 1370) et son mode de rendu."""
    A = man['photos'][ka]
    if kb is None:   # robe seule : photo détourée, yeux à leur place sur la scène
        plan = {'width': bras_plan.STAGE_W, 'height': bras_plan.STAGE_H, 'canvases': ['main'], 'ops': []}
        W, H = A['size']
        ox = bras_plan.js_round(bras_plan.STAGE_EYE[0] - A['eye'][0])
        oy = bras_plan.js_round(bras_plan.STAGE_EYE[1] - A['eye'][1])
        plan['ops'].append({'op': 'draw', 'dst': 'main', 'src': 'A.cutout', 's': [0, 0, W, H], 'd': [ox, oy, W, H]})
        images = {'A.cutout': canvas_np.load_image(os.path.join(paquet, A['cutout']))}
        return canvas_np.to_rgb_on(canvas_np.run(plan, images), (0, 0, 0)), 'seule'
    B = man['photos'][kb]
    plan = bras_plan.draw_plan(A, B, ka, kb, man['margin'], man['feather'], item_sleeves=item_sleeves)
    images = {}
    for role, info in plan['images'].items():
        path = info.get('path') or (A if role.startswith('A.') else B)['cutout']
        images[role] = canvas_np.load_image(os.path.join(paquet, path))
    mode = 'bras pliés' if plan['mode'] == 'plies' else f'rendu simple ({plan["reason"]})'
    return canvas_np.to_rgb_on(canvas_np.run(plan, images), (0, 0, 0)), mode


def _reference(items, photos_, category, field):
    """Pièce de référence d'une catégorie : photo à bras pliés, ligne médiane (ni extrême ni longue)."""
    cand = [it for it in items if it['category'] == category and photos_[it['photo']].get('arms')
            and photos_[it['photo']][field] is not None and photos_[it['photo']][field] < bras_plan.LONG_ARMS]
    if not cand:
        cand = [it for it in items if it['category'] == category]
    if not cand: return None
    cand.sort(key=lambda it: photos_[it['photo']][field] if photos_[it['photo']][field] is not None else 9999)
    return cand[len(cand) // 2]


def tenues(man, paquet, out_dir, log=print):
    """Planches de contrôle des tenues ; renvoie leurs chemins."""
    items, P = man['items'], man['photos']
    ref_bottom = _reference(items, P, 'bas', 'bottomHigh')
    ref_top = _reference([it for it in items if not P[it['photo']]['tucked']], P, 'haut', 'topLow') \
        or _reference(items, P, 'veste', 'topLow')
    pairs = []   # (haut, bas, pièce contrôlée) ; bas None : robe seule
    for it in items:
        if it['category'] in UPPER and ref_bottom:
            pairs.append((it, ref_bottom, it))
        elif it['category'] == 'bas' and ref_top:
            pairs.append((ref_top, it, it))
        elif it['category'] == 'robe':
            pairs.append((it, None, it))
        elif it['category'] in UPPER + ('bas',):
            log(f'  planche : {it["legacy_id"]} non dessinée (aucune pièce de l\'autre moitié pour l\'accompagner)')
    tiles = []
    for upper, lower, subject in pairs:
        other = lower if subject is upper else upper
        try:
            rgb, mode = _stage(man, paquet, upper['photo'], lower['photo'] if lower else None,
                               upper['sleeves'] if lower else None)
        except Exception as error:   # une tenue impossible à dessiner ne bloque pas le paquet
            log(f'  planche : {subject["legacy_id"]} non dessinée ({type(error).__name__} : {error})')
            continue
        im = Image.fromarray(rgb).resize((TILE_W, TILE_H), Image.LANCZOS)
        with_ = f' avec {other["legacy_id"]}' if other else ''
        tiles.append((im, [f'{subject["legacy_id"]} {subject["name"]}', f'{mode}{with_}']))
    return _sheets(tiles, out_dir, 'tenues', TILE_W, TILE_H)


Y0, Y1 = 280, 860   # zone graduée, en px sous les yeux

def regles(path, eye, lines, title, out_path):
    """Vignette graduée d'une photo avec ses lignes : topLow en orange, bottomHigh en bleu."""
    fg, a = key(load(path))
    ex, ey = eye
    rgb = (fg * a[..., None] * 255).astype(np.uint8)
    x0, y0 = int(ex - 260), int(ey + Y0)
    crop = Image.fromarray(rgb).crop((x0, y0, x0 + 520, y0 + (Y1 - Y0))).convert('RGBA')
    over = Image.new('RGBA', crop.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    font, accents = _font(12)
    for rel in range(Y0, Y1, 10):
        y = rel - Y0
        major = rel % 50 == 0
        for x in (0, 520):
            d.line([(x, y), (x + (34 if major else 14) * (1 if x == 0 else -1), y)], fill=(255, 230, 0, 255), width=2 if major else 1)
        if major:
            d.line([(36, y), (484, y)], fill=(255, 230, 0, 70), width=1)
            d.text((38, y - 13), str(rel), fill=(255, 230, 0, 255), font=font)
            d.text((452, y - 13), str(rel), fill=(255, 230, 0, 255), font=font)
    for value, colour, name in ((lines[0], (255, 120, 0, 255), 'top_low'), (lines[1], (0, 190, 255, 255), 'bottom_high')):
        if value is None or not Y0 <= value < Y1: continue
        y = value - Y0
        d.line([(40, y), (480, y)], fill=colour, width=2)
        d.text((60 if name == 'top_low' else 300, y + 2), f'{name} {value}', fill=colour, font=font)
    crop = Image.alpha_composite(crop, over).convert('RGB')
    ImageDraw.Draw(crop).text((170, 4), _text(title, accents), fill=(255, 255, 255), font=font)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    crop.save(out_path)
