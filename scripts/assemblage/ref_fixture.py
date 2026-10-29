# Outil de DÉVELOPPEMENT (la personne qui fabrique son paquet ne le lance pas) : valeurs de
# référence pour les tests TypeScript de lib/assembly, calculées UNIQUEMENT à partir d'un manifeste
# (même définition que le code de l'app). Aucune image.
#   python -I ref_fixture.py <manifest.json> <sortie.json>
#       coupes et alignement de toutes les paires haut x bas, avec les repères des photos (sans arms) et
#       la photo et la catégorie de chaque pièce (lib/assembly/fixtures/reference.json)
#   python -I ref_fixture.py bras <manifest.json> <paires.json> <sortie.json>
#       plans de dessin « bras pliés » (bras_plan.draw_plan) des paires listées dans paires.json, avec
#       les données des photos utilisées (lib/assembly/fixtures/arms-reference.json). paires.json :
#       [["<id du haut>", "<id du bas>", "ce que la paire couvre"], ...] ; un 4e élément facultatif
#       « lower » (resp. « upper ») recopie la photo du bas (du haut) sans son champ arms sous la clé
#       <clé>_nodata, « cross » élargit le bras gauche du bas jusqu'au milieu (cas synthétique).
#       Choisir une paire par cas couvert : bras nus, ventre étiré, manches longues, haut rentré, haut
#       long, topLow null (coupe 866), puis les cas lower, upper et cross.
import json, os, sys, itertools, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bras_plan as BP

REPERES = ('size', 'eye', 'centers', 'topLow', 'bottomHigh', 'onePiece', 'tucked')

def main_reference(man_path, out_path):
    man = json.load(open(man_path, encoding='utf-8'))
    margin, feather = man['margin'], man.get('feather', 10)
    P = man['photos']
    items = {it['legacy_id']: it for it in man['items']}
    tops = [k for k, it in items.items() if it['category'] in ('haut', 'veste')]
    bottoms = [k for k, it in items.items() if it['category'] == 'bas']
    cases = []
    for t, b in itertools.product(tops, bottoms):
        a, bb = P[items[t]['photo']], P[items[b]['photo']]
        s, band = BP.plan_split(a, bb, margin, feather)
        dx, dy = BP.align(a, bb, s)
        cases.append({'top': t, 'bottom': b, 'split': s, 'stretch': list(band) if band else None,
                      'dx': round(dx, 2), 'dy': round(dy, 2)})
    # Ce que lisent parse.test.ts, plan.test.ts et render.test.ts : les repères de chaque photo d'une
    # pièce, clé comprise et SANS arms (la version 1 du rendu), et la photo et la catégorie de chaque pièce.
    used = sorted({it['photo'] for it in items.values() if it.get('photo') in P})
    photos = {k: {'key': k, **{f: P[k][f] for f in REPERES}} for k in used}
    refs = {k: {'photo': it['photo'], 'category': it['category']} for k, it in items.items() if it.get('photo') in P}
    out = {'_comment': "Généré par scripts/assemblage/ref_fixture.py <manifest> <ce fichier> (repères seulement, "
                       "aucune image). Tiré de photos personnelles : jamais commité.",
           'margin': margin, 'photos': photos, 'items': refs, 'cases': cases}
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(len(cases), 'paires ; étirées :', sum(1 for c in cases if c['stretch']), ';', len(photos), 'photos,',
          len(refs), 'pièces')

def _round(x):
    """Flottants à 1e-6 près (les tests TypeScript comparent à 1e-6)."""
    if isinstance(x, float): return round(x, 6) + 0.0
    if isinstance(x, list): return [_round(v) for v in x]
    if isinstance(x, tuple): return [_round(v) for v in x]
    if isinstance(x, dict): return {k: _round(v) for k, v in x.items()}
    return x

def near_integer_edges(plan):
    """Bords de bande x0 / x1 à moins de 1e-7 d'un entier sans l'être exactement : l'arrondi (ceil /
    floor) pourrait y basculer d'un ulp entre Python et TypeScript. (Un bord exactement entier est sûr
    si le TypeScript fait les mêmes opérations dans le même ordre.)"""
    n = 0
    g = plan['geometry']
    for side in g.get('sides', {}).values():
        for (y, blo, bhi, dlo, dhi) in side['strips']:
            k = (dhi - dlo) / max(1.0, bhi - blo)
            for x in (dlo - BP.MX * k, dhi + BP.MX * k):
                if 0 < abs(x - round(x)) < 1e-7: n += 1
    return n

