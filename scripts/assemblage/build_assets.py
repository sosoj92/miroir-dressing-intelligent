# Contenu du paquet d'import « assemblage » de Mon Dressing, à partir des photos préparées :
#   photos/<clé>.jpg     photo d'origine réduite (1600 px de haut)
#   photos/<clé>.webp    photo détourée (fond transparent)
#   manches/<id>.webp    manches d'un haut ou d'une veste sous son ourlet (rendu sans bras pliés)
#   bras/<clé>.webp, corps/<clé>.webp, manches-photo/<clé>.webp
#                        couches des « bras pliés » (bras.py), pour chaque photo d'un haut, d'une
#                        veste ou d'un bas ; leurs données vont dans photos[<clé>].arms
#   manifest.json        fiches + repères d'alignement (format : README)
# Une photo à la fois : détourage, UN passage du parseur FASHN (en cache), lignes et centres, bras
# pliés, puis les pièces de cette photo (manches, couleur proposée). Appelé par fabriquer.py.
import json, os, sys, time
import numpy as np, cv2
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chroma import load, key
import bras, mesures

FORMAT, VERSION = 'mon-dressing/assemblage', 1
MARGIN = 6          # marge sous l'ourlet (px) : la coupe passe MARGIN px sous la ligne la plus basse
FEATHER = 10        # fondu à la coupe (px)
LONG_TOP = 680      # coupe à partir de laquelle un haut couvre les mains : pas d'image de manches
ASSEMBLED = ('haut', 'veste', 'bas')   # catégories dont la photo reçoit les couches des bras pliés


def save_webp(rgb, alpha, path, quality=88):
    im = np.dstack([(np.clip(rgb, 0, 1) * 255).astype(np.uint8), (np.clip(alpha, 0, 1) * 255).astype(np.uint8)])
    Image.fromarray(im, 'RGBA').save(path, 'WEBP', quality=quality, method=6)


