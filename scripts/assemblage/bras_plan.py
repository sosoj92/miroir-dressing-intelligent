# Plan de dessin d'une tenue (docs/conception.md §7), calculé À PARTIR DES SEULES DONNÉES DU MANIFESTE, comme le
# fera le navigateur (lib/assembly). C'est la RÉFÉRENCE du code TypeScript : ref_fixture.py en tire
# lib/assembly/fixtures/arms-reference.json, que les tests TypeScript doivent retrouver.
#
# Entrées : deux photos du manifeste (photos[clé] : size, eye, centers, topLow, bottomHigh, tucked et,
# facultatif, arms — voir bras.py et le README). Sortie : le mode de rendu, la géométrie, les images
# utilisées et la liste exacte des opérations canvas 2D (repère de la scène 800 x 1370 de render.ts).
#
# Modes :
#   'actuel'  rendu d'aujourd'hui (render.ts planRender), à l'identique : une des deux photos n'a pas
#             de données de bras ; haut plus long que la zone mesurée (topLow null, coupe 866) ; haut
#             long (coupe ≥ LONG_ARMS, ou poignet du bas au-dessus de la jonction) ; aucun côté n'a de
#             bande ; ou une précondition du rendu « bras pliés » n'est pas tenue ;
#   'plies'   bras pliés (bras nus, ou manches longues quand le haut a des manches sous la coupe).
# Repli « bras du haut » des hauts longs (mode 'haut' : bras complets de la photo du haut posés sur le
# corps sans bras du bas) : simulé sur les tenues de quelques hauts longs d'un jeu de photos réel et
# ÉCARTÉ. Les mains sont bien meilleures qu'avec le rendu simple, mais sur près d'un tiers des tenues le
# corps complété du bas (OVERFILL) apparaît en bloc plat à côté de la cuisse, là où pendait la main du
# bas ; aucun seuil, même mesuré sur les pixels, ne sépare ces tenues des autres. LONG_TOP_MODE le garde
# désactivé ; ops_haut ne sert qu'à refaire la simulation.
#
# Portabilité TypeScript : flottants IEEE, calculs dans le même ordre ; moyenne glissante = somme de
# gauche à droite puis division ; médiane = tri puis milieu (moyenne des deux du milieu si pair) ;
# arrondis : round() de Python (au pair) là où le prototype arrondit = roundHalfEven, int() d'un
# positif = Math.floor, js_round = Math.round. Seul math.cos peut différer de Math.cos d'un ulp :
# tolérance 1e-6 sur les flottants dans les tests.
import math

STAGE_W, STAGE_H = 800, 1370      # scène de render.ts
STAGE_EYE = (400, 150)            # yeux de la photo du haut sur la scène
LONG_SPLIT = 866                  # coupe d'un haut plus long que la zone mesurée (topLow null)
MAX_STRETCH = 3.0
ALIGN_ROW = 500
STRETCH_BOTTOM_INSET = 3
MIN_STRETCH_BAND = 6
MX = 8                            # marge horizontale des bandes (px)
L_MIN, L_MAX = 120, 250           # longueur du pli (jonction -> poignet), bornée
SLEEVE_PROBE = 10                 # lignes de manche sondées sous la coupe (toutes les 5 px) ...
SLEEVE_MIN = 12                   # ... par les deux côtés : au moins 12 sur 20 -> haut à manches longues
CUFF_HAND = 40                    # main figée à partir de 40 px au-dessus du bas de manche
SMOOTH_D, SMOOTH_S = 15, 5        # demi-fenêtres du lissage du décalage / de l'échelle (manches)
LONG_ARMS = 680                   # coupe à partir de laquelle un haut est « long » (mains à la coupe)
LONG_TOP_MODE = 'actuel'          # rendu des hauts longs ('haut' : repli écarté, voir plus haut)