def main_arms(man_path, pairs_path, out_path):
    man = json.load(open(man_path, encoding='utf-8'))
    cases_in = json.load(open(pairs_path, encoding='utf-8'))
    margin, feather = man['margin'], man['feather']
    items = {it['legacy_id']: it for it in man['items']}
    photos, cases = {}, []
    for case in cases_in:
        t, b, what = case[:3]
        strip = case[3] if len(case) > 3 else None
        ka, kb = items[t]['photo'], items[b]['photo']
        A, B = dict(man['photos'][ka]), dict(man['photos'][kb])
        if strip == 'lower': kb += '_nodata'; B.pop('arms', None)
        if strip == 'upper': ka += '_nodata'; A.pop('arms', None)
        if strip == 'cross':
            # bords intérieurs du bras gauche du bas poussés jusqu'au milieu, autour de la coupe
            kb += '_cross'
            arms = json.loads(json.dumps(B['arms']))
            s, _ = BP.plan_split(A, B, margin, feather)
            for i, v in enumerate(arms['L']):
                rel = arms['from'] + i * arms['step']
                if v is not None and s - 20 <= rel <= s + 100: arms['L'][i] = [v[0], round(B['eye'][0] - 3, 1)]
            B['arms'] = arms
        for k, p in ((ka, A), (kb, B)):
            photos[k] = {f: p[f] for f in ('size', 'eye', 'centers', 'topLow', 'bottomHigh', 'onePiece', 'tucked')}
            if p.get('arms'): photos[k]['arms'] = p['arms']
        sleeves = items[t].get('sleeves')
        plan = BP.draw_plan(A, B, ka, kb, margin, feather, item_sleeves=sleeves)
        ties = near_integer_edges(plan)
        if ties: print('ATTENTION', t, b, ties, 'bords de bande presque entiers', flush=True)
        g = plan['geometry']
        cases.append(_round({'top': t, 'bottom': b, 'covers': what, 'upper': ka, 'lower': kb, 'upperSleeves': sleeves,
                             'mode': plan['mode'], 'reason': plan['reason'], 'checks': plan['checks'],
                             'geometry': g, 'images': plan['images'], 'canvases': plan['canvases'], 'ops': plan['ops']}))
        print(t, b, plan['mode'], plan['reason'] or '', len(plan['ops']), 'opérations', flush=True)
    out = {'_comment': "Généré par scripts/assemblage/ref_fixture.py bras <manifest> <paires.json> <ce fichier> "
                       "(données seulement, aucune image ; les cas cross sont synthétiques, signalés). Flottants arrondis "
                       "à 1e-6. Les tests TypeScript doivent retrouver mode, raison, géométrie et opérations "
                       "(tolérance 1e-6). Scène : stage.width x stage.height.",
           'margin': margin, 'feather': feather,
           'stage': {'width': BP.STAGE_W, 'height': BP.STAGE_H, 'eye': list(BP.STAGE_EYE)},
           'constants': {'MX': BP.MX, 'L_MIN': BP.L_MIN, 'L_MAX': BP.L_MAX, 'LONG_ARMS': BP.LONG_ARMS,
                         'SLEEVE_PROBE': BP.SLEEVE_PROBE, 'SLEEVE_MIN': BP.SLEEVE_MIN, 'CUFF_HAND': BP.CUFF_HAND,
                         'SMOOTH_D': BP.SMOOTH_D, 'SMOOTH_S': BP.SMOOTH_S},
           'photos': photos, 'cases': cases}
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('{\n')
        keys = list(out.keys())
        for i, k in enumerate(keys):
            end = ',' if i < len(keys) - 1 else ''
            if k in ('photos', 'cases'):
                f.write(json.dumps(k) + ': ' + ('{\n' if k == 'photos' else '[\n'))
                entries = list(out[k].items()) if k == 'photos' else list(enumerate(out[k]))
                for j, (kk, v) in enumerate(entries):
                    sep = ',' if j < len(entries) - 1 else ''
                    head = (json.dumps(kk) + ': ') if k == 'photos' else ''
                    f.write(head + json.dumps(v, ensure_ascii=False, separators=(',', ':')) + sep + '\n')
                f.write(('}' if k == 'photos' else ']') + end + '\n')
            else:
                f.write(json.dumps(k) + ': ' + json.dumps(out[k], ensure_ascii=False) + end + '\n')
        f.write('}\n')
    print(len(cases), 'paires,', len(photos), 'photos,', os.path.getsize(out_path), 'octets')

if __name__ == '__main__':
    if sys.argv[1] == 'bras':
        main_arms(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        main_reference(sys.argv[1], sys.argv[2])
