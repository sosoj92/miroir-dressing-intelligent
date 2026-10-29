# Mesures d'une photo portée, tirées de sa silhouette (chroma.key) et des classes FASHN (bras.seg_of) :
#   - lignes du manifeste, en px sous les yeux : topLow (point le plus bas des vêtements du haut, sans
#     les manches ni les tirettes) et bottomHigh (point le plus haut du bord supérieur du bas, null s'il
#     est caché) ; elles remplacent la lecture à la main sur des vignettes graduées ;
#   - centres robustes du buste (milieu de la silhouette complète) ;
#   - couleur d'un vêtement, proposée d'après les pixels de sa classe.
# Toutes les distances horizontales sont en écarts entre les yeux (eye_dist) : elles suivent l'échelle
# de la photo. Réglages validés sur un jeu de photos réel contre les lignes lues à la main : écart
# médian 2 à 3 px ; les cas limites (coin d'ourlet collé à une manche, ceinture cachée par une veste
# longue ouverte) se corrigent dans corrections.csv.
import numpy as np, cv2

TOP, DRESS, SKIRT, PANTS, BELT = 3, 4, 5, 6, 7
BAG, HAT, SCARF, GLASSES = 8, 9, 10, 11
ARM, HAND, FEET, TORSO, JEWEL = 12, 13, 15, 16, 17

ZONE = 860          # zone mesurée sous les yeux : un haut plus long a topLow null (coupe à 866)
FROM = 100          # les lignes sont cherchées à partir de 100 px sous les yeux (sous le menton)
BAND = 3.2          # demi-largeur de la zone du corps, en écarts entre les yeux (bras compris)
CORE = 0.75         # demi-largeur du milieu du buste, où il n'y a jamais de manche
CORE_FILL = 0.5     # part du milieu du buste couverte par le haut à son ourlet
BELOW = 6           # px regardés sous un bout de manche (main ou bras) et au-dessus du bas (peau)
TOP_WIDTH = 0.3     # largeur minimale du haut sur sa dernière ligne (écarts entre les yeux) : sans
                    # les tirettes ni les cordons qui pendent
BOTTOM_WIDTH = 0.2  # largeur minimale du bas sur sa première ligne
VISIBLE = 8         # colonnes où la peau touche le haut du bas : en dessous, la ceinture est cachée
CENTER_ROWS = range(380, 801, 10)   # centres du buste, en px sous les yeux


def lines(lb, a, eye, eye_dist, tucked):
    """lb : classes FASHN relabellisées dans le sujet (bras.relabel) ; a : alpha du détourage ;
    eye : milieu des yeux [x, y] ; tucked : haut rentré dans le bas. Renvoie (topLow, bottomHigh), en
    px entiers sous les yeux ou None."""
    H, W = lb.shape
    ex, ey = float(eye[0]), float(eye[1])
    d = float(eye_dist)
    inside = a > 0.5
    up = np.isin(lb, (TOP, DRESS)) & inside
    up = cv2.morphologyEx(up.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
    bottom = np.isin(lb, (SKIRT, PANTS, BELT)) & inside
    limb = np.isin(lb, (ARM, HAND))
    cols = np.arange(W)
    band = np.abs(cols - ex) <= BAND * d
    core = np.abs(cols - ex) <= CORE * d
    y_from = min(H - 1, max(0, int(ey + FROM)))

    top_low = None
    if up[y_from:].any():
        # ourlet au milieu du buste : dernière ligne où le haut couvre la moitié du milieu
        fill = up[:, core].sum(1)
        rows = np.where(fill[y_from:] >= CORE_FILL * core.sum())[0]
        hem = y_from + int(rows[-1]) if len(rows) else y_from
        # manches : morceaux du haut sous cet ourlet qui finissent sur une main ou un bras
        low = up.copy()
        low[:hem] = False
        _, cc = cv2.connectedComponents(low.astype(np.uint8), connectivity=8)
        under = np.zeros_like(limb)
        for s in range(1, BELOW + 1):
            under[:-s] |= limb[s:]
        sleeves = np.unique(cc[(cc > 0) & under])
        keep = up & ~np.isin(cc, sleeves) & band[None, :]
        rows = np.where(keep.sum(1)[y_from:] >= TOP_WIDTH * d)[0]
        if len(rows):
            top_low = int(round(y_from + int(rows[-1]) - ey))
            if top_low > ZONE: top_low = None

    bottom_high = None
    widths = (bottom & band[None, :]).sum(1)
    rows = np.where(widths[y_from:] >= BOTTOM_WIDTH * d)[0]
    if len(rows):
        bottom_high = int(round(y_from + int(rows[0]) - ey))
        if not tucked:
            # bord du bas visible : de la peau (ou une ceinture) juste au-dessus, sur assez de colonnes ;
            # sinon un haut long ou une veste le couvre, et la ligne est inconnue (null)
            visible = 0
            for x in np.where(band)[0]:
                ys = np.where(bottom[y_from:, x])[0]
                if not len(ys): continue
                yh = y_from + int(ys[0])
                if (lb[max(0, yh - BELOW):yh, x] == TORSO).any() or lb[yh, x] == BELT: visible += 1
            if visible < VISIBLE: bottom_high = None
    return top_low, bottom_high


def robust_centers(mask, eye, rows=CENTER_ROWS, window=30):
    """Milieu de la silhouette complète (bras compris, symétriques), médiane sur ±15 lignes, toutes
    les 10 lignes : [[px sous les yeux, x], ...] (champ centers du manifeste)."""
    ex, ey = eye
    out = []
    for rel in rows:
        mids = []
        for r2 in range(rel - window // 2, rel + window // 2 + 1, 5):
            y = int(round(ey + r2))
            if not (0 <= y < mask.shape[0]): continue
            xs = np.where(mask[y])[0]
            if len(xs): mids.append((xs[0] + xs[-1]) / 2)
        if mids:
            out.append([rel, round(float(np.median(mids)), 1)])
    return out


# classes d'un vêtement selon sa catégorie (la première trouvée sert ; l'accessoire prend la plus grande)
COLOR_CLASSES = {
    'haut': [(TOP,)], 'veste': [(TOP,)], 'robe': [(DRESS,), (TOP,)], 'bas': [(PANTS, SKIRT)],
    'chaussures': [(FEET,)], 'accessoire': [(BAG,), (HAT,), (SCARF,), (GLASSES,), (JEWEL,)],
}
COLOR_MIN = 200     # pixels sûrs nécessaires pour proposer une couleur


def color(rgb, a, lb, category):
    """Couleur médiane (#RRGGBB) des pixels sûrs du vêtement (loin des bords), ou None."""
    best = None
    for classes in COLOR_CLASSES.get(category, []):
        m = (np.isin(lb, classes) & (a > 0.9)).astype(np.uint8)
        m = cv2.erode(m, np.ones((7, 7), np.uint8)) > 0
        n = int(m.sum())
        if n >= COLOR_MIN and (best is None or (category == 'accessoire' and n > best[0])):
            best = (n, m)
            if category != 'accessoire': break
    if best is None:
        return None
    px = np.median(rgb[best[1]], axis=0)
    return '#' + ''.join(f'{int(round(float(v) * 255)):02X}' for v in np.clip(px, 0, 1))
