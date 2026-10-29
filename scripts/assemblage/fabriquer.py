# Point d'entrée unique de la chaîne photos (« mode silhouette », README.md de ce dossier) :
#   Windows    : scripts\assemblage\fabriquer.bat "<dossier>"   (ou glisser le dossier sur fabriquer.bat)
#   Mac, Linux : scripts/assemblage/fabriquer.sh "<dossier>"
# <dossier> contient les photos portées sur fond vert (JPEG, PNG ; HEIC avec l'option de l'installeur).
# La même commande, relancée, fait l'étape suivante :
#   1. photos préparées, yeux trouvés, catalogue.csv créé (une ligne par photo) avec la planche
#      controle/photos-*.jpg : on remplit le tableau dans un tableur ;
#   2. tableau relu (mêmes règles que l'appli), lignes calculées, bras pliés, planches de contrôle
#      controle/tenues-*.jpg, puis <dossier>/mon-dressing-import.zip, à importer depuis la page
#      Importer (téléphone ou navigateur du PC, connecté au compte).
# Options : --fond (essai du fond vert seulement), --regles (vignettes graduées des lignes),
#           --installer (modèles, appelé par INSTALLER_PHOTOS.bat / installer_photos.sh).
# Tout reste sur le PC : aucune photo n'est envoyée nulle part, et rien n'est téléchargé ici.
import argparse, csv, io, json, os, shutil, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modeles

ZIP_NAME = 'mon-dressing-import.zip'
CORRECTIONS = 'corrections.csv'
# cadrage pour lequel les réglages sont calés (photo ramenée à 1600 px de haut)
EYE_Y = (300, 460)          # hauteur des yeux (px depuis le haut) : environ 24 % de la hauteur
EYE_DIST = (48, 70)         # écart entre les yeux (px) : l'échelle de la personne dans le cadre
EYE_DIST_TOL = 0.12         # écart toléré d'une photo à la médiane (même distance à l'appareil)
CENTER_TOL = 0.12           # yeux à moins de 12 % de la largeur du milieu de la photo
BELOW_EYES = 1220           # px visibles sous les yeux sur la scène du miroir (render.ts)


def say(text=''):
    print(text, flush=True)


# racine du dépôt (scripts/assemblage/ -> deux niveaux au-dessus)
PROJET = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _inside(path, root):
    """Vrai si path est root ou l'un de ses sous-dossiers (liens résolus, casse ignorée sous Windows)."""
    p, r = (os.path.normcase(os.path.realpath(x)) for x in (path, root))
    try:
        return os.path.commonpath([p, r]) == r
    except ValueError:   # deux lecteurs différents sous Windows
        return False


def _csv_line(values):
    out = io.StringIO()
    csv.writer(out, delimiter=';', lineterminator='\r\n').writerow(values)
    return out.getvalue()


def _eyes(photos, travail):
    """Milieu et écart des yeux de chaque photo, gardés dans travail/reperes.json (recalculés si la
    photo change). Renvoie (repères par clé, photos sans visage)."""
    import align
    from chroma import load
    path = os.path.join(travail, 'reperes.json')
    cache = {}
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f: cache = json.load(f)
    with open(os.path.join(travail, 'photos.json'), encoding='utf-8') as f: registre = json.load(f)
    model = modeles.yunet()
    out, missing = {}, []
    for p in photos:
        k, digest = p['key'], registre[p['key']]['sha256']
        r = cache.get(k)
        if not r or r.get('sha256') != digest:
            r = align.eyes(load(p['path']), model)
            r = dict(r, sha256=digest) if r else {'sha256': digest, 'eye_mid': None}
        cache[k] = r
        if r.get('eye_mid') is None: missing.append(p)
        else: out[k] = r
    cache = {k: v for k, v in cache.items() if k in {p['key'] for p in photos}}
    with open(path, 'w', encoding='utf-8') as f: json.dump(cache, f, indent=1, sort_keys=True)
    return out, missing