# ---------------------------------------------------------------- coupe et alignement (= plan.ts)
def plan_split(a, b, margin, feather):
    """Ligne de coupe s et bande de ventre (a0, a1) à étirer, ou None (= planSplit de plan.ts)."""
    b_top = b['topLow'] if b['topLow'] is not None else 0
    if a['tucked'] and a['bottomHigh'] is not None:
        return max(a['bottomHigh'], b_top) + margin, None
    if a['topLow'] is None:
        return LONG_SPLIT, None
    if a['bottomHigh'] is None and a['topLow'] > b_top:
        return max(a['topLow'] - 2 * feather, b_top + margin + feather), None
    s = max(a['topLow'], b_top) + margin
    if a['bottomHigh'] is not None and a['topLow'] < a['bottomHigh'] and s > a['bottomHigh']:
        a0, a1 = a['topLow'] + margin, a['bottomHigh'] - STRETCH_BOTTOM_INSET
        if a1 - a0 >= MIN_STRETCH_BAND and (s - a0) / (a1 - a0) <= MAX_STRETCH:
            return s, (a0, a1)
        return min(s, a['bottomHigh']), None
    return s, None

def center_at(p, row):
    """= centerAt de plan.ts (mêmes opérations, même ordre)."""
    c = p['centers']
    if len(c) == 0: return p['eye'][0]
    if row <= c[0][0]: return c[0][1]
    if row >= c[-1][0]: return c[-1][1]
    for i in range(1, len(c)):
        r1, x1 = c[i]
        if row <= r1:
            r0, x0 = c[i - 1]
            return x1 if r1 == r0 else x0 + ((x1 - x0) * (row - r0)) / (r1 - r0)
    return c[-1][1]

def align(a, b, s):
    """= alignLower de plan.ts : (dx, dy), non arrondis."""
    row = min(ALIGN_ROW, s)
    return center_at(a, row) - center_at(b, row), a['eye'][1] - b['eye'][1]

def js_round(x):
    return int(math.floor(x + 0.5))

# ---------------------------------------------------------------- lecture des données de bras
def span_at(d, key, rel):
    """Bords [lo, hi] interpolés entre deux échantillons ; None si pas de bras."""
    i = (rel - d['from']) / d['step']
    i0 = math.floor(i); t = i - i0
    arr = d[key]
    if i0 < 0 or i0 + 1 >= len(arr): return None
    a0, a1 = arr[i0], arr[i0 + 1]
    if a0 is None and a1 is None: return None
    if a0 is None: return a1
    if a1 is None: return a0
    return [a0[0] * (1 - t) + a1[0] * t, a0[1] * (1 - t) + a1[1] * t]

def median(v):
    s = sorted(v); n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2

def span_med(d, key, rel, k=2):
    vals = [span_at(d, key, rel + j * d['step']) for j in range(-k, k + 1)]
    vals = [v for v in vals if v is not None]
    if not vals: return None
    return [median([v[0] for v in vals]), median([v[1] for v in vals])]

def cosdecay(t):
    t = min(max(t, 0.0), 1.0)
    return 0.5 * (1 + math.cos(math.pi * t))

def mean_seq(v):
    total = 0.0
    for x in v: total += x
    return total / len(v)

def search_left(rows, y):
    """= np.searchsorted(rows, y) (côté gauche) sur une liste croissante."""
    i = 0
    while i < len(rows) and rows[i] < y: i += 1
    return i

