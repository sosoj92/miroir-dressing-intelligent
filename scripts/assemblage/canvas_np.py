# Exécuteur NumPy d'un plan de dessin (bras_plan.draw_plan), avec la sémantique du canvas 2D du
# navigateur (validée contre Chromium : écart ≤ 2,5/255 en GPU) :
#  - toiles RGBA prémultipliées, stockées sur 8 bits (arrondi après CHAQUE opération) ;
#  - images RGBA 8 bits non prémultipliées, prémultipliées à l'arrondi au chargement (comme Chrome) ;
#  - drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh) : le centre du pixel de destination (X + 0,5) est
#    ramené dans la source, échantillonnage bilinéaire (centres des texels en i + 0,5, bord répété),
#    couverture = aire du pixel dans le rectangle de destination, rectangle source rogné à l'image ;
#  - fade : fillRect plein cadre, dégradé linéaire vertical d'alpha, en destination-in ;
#  - composite : drawImage(toile, 0, 0) en source-over ou lighter.
# Sert aux planches de contrôle tirées du paquet (planche.py) et aux vérifications ; le miroir,
# lui, dessine dans un vrai canvas (lib/assembly).
import numpy as np
from PIL import Image

def q8(x):
    return np.round(np.clip(x, 0.0, 1.0) * 255.0) / 255.0

def premul8(rgba8):
    """RGBA 8 bits non prémultiplié -> prémultiplié [0, 1], arrondi comme Chrome au chargement."""
    im = rgba8.astype(np.float64)
    a = im[..., 3:4]
    return np.concatenate([np.round(im[..., :3] * a / 255.0), a], axis=2) / 255.0

def load_image(path):
    return premul8(np.asarray(Image.open(path).convert('RGBA')))

def draw(dst, src, s, d):
    sx, sy, sw, sh = [float(v) for v in s]
    dx, dy, dw, dh = [float(v) for v in d]
    if sw <= 0 or sh <= 0 or dw <= 0 or dh <= 0:
        return
    Hs, Ws = src.shape[:2]
    kx, ky = dw / sw, dh / sh
    if sx < 0: dx -= sx * kx; dw += sx * kx; sw += sx; sx = 0.0
    if sy < 0: dy -= sy * ky; dh += sy * ky; sh += sy; sy = 0.0
    if sx + sw > Ws: dw -= (sx + sw - Ws) * kx; sw = Ws - sx
    if sy + sh > Hs: dh -= (sy + sh - Hs) * ky; sh = Hs - sy
    if sw <= 0 or sh <= 0 or dw <= 0 or dh <= 0:
        return
    Hd, Wd = dst.shape[:2]
    X0, X1 = max(0, int(np.floor(dx))), min(Wd, int(np.ceil(dx + dw)))
    Y0, Y1 = max(0, int(np.floor(dy))), min(Hd, int(np.ceil(dy + dh)))
    if X1 <= X0 or Y1 <= Y0:
        return
    X = np.arange(X0, X1, dtype=np.float64)
    Y = np.arange(Y0, Y1, dtype=np.float64)
    covx = np.clip(np.minimum(X + 1, dx + dw) - np.maximum(X, dx), 0, 1)
    covy = np.clip(np.minimum(Y + 1, dy + dh) - np.maximum(Y, dy), 0, 1)
    u = sx + (X + 0.5 - dx) * sw / dw - 0.5
    v = sy + (Y + 0.5 - dy) * sh / dh - 0.5
    u0 = np.floor(u); fu = u - u0
    v0 = np.floor(v); fv = v - v0
    iu0 = np.clip(u0, 0, Ws - 1).astype(int); iu1 = np.clip(u0 + 1, 0, Ws - 1).astype(int)
    iv0 = np.clip(v0, 0, Hs - 1).astype(int); iv1 = np.clip(v0 + 1, 0, Hs - 1).astype(int)
    top = src[np.ix_(iv0, iu0)] * (1 - fu)[None, :, None] + src[np.ix_(iv0, iu1)] * fu[None, :, None]
    bot = src[np.ix_(iv1, iu0)] * (1 - fu)[None, :, None] + src[np.ix_(iv1, iu1)] * fu[None, :, None]
    samp = top * (1 - fv)[:, None, None] + bot * fv[:, None, None]
    S = samp * (covy[:, None] * covx[None, :])[..., None]
    D = dst[Y0:Y1, X0:X1]
    dst[Y0:Y1, X0:X1] = q8(S + D * (1 - S[..., 3:4]))

def fade(dst, stops):
    ys = np.array([float(s[0]) for s in stops]); ws = np.array([float(s[1]) for s in stops])
    Y = np.arange(dst.shape[0], dtype=np.float64) + 0.5
    w = np.interp(Y, ys, ws)
    dst[:] = q8(dst * w[:, None, None])

def composite(dst, src, mode='source-over'):
    if mode == 'lighter':
        dst[:] = q8(dst + src)
    else:
        dst[:] = q8(src + dst * (1 - src[..., 3:4]))

def run(plan, images):
    """Exécute plan['ops'] ; images : rôle -> image prémultipliée [0, 1] (h, w, 4) à la taille de sa
    boîte. Renvoie la toile 'main' (H, W, 4) prémultipliée."""
    W, H = plan['width'], plan['height']
    cv = {name: np.zeros((H, W, 4), np.float64) for name in plan['canvases']}
    for op in plan['ops']:
        kind = op['op']
        if kind == 'clear':
            cv[op['dst']][:] = 0
        elif kind == 'draw':
            src = images[op['src']] if op['src'] in images else cv[op['src']]
            draw(cv[op['dst']], src, op['s'], op['d'])
        elif kind == 'fade':
            fade(cv[op['dst']], op['stops'])
        elif kind == 'composite':
            composite(cv[op['dst']], cv[op['src']], op.get('mode', 'source-over'))
        else:
            raise ValueError(kind)
    return cv['main']

def to_rgb_on(prem, background):
    """Prémultiplié -> RGB 8 bits sur un fond uni (0 = noir du miroir)."""
    bg = np.asarray(background, np.float64)
    return np.round(np.clip(prem[..., :3] + (1 - prem[..., 3:4]) * bg, 0, 1) * 255).astype(np.uint8)