def _framing(photos, reperes):
    """Avertissements de cadrage, en clair."""
    import numpy as np
    warn = []
    dists = [reperes[p['key']]['eye_dist'] for p in photos]
    med = float(np.median(dists))
    if not EYE_DIST[0] <= med <= EYE_DIST[1]:
        warn.append(f'écart entre les yeux de {med:.0f} px en moyenne (photo ramenée à 1600 px de haut) : les réglages '
                    f'sont calés pour {EYE_DIST[0]} à {EYE_DIST[1]} px. Place l\'appareil pour que tu occupes toute la '
                    f'hauteur, de la tête aux pieds.')
    for p in photos:
        r = reperes[p['key']]
        ex, ey = r['eye_mid']
        w = round(p['size'][0] * 1600 / p['size'][1]) if p['size'][1] > 1600 else p['size'][0]
        if not EYE_Y[0] <= ey <= EYE_Y[1]:
            warn.append(f'{p["source"]} : yeux à {ey:.0f} px du haut (attendu {EYE_Y[0]} à {EYE_Y[1]}, '
                        f'environ 24 % de la hauteur).')
        if abs(r['eye_dist'] - med) > EYE_DIST_TOL * med:
            warn.append(f'{p["source"]} : {"plus près" if r["eye_dist"] > med else "plus loin"} de l\'appareil que '
                        f'sur les autres photos (écart des yeux {r["eye_dist"]:.0f} px contre {med:.0f}).')
        if abs(ex - w / 2) > CENTER_TOL * w:
            warn.append(f'{p["source"]} : pas au milieu de la photo (yeux à {ex:.0f} px sur {w}).')
    return warn


def _corrections(path, photos):
    """corrections.csv facultatif : photo;top_low;bottom_high ; nombre (px sous les yeux), « aucune »
    (ligne inconnue) ou vide (ligne automatique). Renvoie (corrections par clé, erreurs)."""
    import catalogue
    if not os.path.exists(path): return {}, []
    try:
        rows, _, _ = catalogue.lire(path, obligatoires=['photo'])
    except catalogue.CatalogueError as error:
        return {}, [str(error).replace(catalogue.NOM, CORRECTIONS)]
    by_name = {}
    for p in photos:
        by_name[catalogue.simple(p['source'])] = p['key']
        by_name.setdefault(catalogue.simple(p['key']), p['key'])
    out, errors = {}, []
    for line, r in rows:
        k = by_name.get(catalogue.simple(r.get('photo', '')))
        if k is None:
            errors.append(f'{CORRECTIONS}, ligne {line}, colonne « photo » : « {r.get("photo", "")} » ne correspond à aucune photo.')
            continue
        for col in ('top_low', 'bottom_high'):
            v = r.get(col, '').strip()
            if not v: continue
            if catalogue.simple(v) in ('aucune', 'aucun', 'null', 'none'):
                out.setdefault(k, {})[col] = None
            else:
                try:
                    n = int(round(float(v.replace(',', '.'))))
                    if not -4000 <= n <= 4000: raise ValueError
                    out.setdefault(k, {})[col] = n
                except ValueError:
                    errors.append(f'{CORRECTIONS}, ligne {line}, colonne « {col} » : « {v} » : nombre de px sous les '
                                  f'yeux attendu, « aucune », ou vide pour la ligne automatique.')
    return out, errors


