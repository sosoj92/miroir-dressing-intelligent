# « Bras pliés » (docs/conception.md §7) : précalcul PAR PHOTO des couches et des données de bras du paquet.
#
# Au rendu, sous la coupe, les bras de la photo du BAS sont gardés mais décalés ligne par ligne pour
# rejoindre ceux de la photo du HAUT à la jonction ; le décalage décroît en cosinus jusqu'au poignet
# (bras_plan.py). Il faut pour cela, pour chaque photo (plusieurs pièces peuvent la partager) :
#   bras/<clé>.webp           bras, mains, bracelets (et manches sous l'ourlet) seuls, fond transparent
#   corps/<clé>.webp          photo détourée SANS les bras ; sous le bras, le corps caché est complété
#                             (bord du corps estimé, couleur du corps sûr le plus proche sur la ligne)
#   manches-photo/<clé>.webp  manches du haut sous l'ourlet (haut à manches longues), si la photo en a
#   et, dans le manifeste (photos[clé].arms) : bords des bras et des manches toutes les 5 lignes, ligne
#   du poignet et du bas de manche par côté, boîte de chaque couche (voir README).
#
# Classes du corps : FASHN Human Parser, modèle LOCAL (modeles.py : téléchargé une fois par
# l'installeur, puis hors ligne). Il est obligatoire : sans lui, la fabrication s'arrête (aucun
# repli). Les cartes sont gardées dans <travail>/fashn/<clé>.png, avec l'empreinte de la photo dans
# fashn/empreintes.json : une photo changée est reparsée, une photo inchangée ne l'est jamais deux fois
# (la même carte sert aussi aux lignes, aux manches des pièces et à la couleur). Aucune photo ne
# quitte le PC.
#
# Réglages repris À L'IDENTIQUE du prototype validé sur un jeu de photos réel. Seuls écarts : (1)
# repère = l'œil tel qu'écrit dans le manifeste (arrondi à 0,1 px), car c'est le seul que connaît le
# navigateur ; (2) chaque couche est rognée à sa boîte (alpha 8 bits > 0) plus 1 px transparent de
# chaque côté, même au-delà du cadre de la photo (précondition du rendu canvas) ; (3) octets
# arrondis (et non tronqués) à l'écriture des couches, comme l'essai canvas.
import json, os, sys
import numpy as np, cv2
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modeles

ARMS_VERSION = 1          # version du champ photos[clé].arms du manifeste
STEP = 5                  # pas des données de bras (lignes)
DATA_FROM = 250           # première ligne des données, en px sous les yeux
ARM, HAND, TOP, JEWEL = 12, 13, 3, 17   # classes FASHN : bras, mains, haut, bijoux
TOUCH = 3                 # contact bras/corps : corps à moins de 3 px du bord intérieur du bras
BRIDGE = 15               # dans une zone de contact, filet de fond (px) comblé jusqu'au corps
OVERFILL = 30             # corps caché supposé sous le bras quand rien ne permet de le situer
WEBP_QUALITY = 88
LAYER_DIRS = {'arms': 'bras', 'body': 'corps', 'sleeves': 'manches-photo'}

# ---------------------------------------------------------------- classes FASHN (par photo, en cache)
def _parse(rgb8):
    return np.asarray(modeles.fashn().predict(rgb8)).astype(np.uint8)

def seg_of(photo_path, raw, cache_dir):
    """Classes FASHN de la photo (H x W, uint8), calculées sur la photo chargée par chroma.load
    (1600 px de haut, octets tronqués comme le prototype) ; gardées dans cache_dir/<clé>.png, et
    recalculées si la photo a changé (empreinte SHA-256 du fichier dans empreintes.json)."""
    os.makedirs(cache_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(photo_path))[0]
    path = os.path.join(cache_dir, base + '.png')
    index_path = os.path.join(cache_dir, 'empreintes.json')
    index = {}
    if os.path.exists(index_path):
        with open(index_path, encoding='utf-8') as f: index = json.load(f)
    digest = modeles.sha256(photo_path)
    if os.path.exists(path) and index.get(base, {}).get('photo') == digest:
        seg = np.asarray(Image.open(path))
    else:
        seg = _parse((raw * 255).astype(np.uint8))
        Image.fromarray(seg).save(path)
        index[base] = {'photo': digest, 'carte': modeles.sha256(path)}
        with open(index_path, 'w', encoding='utf-8') as f: json.dump(index, f, indent=1, sort_keys=True)
    if seg.shape != raw.shape[:2]:
        raise RuntimeError(f'{base} : carte FASHN {seg.shape} et photo {raw.shape[:2]} de tailles différentes.')
    return seg

