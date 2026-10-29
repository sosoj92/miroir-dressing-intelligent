# Incrustation (chroma key) : fond vert -> transparent, débordement de vert neutralisé.
# Les seuils sont réglés pour un fond vert uni bien éclairé ; un vêtement vert devient transparent.
# Pour essayer son fond avant de tout photographier : fabriquer.py <dossier> --fond.
import numpy as np, cv2
from PIL import Image, ImageOps

MAX_H = 1600   # hauteur de travail : la photo est réduite à 1600 px, jamais agrandie

def load(path, max_h=MAX_H):
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    if im.height > max_h:
        im = im.resize((round(im.width * max_h / im.height), max_h), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0

# Vêtements sombres : le reflet vert du sol donne à des pixels sombres du tissu (sous le genou
# surtout) la « verdeur » du fond ; ils devenaient transparents en semis. Dans la silhouette, loin
# de son bord, un pixel sombre pris dans un semis de trous est rendu opaque.
DARK_LO, DARK_HI = 0.10, 0.16  # luminosité max(r, g, b) : opaque en dessous, inchangé au-dessus
SPECKLE = 11  # trou entouré de sujet plus étroit que ça : du tissu (un écart entre les jambes est plus large)
EDGE = 9      # bande du bord de la silhouette laissée telle quelle (érosion du masque rempli)

# Sol en bas du cadre (bandeau sombre, meuble devant l'écran vert) : il touche les pieds, donc reste
# dans la silhouette. Les dernières lignes nettement plus couvertes que les jambes juste au-dessus
# sont retirées, si elles forment un bandeau large (trait de sol : quelques lignes ; meuble bas
# devant le fond : une cinquantaine de lignes sur toute la largeur).
FLOOR_LEGS = (120, 90)   # lignes de référence des jambes, comptées depuis le bas
FLOOR_EXTRA = 0.08       # part de la largeur au-delà des jambes qui signale le sol
FLOOR_WIDE = 0.5         # le bandeau retiré doit couvrir au moins cette part de la largeur
FLOOR_MARGIN = 2         # lignes retirées en plus, au-dessus du bandeau (bord flou)

def cut_floor(filled):
    h = filled.shape[0]
    cover = filled.mean(axis=1)
    legs = float(np.median(cover[h - FLOOR_LEGS[0]:h - FLOOR_LEGS[1]]))
    y = h
    while y > 0 and cover[y - 1] > legs + FLOOR_EXTRA: y -= 1
    if y == h or cover[y:].max() < FLOOR_WIDE: return filled
    out = filled.copy()
    out[max(0, y - FLOOR_MARGIN):] = 0
    return out

def key(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # « verdeur » relative : part du vert qui dépasse le rouge et le bleu, indépendante de la
    # luminosité (les ombres sur le fond restent vertes, seulement plus sombres)
    greenness = (g - np.maximum(r, b)) / (g + 1e-3)
    lo, hi = 0.14, 0.30
    alpha = 1.0 - np.clip((greenness - lo) / (hi - lo), 0, 1)
    # pixels presque noirs : chromaticité bruitée, on les garde (vêtements noirs)
    alpha = np.where(g < 0.035, 1.0, alpha)
    raw = (alpha > 0.5).astype(np.uint8)
    # ne garder que le sujet : plus grande composante connexe au centre (enlève le bandeau du haut),
    # cherchée après avoir refermé les semis de trous (sinon le bas d'une jambe sombre s'en détache)
    solid = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(solid, connectivity=8)
    h, w = solid.shape
    cx = w // 2
    best, best_area = 0, 0
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if x <= cx <= x + bw and area > best_area and y > h * 0.02:
            best, best_area = i, area
    keep = (labels == best).astype(np.uint8)
    keep = cv2.dilate(keep, np.ones((5, 5), np.uint8))
    # sol retiré avant le remplissage : sinon il ferme l'écart entre les jambes, rempli comme un trou
    keep = cut_floor(keep)
    # silhouette remplie (contour extérieur) : tout ce qui est hors du sujet devient transparent
    filled = keep.copy()
    cnts, _ = cv2.findContours(keep, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(filled, cnts, -1, 1, thickness=cv2.FILLED)
    # semis de trous du tissu sombre : un fond, même dans l'ombre, reste plus clair que DARK_HI
    speckled = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, np.ones((SPECKLE, SPECKLE), np.uint8)) > 0
    inner = cv2.erode(filled, np.ones((EDGE, EDGE), np.uint8)) > 0
    dark = 1.0 - np.clip((rgb.max(axis=2) - DARK_LO) / (DARK_HI - DARK_LO), 0, 1)
    alpha = np.where(inner & speckled, np.maximum(alpha, dark), alpha)
    alpha = alpha * filled
    # supprime le débordement de vert sur les bords
    spill = np.clip(g - np.maximum(r, b), 0, None)
    out = rgb.copy()
    out[..., 1] = g - spill
    return out, alpha

def on_black(rgb, alpha):
    return np.clip(rgb * alpha[..., None], 0, 1)