def fabriquer(dossier, fond=False, regles=False):
    import catalogue, preparation, planche
    t_start = time.time()
    dossier = os.path.abspath(dossier)
    if not os.path.isdir(dossier):
        say(f'[ERREUR] Dossier introuvable : {dossier}')
        return 1
    # Jamais dans le dossier du projet : un « git add » pourrait emporter les photos avec le code.
    if _inside(dossier, PROJET):
        say(f'[ERREUR] Ce dossier est dans le dossier du projet : {dossier}')
        say('   Un « git add » pourrait publier tes photos avec le code. Déplace le dossier de photos')
        say('   ailleurs (par exemple dans Documents ou Images), puis relance.')
        return 1
    travail = os.path.join(dossier, 'travail')
    controle = os.path.join(dossier, 'controle')
    os.makedirs(travail, exist_ok=True)
    say(f'Dossier : {dossier}')

    # 1. photos
    say('1. Photos...')
    photos, errors, warnings = preparation.preparer(dossier, travail)
    for w in warnings: say(f'   [AVERTISSEMENT] {w}')
    for e in errors: say(f'   [ERREUR] {e}')
    if errors:
        say('Corrige ces photos (ou retire-les du dossier) puis relance.')
        return 1
    if not photos:
        say('[ERREUR] Aucune photo JPEG ou PNG dans ce dossier (les sous-dossiers ne sont pas lus).')
        return 1
    say(f'   {len(photos)} photo(s) prête(s).')

    # 2. yeux
    say('2. Repères du visage...')
    reperes, missing = _eyes(photos, travail)
    if missing:
        say(f'[ERREUR] Aucun visage trouvé sur {len(missing)} photo(s) :')
        for p in missing: say(f'   - {p["source"]}')
        say('Reprends ces photos de face, visage vers l\'appareil, bien éclairé (ou retire-les du dossier), puis relance.')
        return 1
    for w in _framing(photos, reperes): say(f'   [AVERTISSEMENT] {w}')
    say(f'   {len(reperes)} visage(s).')

    if fond:
        from chroma import load, key, on_black
        from PIL import Image
        import numpy as np
        out = os.path.join(controle, 'fond')
        os.makedirs(out, exist_ok=True)
        for p in photos:
            fg, a = key(load(p['path']))
            Image.fromarray((on_black(fg, a) * 255).astype(np.uint8)).save(os.path.join(out, p['key'] + '.jpg'), quality=90)
            say(f'   {p["source"]} : sujet {float((a > 0.5).mean()):.0%} de l\'image')
        say(f'Essai du fond vert : regarde {out}')
        say('Le sujet doit être entier sur fond noir, sans trou dans les vêtements ni reste de fond.')
        return 0

    # 3. tableau des vêtements
    cat_path = os.path.join(dossier, catalogue.NOM)
    if not os.path.exists(cat_path):
        catalogue.creer(cat_path, photos)
        sheets = planche.photos([(p['path'], p['key'], p['source']) for p in photos], controle)
        say('')
        say(f'Tableau créé : {cat_path}')
        say(f'Planche des photos : {", ".join(sheets)}')
        say('Ouvre le tableau dans un tableur et remplis une ligne par vêtement :')
        say('   nom        : 1 à 80 caractères (par exemple « Jean brut »)')
        say('   categorie  : haut, bas, robe, veste, chaussures ou accessoire')
        say('   couleur    : vide = calculée d\'après la photo, ou #RRGGBB')
        say('   chaleur    : 1 (léger), 2 (moyen) ou 3 (chaud)')
        say('   styles     : decontracte, habille, sport (plusieurs : decontracte+sport)')
        say('   pluie      : oui ou non ;  rentre : oui si le haut est rentré dans le bas sur cette photo')
        say('Une photo inutile : laisse nom et categorie vides. Deux pièces sur une photo (haut ET bas) :')
        say('copie la ligne et donne-lui un autre id (par exemple photo07-bas).')
        say('Enregistre en CSV (garde le point-virgule), ferme le tableur, puis relance la même commande.')
        return 0
    try:
        rows, encoding, sep = catalogue.lire(cat_path)
        added = catalogue.ajouter(cat_path, photos, rows, encoding, sep)
    except catalogue.CatalogueError as error:
        say(f'[ERREUR] {error}')
        return 1
    if added:
        say(f'   {len(added)} nouvelle(s) photo(s) ajoutée(s) en fin de {catalogue.NOM} : remplis leurs lignes pour les utiliser.')
        planche.photos([(p['path'], p['key'], p['source']) for p in photos], controle)
    say('3. Tableau des vêtements...')
    items, tucked, errors, warnings = catalogue.valider(rows, photos)
    for w in warnings: say(f'   [AVERTISSEMENT] {w}')
    for e in errors: say(f'   [ERREUR] {e}')
    if errors:
        say(f'Corrige {catalogue.NOM} (enregistre, ferme le tableur) puis relance.')
        return 1
    corrections, errors = _corrections(os.path.join(dossier, CORRECTIONS), photos)
    for e in errors: say(f'   [ERREUR] {e}')
    if errors: return 1
    used = sorted({it['photo'] for it in items})
    say(f'   {len(items)} pièce(s) sur {len(used)} photo(s)' + (f', {len(corrections)} photo(s) corrigée(s) dans {CORRECTIONS}' if corrections else '') + '.')

    # 4. paquet (un passage du parseur par photo, gardé en cache)
    import build_assets, paquet
    say('4. Détourage, lignes et bras pliés (5 à 10 s par photo, plus une demi-minute pour charger le parseur)...')
    out = os.path.join(travail, 'paquet')
    tmp = out + '.nouveau'
    shutil.rmtree(tmp, ignore_errors=True)
    by_key = {p['key']: p['path'] for p in photos}
    try:
        manifest, report = build_assets.construire(items, by_key, reperes, tucked, corrections, travail, tmp, log=say)
    except BaseException as error:
        shutil.rmtree(tmp, ignore_errors=True)   # pas de paquet à moitié fait
        if isinstance(error, modeles.ModeleAbsent):
            say(f'[ERREUR] {error}')
            return 1
        raise
    shutil.rmtree(out, ignore_errors=True)
    os.replace(tmp, out)
    with open(os.path.join(travail, 'lignes-auto.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        f.write(_csv_line(['photo', 'top_low', 'bottom_high']))
        for k in used:
            r = report[k]
            f.write(_csv_line([k] + ['aucune' if r[c] is None else r[c] for c in ('top_low_auto', 'bottom_high_auto')]))
    with open(os.path.join(travail, 'rapport.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    for k in used:
        r = report[k]
        if r['pieds_coupes']:
            say(f'   [AVERTISSEMENT] {k} : les pieds touchent le bas de la photo (cadre trop serré ?).')
        elif r['sous_les_yeux'] > BELOW_EYES:
            say(f'   [AVERTISSEMENT] {k} : les pieds descendent {r["sous_les_yeux"]} px sous les yeux ; le miroir en '
                f'montre {BELOW_EYES} (recule l\'appareil ou cadre plus large).')
    errors = paquet.verifier(manifest, out)
    if errors:
        say('[ERREUR] Le paquet ne passerait pas l\'import :')
        for e in errors: say(f'   - {e}')
        return 1

    # 5. planches de contrôle
    say('5. Planches de contrôle (rendu du miroir)...')
    t0 = time.time()
    sheets = planche.tenues(manifest, out, controle, log=say)
    say(f'   {", ".join(sheets) if sheets else "aucune tenue à dessiner"} ({time.time() - t0:.0f} s)')
    if regles:
        for k in used:
            r = report[k]
            planche.regles(by_key[k], reperes[k]['eye_mid'], (r['top_low'], r['bottom_high']), k,
                           os.path.join(controle, 'regles', k + '.png'))
        say(f'   vignettes graduées : {os.path.join(controle, "regles")}')

    # 6. zip
    zip_path = os.path.join(dossier, ZIP_NAME)
    size = paquet.zipper(manifest, out, zip_path)
    if size > paquet.MAX_ZIP:
        say(f'[ERREUR] {ZIP_NAME} pèse {size / 1e6:.0f} Mo : la page Importer accepte 500 Mo au plus. Fais deux dossiers.')
        return 1
    arms = sum(1 for p in manifest['photos'].values() if p.get('arms'))
    say('')
    say(f'Paquet prêt : {zip_path} ({size / 1e6:.1f} Mo)')
    say(f'   {len(manifest["items"])} pièce(s), {len(manifest["photos"])} photo(s) dont {arms} avec les bras pliés, '
        f'en {time.time() - t_start:.0f} s.')
    say(f'Regarde d\'abord {controle} (tenues-*.jpg). Une ligne de coupe fausse se corrige dans {CORRECTIONS} '
        f'(valeurs automatiques : travail/lignes-auto.csv ; --regles pour les vignettes graduées).')
    say('Puis, dans Mon Dressing : Importer, choisis ce zip. Le tableau du PC fait foi : corrige-le ici et réimporte.')
    return 0


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(prog='fabriquer', description='Photos portées sur fond vert -> paquet d\'import de Mon Dressing.')
    ap.add_argument('dossier', nargs='?', help='dossier des photos (catalogue.csv, controle/ et le zip y sont écrits)')
    ap.add_argument('--fond', action='store_true', help='essai du fond vert seulement (controle/fond/)')
    ap.add_argument('--regles', action='store_true', help='vignettes graduées des lignes (controle/regles/)')
    ap.add_argument('--installer', action='store_true', help='télécharge et vérifie les modèles (installeur)')
    args = ap.parse_args(argv)
    if args.installer:
        return modeles.installer()
    if not args.dossier:
        ap.print_help()
        return 2
    try:
        return fabriquer(args.dossier, fond=args.fond, regles=args.regles)
    except modeles.ModeleAbsent as error:
        say(f'[ERREUR] {error}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