# ---------------------------------------------------------------- géométrie des bras pliés (= prototype)
def arm_geometry(A, B, s, band, dx, dy, feather):
    """Port exact de bras_plies.draw_plan : jonction, haut à manches longues, et par côté les bandes
    (y, src_lo, src_hi, dst_lo, dst_hi) en lignes / colonnes de la photo du haut, le décalage figé
    sous la dernière bande (rigid) et la fin du pli (y_end)."""
    FE = feather
    dA, dB = A['arms'], B['arms']
    eya = A['eye'][1]
    ys = int(round(eya + s))
    rel_s = ys - eya
    sl_rows = [span_at(dA, 'sleeve' + sd, rel_s + 5 * j) for sd in 'LR' for j in range(0, SLEEVE_PROBE)]
    sleeved = sum(v is not None for v in sl_rows) >= SLEEVE_MIN
    yj = ys if (sleeved or not band) else int(round(eya + band[0]))
    sides = {}
    for sd in 'LR':
        strips, rigid, y_end = [], 0.0, None
        if sleeved:
            cuff = dA['cuff'][sd]
            if cuff is not None:
                yc = int(round(eya + cuff)); yh = yc - CUFF_HAND      # sous yh : décalage figé (main rigide)
                rows_, D, S, spans = [], [], [], []
                last = None
                for y in range(ys - 2 * FE, yc + 1):
                    rel = y - eya
                    sb = span_at(dB, sd, rel); sa = span_at(dA, 'sleeve' + sd, rel)
                    if sb is None: continue
                    blo, bhi = sb[0] + dx, sb[1] + dx
                    if sa is None: sa = last
                    if sa is None: continue
                    last = sa
                    rows_.append(y); spans.append((blo, bhi))
                    D.append((sa[0] + sa[1]) / 2 - (blo + bhi) / 2)
                    S.append(min(1.0, (sa[1] - sa[0] - 8) / max(1.0, bhi - blo)))
                if rows_:
                    n = len(D)
                    Ds = [mean_seq(D[max(0, i - SMOOTH_D):i + SMOOTH_D + 1]) for i in range(n)]
                    Ss = [min(S[max(0, i - SMOOTH_S):i + SMOOTH_S + 1]) for i in range(n)]
                    ih = search_left(rows_, yh)
                    ih = min(max(ih, 0), n - 1)
                    Dh = Ds[ih]
                    for i, y in enumerate(rows_):
                        if y >= yh:
                            t = min(1.0, (y - yh) / 40.0)
                            d_, s_ = Dh, Ss[ih] * (1 - t) + 1.0 * t
                        else:
                            d_, s_ = Ds[i], Ss[i]
                        blo, bhi = spans[i]
                        c = (blo + bhi) / 2 + d_; w = (bhi - blo) * s_
                        strips.append((int(y), blo, bhi, c - w / 2, c + w / 2))
                    y_end = int(rows_[-1]) + 1
                    rigid = float(Dh)
        else:
            rel_j = yj - eya
            sa = span_med(dA, sd, rel_j)
            sb = span_med(dB, sd, rel_j)
            if sa is not None and sb is not None:
                dlo0, dhi0 = sa[0] - (sb[0] + dx), sa[1] - (sb[1] + dx)
                wr = dB['wrist'][sd]
                Ln = L_MAX if wr is None else float(min(max(eya + wr - yj, L_MIN), L_MAX))
                y_end = int(yj + Ln) + 1
                for y in range(yj - 2 * FE, y_end):
                    sb_ = span_at(dB, sd, y - eya)
                    if sb_ is None: continue
                    f = 1.0 if y <= yj else cosdecay((y - yj) / Ln)
                    blo, bhi = sb_[0] + dx, sb_[1] + dx
                    strips.append((y, blo, bhi, blo + dlo0 * f, bhi + dhi0 * f))
        sides[sd] = {'strips': strips, 'rigid': rigid, 'y_end': y_end}
    return {'ys': ys, 'yj': yj, 'sleeved': sleeved, 'sides': sides}

def wrist_above_junction(A, B, yj):
    """Vrai si le poignet de la photo du bas (d'un côté au moins) est au-dessus de la jonction."""
    eya = A['eye'][1]
    return any(w is not None and eya + w < yj for w in B['arms']['wrist'].values())