def item_sleeves(seg, a, top_low, eye):
    """Manches d'un haut ou d'une veste (carte FASHN de la photo) : sous l'ourlet, les pixels classés
    « haut » sont exactement les manches. None si bras nus."""
    rows = np.arange(a.shape[0])[:, None]
    sleeve = (seg == bras.TOP) & (rows > eye[1] + top_low) & (a > 0.5)
    sleeve = cv2.morphologyEx(sleeve.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    if sleeve.sum() < 800: return None
    layer = np.clip(a * cv2.GaussianBlur(sleeve.astype(np.float32), (5, 5), 0), 0, 1)
    return layer if layer.max() > 0.5 else None


def construire(pieces, photos, reperes, rentrees, corrections, travail, sortie, log=print):
    """pieces : fiches validées (catalogue.valider, couleur 'auto', #RRGGBB ou None) ; photos : clé ->
    photo préparée ; reperes : clé -> {eye_mid, eye_dist} ; rentrees : clés des photos dont le haut est
    rentré ; corrections : clé -> {'top_low'?, 'bottom_high'?} (valeur ou None ; champ absent =
    ligne automatique). Écrit le paquet dans `sortie` (dossier vide) ; renvoie (manifeste, rapport)."""
    os.makedirs(os.path.join(sortie, 'photos'), exist_ok=True)
    used = sorted({it['photo'] for it in pieces})
    assembled = {it['photo'] for it in pieces if it['category'] in ASSEMBLED}
    cache = os.path.join(travail, 'fashn')
    out_photos, report, done = {}, {}, {}
    for n, k in enumerate(used, 1):
        t0 = time.time()
        rgb = load(photos[k])
        fg, a = key(rgb)
        Image.fromarray((rgb * 255).astype(np.uint8)).save(os.path.join(sortie, 'photos', k + '.jpg'), quality=85)
        save_webp(fg, a, os.path.join(sortie, 'photos', k + '.webp'))
        rep = reperes[k]
        eye = [round(rep['eye_mid'][0], 1), round(rep['eye_mid'][1], 1)]
        seg = bras.seg_of(photos[k], rgb, cache)
        lb = bras.relabel(seg, a > 0.01)
        tucked = k in rentrees
        auto_top, auto_bottom = mesures.lines(lb, a, rep['eye_mid'], rep['eye_dist'], tucked)
        fix = corrections.get(k, {})
        top_low = fix['top_low'] if 'top_low' in fix else auto_top
        bottom_high = fix['bottom_high'] if 'bottom_high' in fix else auto_bottom
        on_photo = [it for it in pieces if it['photo'] == k]
        p = {
            'original': f'photos/{k}.jpg', 'cutout': f'photos/{k}.webp',
            'size': [int(a.shape[1]), int(a.shape[0])],
            'eye': eye, 'eyeDist': round(rep['eye_dist'], 1),
            'centers': mesures.robust_centers(a > 0.5, eye),
            'topLow': top_low, 'bottomHigh': bottom_high,
            'onePiece': any(it['category'] == 'robe' for it in on_photo), 'tucked': tucked,
        }
        if k in assembled:
            # repère : l'œil tel qu'écrit ci-dessus (le seul que connaît le navigateur)
            ph = bras.ArmPhoto(fg, a, rgb, p['eye'], p['topLow'], p['tucked'], seg, MARGIN, FEATHER)
            p['arms'] = bras.write_photo_arms(ph, k, sortie)
            del ph
        out_photos[k] = p
        for it in on_photo:
            sleeves = None
            if it['category'] in ('haut', 'veste') and top_low is not None and top_low < LONG_TOP:
                layer = item_sleeves(seg, a, top_low + MARGIN, rep['eye_mid'])
                if layer is not None:
                    sleeves = f"manches/{it['id']}.webp"
                    os.makedirs(os.path.join(sortie, 'manches'), exist_ok=True)
                    save_webp(fg, layer, os.path.join(sortie, sleeves))
            color = mesures.color(rgb, a, lb, it['category']) if it['color'] == 'auto' else it['color']
            done[it['id']] = {
                'legacy_id': it['id'], 'name': it['name'], 'category': it['category'], 'color': color,
                'warmth': it['warmth'], 'styles': it['styles'], 'rain_ok': it['rain_ok'],
                'photo': k, 'sleeves': sleeves,
            }
        feet = np.where((a > 0.5).any(1))[0]
        report[k] = {'top_low_auto': auto_top, 'bottom_high_auto': auto_bottom, 'top_low': top_low,
                     'bottom_high': bottom_high, 'corrige': sorted(fix), 'bras': 'arms' in p,
                     'sous_les_yeux': int(feet[-1] - rep['eye_mid'][1]) if len(feet) else 0,
                     'pieds_coupes': bool(len(feet) and feet[-1] >= a.shape[0] - 2 and (a[-2:] > 0.5).sum() > 4 * rep['eye_dist']),
                     'secondes': round(time.time() - t0, 1)}
        lines = f'lignes {top_low}/{bottom_high}' + (' (corrigées)' if fix else '')
        log(f'  photo {n}/{len(used)} {k} : {lines}{", bras pliés" if "arms" in p else ""} '
            f'({report[k]["secondes"]} s)')
        del rgb, fg, a, seg, lb
    # version 1 : les champs d'origine ; photos[clé].arms est facultatif (sa propre version arms.v), un
    # paquet qui l'a s'importe tel quel dans une app qui l'ignore
    manifest = {'format': FORMAT, 'version': VERSION, 'margin': MARGIN, 'feather': FEATHER,
                'photos': out_photos, 'items': [done[it['id']] for it in pieces]}
    with open(os.path.join(sortie, 'manifest.json'), 'w', encoding='utf-8') as f:
        # compact : un manifeste de 300 photos reste sous la limite de 5 Mo de l'appli
        json.dump(manifest, f, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    return manifest, report