def relabel(seg, inside):
    """Pixels du sujet classés « fond » : classe du voisin le plus proche ; hors du sujet : 0."""
    zero = (seg == 0).astype(np.uint8)
    _, idx = cv2.distanceTransformWithLabels(zero, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    lut = np.zeros(idx.max() + 1, np.uint8)
    lut[idx[zero == 0]] = seg[zero == 0]
    out = lut[idx]
    out[~inside] = 0
    return out

def smooth_nan(v, k=9):
    """Médiane glissante qui ignore les lignes sans bras."""
    out = np.full_like(v, np.nan)
    h = k // 2
    for i in range(len(v)):
        w = v[max(0, i - h):i + h + 1]
        w = w[~np.isnan(w)]
        if len(w) >= 3: out[i] = np.median(w)
    out[np.isnan(v)] = np.nan
    return out

def hidden_body(arm, body, sil, a, ex, gapm):
    """Côté gauche (le droit est traité en miroir). Bord du corps caché sous le bras, une courbe par
    ligne : là où le bras est collé au corps (majorité des lignes voisines), OVERFILL px sous le bras
    (trop de tissu plutôt qu'un trou) ; là où l'écart de fond est franc, le bord visible du corps ;
    entre les deux, mélange continu, puis lissage vertical : ni dents, ni encoche."""
    H, W = arm.shape
    sm = np.arange(W) < ex
    solid = body & (a > 0.8)
    touch = np.full(H, np.nan); his = np.full(H, np.nan); los = np.full(H, np.nan)
    bst = np.full(H, np.nan); deep = np.full(H, np.nan)
    for y in range(H):
        xs = np.where(arm[y] & sil[y] & sm)[0]
        if len(xs) < 4: continue
        lo, hi = xs[0], xs[-1]
        los[y], his[y] = lo, hi
        outside = solid[y, max(0, lo - 8):lo]
        nxt = np.where(solid[y, hi + 1:min(W, hi + 1 + 40)])[0]
        if len(outside) == 8 and outside.all():
            touch[y], deep[y], bst[y] = 1, lo, hi + 1      # le corps dépasse du bras : tout le bras est devant
        elif len(nxt):
            touch[y] = 1 if nxt[0] < TOUCH else 0
            deep[y], bst[y] = max(lo, hi - OVERFILL), hi + 1 + nxt[0]
        else:
            touch[y], deep[y], bst[y] = 0, max(lo, hi - OVERFILL), np.nan   # pas de corps à côté
    valid = np.where(~np.isnan(touch))[0]
    T = np.full(H, np.nan)
    for y in valid:
        if np.isnan(bst[y]): continue
        frac = np.nanmean(touch[max(0, y - 15):y + 16])
        k = float(np.clip((frac - 0.3) / 0.4, 0, 1)); k = k * k * (3 - 2 * k)
        T[y] = k * deep[y] + (1 - k) * bst[y]
    fill = np.zeros((H, W), bool)
    for y in valid:
        if np.isnan(T[y]): continue
        t = np.nanmean(T[max(0, y - 20):y + 21])
        x0 = max(int(np.floor(t)), int(los[y]))
        x1 = int(bst[y])
        if x1 - x0 < 1 or x1 - his[y] > BRIDGE: continue
        fill[y, x0:x1] = True
    return fill & ~solid

# ---------------------------------------------------------------- précalcul d'une photo
class ArmPhoto:
    """Couches et données de bras d'une photo. fg, a : détourage (chroma.key) ; raw : photo chargée
    (chroma.load) ; eye : [x, y] du manifeste ; top_low, tucked : lignes du manifeste ; seg : classes
    FASHN. Le détourage reçu n'est jamais modifié (le paquet garde photos/<clé>.webp tel quel)."""

    def __init__(self, fg, a, raw, eye, top_low, tucked, seg, margin, feather):
        a = a.copy()
        self.gr = (raw[..., 1] - np.maximum(raw[..., 0], raw[..., 2])) / (raw[..., 1] + 1e-3)
        self.fg, self.a = fg, a
        H, W = a.shape
        self.H, self.W = H, W
        ex, ey = float(eye[0]), float(eye[1])
        self.ex, self.ey = ex, ey
        FE = feather
        lb = relabel(seg, a > 0.01)
        rows = np.arange(H)[:, None]
        cols = np.arange(W)
        arm = np.isin(lb, (ARM, HAND))
        # bracelets, montres : bijoux collés au bras (sinon ils restent en place quand le bras bouge)
        jew = (lb == JEWEL).astype(np.uint8)
        n, cc = cv2.connectedComponents(jew, connectivity=8)
        near = cv2.dilate(arm.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
        for i in range(1, n):
            comp = cc == i
            if (comp & near).any() and comp.sum() < 4000: arm |= comp
        # manches : classe « haut » sous l'ourlet, composantes sur les côtés (pas les cordons du milieu)
        sleeve = np.zeros_like(arm)
        if top_low is not None and not tucked:
            cand = ((lb == TOP) & (rows >= ey + top_low + margin)).astype(np.uint8)
            n, cc, st, _ = cv2.connectedComponentsWithStats(cand, connectivity=8)
            for i in range(1, n):
                x, y, w, h, area = st[i]
                if area > 300 and (x + w < ex - 40 or x > ex + 40):
                    sleeve |= cc == i
            # la manche remonte au-dessus de l'ourlet (zone du fondu) : mêmes colonnes, classe « haut »
            hem = int(round(ey + top_low + margin))
            for side_m in (cols < ex, cols >= ex):
                xs = np.where((sleeve[hem:hem + 6] & side_m[None, :]).any(0))[0]
                if len(xs) < 4: continue
                band_ = np.zeros(W, bool); band_[max(0, xs[0] - 2):xs[-1] + 3] = True
                sleeve[hem - 3 * FE:hem] |= (lb[hem - 3 * FE:hem] == TOP) & band_[None, :]
        allarm = arm | sleeve
        body = (lb > 0) & ~allarm
        # ombre du fond vert prise entre le bras et la hanche (semi-opaque, encore verdâtre) : c'est du
        # fond ; on l'efface, sinon elle passe pour un contact bras/corps ou reste en semis quand le bras bouge
        clean = self.gr < 0.10
        d_arm = cv2.distanceTransform((~(allarm & (a > 0.5) & clean)).astype(np.uint8), cv2.DIST_L2, 3)
        d_body = cv2.distanceTransform((~(body & (a > 0.8) & clean)).astype(np.uint8), cv2.DIST_L2, 3)
        zone = (d_arm <= 15) & (d_body <= 15)
        dark = raw.max(axis=2) < 0.22
        # verdâtre ; ou classé bras mais sombre et pas rouge (la peau ne l'est jamais : ombre rendue opaque
        # par le traitement des semis) ; ou à moitié transparent et un peu vert
        armlab = np.isin(lb, (ARM, HAND))
        gap = zone & ((self.gr >= 0.12) | (armlab & dark & (self.gr >= 0.0)) | ((a < 0.6) & (self.gr >= 0.05)))
        a[gap] = 0
        self.gap = gap
        body &= ~gap; allarm &= ~gap
        # liseré de 1-6 px classé « corps » collé au bras puis du fond : c'est le bord du bras
        opened = cv2.morphologyEx(body.astype(np.uint8), cv2.MORPH_OPEN, np.ones((1, 7), np.uint8)) > 0
        sliver = body & ~opened & (cv2.dilate(allarm.astype(np.uint8), np.ones((1, 5), np.uint8)) > 0)
        allarm |= sliver; body &= ~sliver
        # îlots « bras » isolés (bruit du modèle sur la taille, la hanche) : ils restent avec le corps
        n, cc, st, _ = cv2.connectedComponentsWithStats(allarm.astype(np.uint8), connectivity=8)
        small = np.isin(cc, [i for i in range(1, n) if st[i][4] < 1500])
        allarm &= ~small; body |= small & (lb > 0)
        self.sleeve = sleeve & allarm
        self.hand = (lb == HAND) & allarm
        self.arm = allarm
        sil = a > 0.5
        # bords par ligne et par côté (x min / x max des pixels de bras du côté)
        self.edges, self.wrist, self.cuff, self.sl_edges = {}, {}, {}, {}
        for side in 'LR':
            sm = (cols < ex) if side == 'L' else (cols >= ex)
            lo, hi = np.full(H, np.nan), np.full(H, np.nan)
            slo, shi = np.full(H, np.nan), np.full(H, np.nan)
            m = allarm & sil & sm[None, :]
            msl = self.sleeve & sil & sm[None, :]
            for y in range(int(ey + DATA_FROM), H):
                xs = np.where(m[y])[0]
                if len(xs) >= 4: lo[y], hi[y] = xs[0], xs[-1]
                xs = np.where(msl[y])[0]
                if len(xs) >= 4: slo[y], shi[y] = xs[0], xs[-1]
            self.edges[side] = (smooth_nan(lo), smooth_nan(hi))
            self.sl_edges[side] = (smooth_nan(slo), smooth_nan(shi))
            hc = (self.hand & sm[None, :]).sum(1)
            hr = np.where(hc[int(ey + DATA_FROM):] >= 15)[0]
            self.wrist[side] = int(ey + DATA_FROM + hr[0]) if len(hr) else None
            sc = msl.sum(1)
            sr = np.where(sc >= 10)[0]
            self.cuff[side] = int(sr[-1]) if len(sr) else None
        self.build_layers(body)

    def build_layers(self, body):
        a, fg, H, W = self.a, self.fg, self.H, self.W
        arm = self.arm
        sil = a > 0.5
        fill = np.zeros((H, W), bool)
        fillcol = fg.copy()
        for side in 'LR':
            fl = (lambda x: x) if side == 'L' else (lambda x: x[:, ::-1])
            ex = self.ex if side == 'L' else W - 1 - self.ex
            fill |= fl(hidden_body(fl(arm), fl(body & (self.gr < 0.10)), fl(sil), fl(a), ex, fl(self.gap)))
        # bord du corps contre le bras (3 px) : le modèle y laisse souvent un liseré de peau ; là où le
        # corps continue sous le bras, ce liseré est repeint avec le reste
        edge = (cv2.dilate(arm.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0) & body
        fill |= edge & (cv2.dilate(fill.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0)
        if fill.any():
            # couleur du corps caché : pixel de corps sûr le plus proche sur la même ligne (jamais le bras
            # ni le fond), adouci verticalement (flou calculé sur ces seules couleurs de corps)
            known = body & (a > 0.8) & (self.gr < 0.10) & ~edge & ~fill
            known = cv2.erode(known.astype(np.uint8), np.ones((13, 13), np.uint8)) > 0   # loin des bords ombrés
            # même ligne seulement (pas de couleur venue du haut porté au-dessus, ni des pieds)
            near_col = fg.copy()
            for y in np.where(fill.any(1))[0]:
                kx = np.where(known[y])[0]
                if not len(kx): continue
                fx = np.where(fill[y])[0]
                j = np.clip(np.searchsorted(kx, fx), 1, len(kx) - 1) if len(kx) > 1 else np.zeros(len(fx), int)
                if len(kx) > 1:
                    left, right = kx[j - 1], kx[j]
                    j = np.where(np.abs(fx - left) <= np.abs(right - fx), j - 1, j)
                near_col[y, fx] = fg[y, kx[j]]
            near_col = np.where(fill[..., None], near_col, 0)
            wsum = cv2.GaussianBlur(fill.astype(np.float32), (0, 0), sigmaX=2, sigmaY=4)
            near_col = cv2.GaussianBlur(near_col, (0, 0), sigmaX=2, sigmaY=4) / np.maximum(wsum, 1e-3)[..., None]
            fillcol = np.where(fill[..., None], near_col, fg)
        # masques complémentaires : le bras prend 1 px du corps (bord doux), le corps caché est opaque
        armd = cv2.dilate(arm.astype(np.uint8), np.ones((3, 3), np.uint8))
        m = cv2.GaussianBlur(armd.astype(np.float32), (3, 3), 0)
        m = np.maximum(m, cv2.dilate(arm.astype(np.uint8), np.ones((5, 5), np.uint8)) * (~body))
        zone = (armd > 0) | fill
        fillx = (cv2.dilate(fill.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0) & zone
        fa_ = cv2.GaussianBlur(fillx.astype(np.float32), (3, 3), 0) * zone
        fa_ = np.maximum(fa_, fill)
        self.arm_a = np.clip(a * m, 0, 1)
        self.arm_p = fg * self.arm_a[..., None]
        rest = a * (1 - m) * (1 - fa_)
        self.body_a = np.clip(fa_ + rest, 0, 1)
        self.body_p = fillcol * fa_[..., None] + fg * rest[..., None]
        other = cv2.dilate((body & (a > 0.5)).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
        gr = self.gr
        sl = self.sleeve & ~other & (gr < 0.12) & (a > 0.5)
        sl = cv2.morphologyEx(sl.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        sl = cv2.morphologyEx(sl, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)) > 0
        sl &= self.sleeve
        self.sleeve_a = np.clip(a * cv2.GaussianBlur(sl.astype(np.float32), (3, 3), 0), 0, 1)
        self.sleeve_p = fg * self.sleeve_a[..., None]

    def data(self):
        """Bords des bras (L, R) et des manches (sleeveL, sleeveR) toutes les STEP lignes à partir de
        DATA_FROM px sous les yeux, en px de la photo (0,1 px) ; poignet et bas de manche par côté, en px
        sous les yeux (0,1 px). null : pas de bras (ou de manche) sur cette ligne, de ce côté."""
        out = {'step': STEP, 'from': None, 'L': [], 'R': [], 'sleeveL': [], 'sleeveR': [], 'wrist': {}, 'cuff': {}}
        r0 = int(np.ceil(DATA_FROM / STEP) * STEP)
        out['from'] = r0
        for rel in range(r0, int(self.H - self.ey), STEP):
            y = int(round(self.ey + rel))
            if y >= self.H: break
            for side in 'LR':
                lo, hi = self.edges[side]
                out[side].append(None if np.isnan(lo[y]) else [round(float(lo[y]), 1), round(float(hi[y]), 1)])
                slo, shi = self.sl_edges[side]
                out['sleeve' + side].append(None if np.isnan(slo[y]) else [round(float(slo[y]), 1), round(float(shi[y]), 1)])
        for side in 'LR':
            out['wrist'][side] = None if self.wrist[side] is None else round(self.wrist[side] - self.ey, 1)
            out['cuff'][side] = None if self.cuff[side] is None else round(self.cuff[side] - self.ey, 1)
        return out

    def layers(self):
        """Couches prémultipliées (p, a) dans le repère de la photo ; la couche manches est None si la
        photo n'a pas de manche sous l'ourlet."""
        out = {'arms': (self.arm_p, self.arm_a), 'body': (self.body_p, self.body_a)}
        out['sleeves'] = (self.sleeve_p, self.sleeve_a) if self.sleeve_a.max() > 0.5 else None
        return out

# ---------------------------------------------------------------- couches rognées, en 8 bits
def to_rgba8(p, a):
    """Prémultiplié [0, 1] -> RGBA 8 bits non prémultiplié (octets arrondis)."""
    rgb = np.where(a[..., None] > 1e-4, p / np.maximum(a[..., None], 1e-4), 0)
    return np.dstack([np.round(np.clip(rgb, 0, 1) * 255), np.round(np.clip(a, 0, 1) * 255)]).astype(np.uint8)

def crop_layer(rgba8):
    """Boîte [x, y, w, h] (px de la photo) des pixels d'alpha non nul, élargie de 1 px transparent de
    chaque côté, même au-delà du cadre ; et l'image rognée (zéros hors du cadre). None si vide."""
    ys, xs = np.where(rgba8[..., 3] > 0)
    if not len(ys): return None, None
    x0, y0, x1, y1 = int(xs.min()) - 1, int(ys.min()) - 1, int(xs.max()) + 2, int(ys.max()) + 2
    H, W = rgba8.shape[:2]
    out = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
    sy0, sy1, sx0, sx1 = max(0, y0), min(H, y1), max(0, x0), min(W, x1)
    out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = rgba8[sy0:sy1, sx0:sx1]
    return [x0, y0, x1 - x0, y1 - y0], out

def save_webp8(rgba8, path, quality=WEBP_QUALITY):
    """WebP avec perte pour la couleur, alpha sans perte (alpha_quality 100)."""
    Image.fromarray(rgba8, 'RGBA').save(path, 'WEBP', quality=quality, method=6, alpha_quality=100)

def write_photo_arms(ph, base, out):
    """Écrit les couches rognées de la photo dans le paquet `out` et renvoie le champ arms du manifeste."""
    entry = {'v': ARMS_VERSION}
    for name, layer in ph.layers().items():
        box, img = (None, None) if layer is None else crop_layer(to_rgba8(*layer))
        if box is None:
            if name != 'sleeves': raise RuntimeError(f'{base} : couche {name} vide.')
            entry[name] = None
            continue
        rel = f'{LAYER_DIRS[name]}/{base}.webp'
        os.makedirs(os.path.join(out, LAYER_DIRS[name]), exist_ok=True)
        save_webp8(img, os.path.join(out, rel))
        entry[name] = {'path': rel, 'box': box}
    entry.update(ph.data())
    return entry