# ---------------------------------------------------------------- enregistrement des opérations canvas
class Recorder:
    """Opérations canvas 2D (repère de la scène) : clear, draw (rectangles source s et destination d),
    fade (dégradé vertical d'alpha en destination-in, points en centres de pixels de la scène),
    composite (toile entière, source-over ou lighter)."""

    def __init__(self, ox, oy, images):
        self.ox, self.oy = ox, oy
        self.images = images          # rôle -> {'photo', 'layer', 'box': [x, y, w, h]}
        self.ops = []

    def clear(self, dst):
        self.ops.append({'op': 'clear', 'dst': dst})

    def draw(self, dst, src, s, d, kind=None, side=None):
        op = {'op': 'draw', 'dst': dst, 'src': src, 's': [float(v) for v in s], 'd': [float(v) for v in d]}
        if kind: op['kind'] = kind          # 'strip' (bande d'une ligne) ou 'rest' (reste du bras)
        if side: op['side'] = side
        self.ops.append(op)

    def fade(self, dst, stops):
        """stops : [(ligne de la photo du haut, poids)] -> centres de pixels de la scène."""
        self.ops.append({'op': 'fade', 'dst': dst, 'stops': [[y + self.oy + 0.5, float(w)] for y, w in stops]})

    def fade_abs(self, dst, stops):
        self.ops.append({'op': 'fade', 'dst': dst, 'stops': [[float(y), float(w)] for y, w in stops]})

    def composite(self, dst, src, mode='source-over'):
        self.ops.append({'op': 'composite', 'dst': dst, 'src': src, 'mode': mode})

    def draw_rows(self, dst, key, tx, ty, r0=-1e9, r1=1e9):
        """Lignes [r0, r1[ (repère de sa photo) de l'image, posée à la translation (tx, ty)."""
        x, y, w, h = self.images[key]['box']
        a = max(y, math.floor(r0)); b = min(y + h, math.ceil(r1))
        if b <= a: return
        self.draw(dst, key, [0, a - y, w, b - a], [x + tx + self.ox, a + ty + self.oy, w, b - a])

    def draw_stretched(self, dst, key, eye_y, band, s, r1):
        """Photo du haut (translation nulle), ventre étiré comme stretch_rows : lignes [y0, ys] lues en
        y0 + (y - y0)·r ; au-dessus et au-dessous, inchangées ; seulement les lignes < r1."""
        x, y, w, h = self.images[key]['box']
        if not band:
            return self.draw_rows(dst, key, 0, 0, -1e9, r1)
        y0 = int(round(eye_y + band[0])); y1 = int(round(eye_y + band[1])); ys = int(round(eye_y + s))
        if ys <= y0:
            return self.draw_rows(dst, key, 0, 0, -1e9, r1)
        assert y <= y0 and ys + 1 < r1
        self.draw_rows(dst, key, 0, 0, -1e9, y0)
        r = (y1 - y0) / (ys - y0)
        n = ys - y0 + 1
        self.draw(dst, key, [0, (y0 - y) + 0.5 - 0.5 * r, w, r * n], [x + self.ox, y0 + self.oy, w, n])
        self.draw_rows(dst, key, 0, 0, ys + 1, r1)

def _images(A, B, ka, kb, item_sleeves):
    """Images d'une tenue, par rôle. Boîte : origine et taille en px de sa photo."""
    W, H = A['size']
    img = {'A.cutout': {'photo': ka, 'layer': 'cutout', 'box': [0, 0, W, H]},
           'B.cutout': {'photo': kb, 'layer': 'cutout', 'box': [0, 0, B['size'][0], B['size'][1]]}}
    if item_sleeves:
        img['A.itemSleeves'] = {'photo': ka, 'layer': 'itemSleeves', 'path': item_sleeves, 'box': [0, 0, W, H]}
    for role, P, k in (('A', A, ka), ('B', B, kb)):
        arms = P.get('arms')
        if not arms: continue
        for layer in ('arms', 'body', 'sleeves'):
            if arms.get(layer):
                img[f'{role}.{layer}'] = {'photo': k, 'layer': layer, 'path': arms[layer]['path'], 'box': list(arms[layer]['box'])}
    return img

def ops_actuel(R, A, s, band, dx, dy, feather, item_sleeves):
    """= planRender + drawSilhouette de render.ts / draw.ts (paire), à l'identique."""
    FE = feather
    W, H = A['size']
    ox, oy = R.ox, R.oy
    cut_row = int(round(A['eye'][1] + s))
    fade_end = cut_row + FE
    bs = int(round(A['eye'][1] + band[0])) if band else None
    be = int(round(A['eye'][1] + band[1])) if band else None
    if bs is not None and cut_row > bs and be > bs:
        ratio = (be - bs) / (cut_row - bs)
        source_end = bs + (fade_end - bs) * ratio
        R.draw('main', 'A.cutout', [0, 0, W, bs], [ox, oy, W, bs])
        R.draw('main', 'A.cutout', [0, bs, W, source_end - bs], [ox, oy + bs, W, fade_end - bs])
    else:
        end = min(fade_end, H)
        R.draw('main', 'A.cutout', [0, 0, W, end], [ox, oy, W, end])
    cut = oy + cut_row
    f0, f1 = cut - FE + 0.5, cut + FE + 0.5
    R.fade_abs('main', [(f0, 1), (f1, 0)])
    R.clear('tmp')
    bw, bh = R.images['B.cutout']['box'][2:]
    R.draw('tmp', 'B.cutout', [0, 0, bw, bh], [ox + dx, oy + dy, bw, bh])
    R.fade_abs('tmp', [(f0, 0), (f1, 1)])
    R.composite('main', 'tmp', 'lighter')
    if item_sleeves:
        R.draw('main', 'A.itemSleeves', [0, 0, W, H], [ox, oy, W, H])

def ops_plies(R, A, B, geo, s, band, dx, dy, feather):
    """= spike_export.record (recette validée dans Chromium)."""
    FE = feather
    H = A['size'][1]
    ys, yj = geo['ys'], geo['yj']
    ox = R.ox
    split = B['eye'][0] + dx
    xs = int(math.ceil(split))           # colonnes < split : côté gauche
    checks = {'stripSides': True, 'kPositive': True}

    def arms_layer(row_end):
        R.clear('arms')
        R.draw_rows('arms', 'B.arms', dx, dy)
        R.clear('tmp')
        y_top = yj - 2 * FE
        for sd in 'LR':
            side = geo['sides'][sd]
            xa, xb = (0, xs + ox) if sd == 'L' else (xs + ox, STAGE_W)
            for (y, blo, bhi, dlo, dhi) in side['strips']:
                if y < 0 or y >= H or y >= row_end: continue
                k = (dhi - dlo) / max(1.0, bhi - blo)
                if k <= 0:
                    checks['kPositive'] = False
                    continue
                x0, x1 = dlo - MX * k, dhi + MX * k
                if not ((sd == 'L' and bhi + MX + 1 < split) or (sd == 'R' and blo - MX - 1 >= split)):
                    checks['stripSides'] = False
                Xa, Xb = int(math.ceil(x0)), int(math.floor(x1)) + 1
                if Xb <= Xa: continue
                R.draw('tmp', 'arms', [blo + ox + 0.5 + (Xa - 0.5 - dlo) / k, y + R.oy, (Xb - Xa) / k, 1],
                       [Xa + ox, y + R.oy, Xb - Xa, 1], 'strip', sd)
            r0 = side['y_end'] if side['y_end'] is not None else y_top
            r0 = max(r0, y_top)
            if row_end > r0:
                n = min(row_end, H) - r0
                R.draw('tmp', 'arms', [xa, r0 + R.oy, xb - xa, n], [xa + side['rigid'], r0 + R.oy, xb - xa, n], 'rest', sd)
        R.fade('tmp', [(yj - 2 * FE, 0), (yj - FE, 1)])
        R.composite('main', 'tmp')

    if geo['sleeved']:
        R.draw_rows('main', 'B.body', dx, dy, ys - 2 * FE - 2 - dy)
        R.fade('main', [(ys - 2 * FE, 0), (ys - FE, 1)])
        arms_layer(H)
        R.clear('tmp')
        R.draw_stretched('tmp', 'A.cutout', A['eye'][1], band, s, ys + FE + 2)
        R.fade('tmp', [(ys - FE, 1), (ys + FE, 0)])
        R.composite('main', 'tmp')
        if 'A.sleeves' in R.images:
            R.draw_stretched('main', 'A.sleeves', A['eye'][1], band, s, 1e9)
        checks['fade4'] = True
        ye = None
    else:
        ye = max(v['y_end'] or ys for v in geo['sides'].values())
        checks['fade4'] = ys - FE <= ye - 30
        R.draw_rows('main', 'B.cutout', dx, dy, ye - 47 - dy)
        R.fade('main', [(ye - 45, 0), (ye - 30, 1)])
        R.clear('tmp')
        R.draw_rows('tmp', 'B.body', dx, dy, ys - 2 * FE - 2 - dy, ye + 2 - dy)
        R.fade('tmp', [(ys - 2 * FE, 0), (ys - FE, 1), (ye - 30, 1), (ye, 0)])
        R.composite('main', 'tmp')
        if band:
            R.clear('tmp')
            R.draw_stretched('tmp', 'A.body', A['eye'][1], band, s, ys + FE + 2)
            R.fade('tmp', [(ys - FE, 1), (ys + FE, 0)])
            R.composite('main', 'tmp')
        arms_layer(ye)
        R.clear('tmp')
        R.draw_rows('tmp', 'A.cutout', 0, 0, -1e9, yj + FE + 2)
        R.fade('tmp', [(yj - FE, 1), (yj + FE, 0)])
        R.composite('main', 'tmp')
    return ye, checks

def ops_haut(R, A, s, dx, dy, feather):
    """Repli des hauts longs : corps sans bras du bas sous la coupe, haut d'origine au-dessus (fondu
    de la coupe), puis bras complets du haut, de leur place, à partir de 2 fondus au-dessus de la coupe."""
    FE = feather
    ys = int(round(A['eye'][1] + s))
    R.draw_rows('main', 'B.body', dx, dy, ys - 2 * FE - 2 - dy)
    R.fade('main', [(ys - 2 * FE, 0), (ys - FE, 1)])
    R.clear('tmp')
    R.draw_rows('tmp', 'A.cutout', 0, 0, -1e9, ys + FE + 2)
    R.fade('tmp', [(ys - FE, 1), (ys + FE, 0)])
    R.composite('main', 'tmp')
    R.clear('tmp')
    R.draw_rows('tmp', 'A.arms', 0, 0, ys - 2 * FE - 2)
    R.fade('tmp', [(ys - 2 * FE, 0), (ys - FE, 1)])
    R.composite('main', 'tmp')
    return ys

# ---------------------------------------------------------------- plan complet d'une tenue
def draw_plan(A, B, ka='A', kb='B', margin=6, feather=10, item_sleeves=None, long_mode=LONG_TOP_MODE):
    """A, B : photos du manifeste (haut, bas) ; ka, kb : leurs clés ; item_sleeves : chemin des manches
    de la pièce du haut (manches/<id>.webp) ou None, pour le mode 'actuel'. long_mode : rendu des hauts
    longs, 'actuel' en production ('haut' et 'plies' : simulations seulement). Renvoie mode, géométrie,
    images, toiles et opérations."""
    s, band = plan_split(A, B, margin, feather)
    dx, dy = align(A, B, s)
    ox, oy = js_round(STAGE_EYE[0] - A['eye'][0]), js_round(STAGE_EYE[1] - A['eye'][1])
    geo = {'s': s, 'band': list(band) if band else None, 'dx': dx, 'dy': dy, 'offset': [ox, oy],
           'ys': int(round(A['eye'][1] + s))}
    reason = None
    if not A.get('arms') or not B.get('arms'):
        mode, reason = 'actuel', 'pas de données de bras'
    elif A['topLow'] is None:
        mode, reason = 'actuel', 'haut plus long que la zone mesurée'
    else:
        g = arm_geometry(A, B, s, band, dx, dy, feather)
        geo.update({'yj': g['yj'], 'sleeved': g['sleeved'],
                    'sides': {sd: {'strips': [list(t) for t in v['strips']], 'rigid': v['rigid'], 'y_end': v['y_end']}
                              for sd, v in g['sides'].items()}})
        long_top = s >= LONG_ARMS or wrist_above_junction(A, B, g['yj'])
        geo['longTop'] = long_top
        if long_top and long_mode != 'plies':     # 'plies' : comparaison seulement, jamais en production
            if long_mode == 'haut' and band is None:
                mode = 'haut'
            else:
                mode, reason = 'actuel', 'haut long'
        elif all(v['y_end'] is None for v in g['sides'].values()):
            mode, reason = 'actuel', 'aucune bande'
        else:
            mode = 'plies'
    images = _images(A, B, ka, kb, item_sleeves)
    R = Recorder(ox, oy, images)
    checks = {}
    if mode == 'plies':
        ye, checks = ops_plies(R, A, B, geo, s, band, dx, dy, feather)
        geo['ye'] = ye
        if not all(checks.values()):
            mode, reason = 'actuel', 'précondition : ' + ', '.join(k for k, v in checks.items() if not v)
            R = Recorder(ox, oy, images)
    if mode == 'haut':
        ops_haut(R, A, s, dx, dy, feather)
    if mode == 'actuel':
        ops_actuel(R, A, s, band, dx, dy, feather, item_sleeves if 'A.itemSleeves' in images else None)
    used = sorted({op['src'] for op in R.ops if op['op'] == 'draw' and op['src'] in images})
    return {'mode': mode, 'reason': reason, 'geometry': geo, 'checks': checks,
            'width': STAGE_W, 'height': STAGE_H, 'canvases': ['main', 'tmp', 'arms'],
            'images': {k: images[k] for k in used}, 'ops': R.ops}
