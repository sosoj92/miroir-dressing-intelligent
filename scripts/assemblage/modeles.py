# Les deux modèles de la chaîne, téléchargés UNE fois par l'installeur (INSTALLER_PHOTOS.bat,
# installer_photos.sh) dans modeles/ (jamais dans git), puis utilisés hors ligne :
#   - YuNet (OpenCV Zoo, licence MIT) : détecteur de visage, pour le milieu des yeux ;
#   - FASHN Human Parser (Hugging Face, sans compte) : classes du corps et des vêtements, pour les
#     lignes, les manches et les bras pliés. Licence NVIDIA Source Code License for SegFormer :
#     usage non commercial seulement (recherche ou évaluation).
# Versions figées : commit d'OpenCV Zoo avec l'empreinte SHA-256 du fichier, révision Hugging Face.
# Rien d'autre n'est téléchargé, et aucune photo ne quitte le PC.
import hashlib, os, ssl, sys, urllib.request

# Messages des bibliothèques qui ne concernent pas la personne : pas de compte Hugging Face à créer,
# liens symboliques facultatifs sous Windows, moteur d'OpenCV 5. À poser avant leur import.
os.environ.setdefault('HF_HUB_DISABLE_SYMLINKS_WARNING', '1')
os.environ.setdefault('OPENCV_LOG_LEVEL', 'ERROR')

HERE = os.path.dirname(os.path.abspath(__file__))
DOSSIER = os.path.join(HERE, 'modeles')

YUNET = os.path.join(DOSSIER, 'face_detection_yunet_2023mar.onnx')
YUNET_URL = ('https://github.com/opencv/opencv_zoo/raw/f12e12798e8314f7c074a6656816c048dcc95b7a/'
             'models/face_detection_yunet/face_detection_yunet_2023mar.onnx')
YUNET_SHA256 = '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'

FASHN_REPO = 'fashn-ai/fashn-human-parser'
FASHN_REVISION = '1f80c34dbab321c5730dda5c3fea279fd3e97498'
FASHN_FILES = ['config.json', 'model.safetensors']
FASHN_CACHE = os.path.join(DOSSIER, 'fashn')

INSTALLER = ('lance INSTALLER_PHOTOS.bat (Windows) ou installer_photos.sh (Mac, Linux), '
             'à la racine du projet, puis recommence')


class ModeleAbsent(RuntimeError):
    """Un modèle manque : l'installeur ne l'a pas (encore) téléchargé."""


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''): h.update(chunk)
    return h.hexdigest()


def yunet():
    """Chemin du détecteur de visage, vérifié par son empreinte."""
    if not os.path.exists(YUNET) or sha256(YUNET) != YUNET_SHA256:
        raise ModeleAbsent(f'Détecteur de visage YuNet absent ou abîmé : {INSTALLER}.')
    return YUNET


def fashn_dir():
    """Dossier local du parseur (révision figée), ou None s'il n'est pas téléchargé."""
    snap = os.path.join(FASHN_CACHE, 'models--' + FASHN_REPO.replace('/', '--'), 'snapshots', FASHN_REVISION)
    return snap if all(os.path.exists(os.path.join(snap, f)) for f in FASHN_FILES) else None


_parser = None

def fashn():
    """Parseur FASHN chargé depuis modeles/ : hors ligne seulement parce qu'il est là ; sinon un
    message qui dit de lancer l'installeur (aucun téléchargement pendant la fabrication)."""
    global _parser
    if _parser is None:
        snap = fashn_dir()
        if snap is None:
            raise ModeleAbsent(f'Parseur de vêtements FASHN absent : {INSTALLER}.')
        # Le modèle est sur le disque : Hugging Face n'a rien à demander au réseau. À poser avant
        # d'importer transformers, qui lit ces variables à son import.
        os.environ['HF_HUB_OFFLINE'] = '1'
        os.environ['TRANSFORMERS_OFFLINE'] = '1'
        try:
            from fashn_human_parser import FashnHumanParser
            from transformers.utils import logging as hf_logging
        except ImportError as error:
            raise ModeleAbsent(f'Bibliothèques Python absentes : {INSTALLER}.') from error
        hf_logging.disable_progress_bar()
        hf_logging.set_verbosity_error()
        _parser = FashnHumanParser(model_id=snap, device='cpu')
    return _parser


def _ssl_context():
    """Certificats du système (truststore, installé avec huggingface_hub), sinon ceux de Python."""
    try:
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception:
        return ssl.create_default_context()


def installer():
    """Télécharge ce qui manque, vérifie, puis charge les deux modèles hors ligne. Renvoie 0 si tout va bien."""
    os.makedirs(DOSSIER, exist_ok=True)
    # 1. YuNet : fichier unique, contrôlé par son empreinte avant d'être mis en place
    if os.path.exists(YUNET) and sha256(YUNET) == YUNET_SHA256:
        print('[OK] Détecteur de visage YuNet déjà présent.')
    else:
        print('Téléchargement du détecteur de visage YuNet (230 Ko, OpenCV Zoo)...', flush=True)
        part = YUNET + '.part'
        try:
            with urllib.request.urlopen(YUNET_URL, context=_ssl_context(), timeout=60) as r, open(part, 'wb') as f:
                f.write(r.read())
        except OSError as error:
            print(f'[ERREUR] Téléchargement impossible ({error}). Vérifie ta connexion Internet.')
            return 1
        if sha256(part) != YUNET_SHA256:
            os.remove(part)
            print('[ERREUR] Le fichier téléchargé ne correspond pas à l\'empreinte attendue : il est refusé.')
            return 1
        os.replace(part, YUNET)
        print('[OK] Détecteur de visage YuNet : empreinte SHA-256 vérifiée.')
    # 2. FASHN : premier et seul téléchargement en ligne (environ 245 Mo)
    if fashn_dir():
        print('[OK] Parseur de vêtements FASHN déjà présent.')
    else:
        print('Téléchargement du parseur de vêtements FASHN (environ 245 Mo, Hugging Face, une seule fois)...', flush=True)
        try:
            from huggingface_hub import snapshot_download
            from huggingface_hub.utils import disable_progress_bars, logging as hub_logging
            hub_logging.set_verbosity_error()   # « HF_TOKEN » conseillé : inutile, le modèle est public
            disable_progress_bars()             # « Fetching 2 files: 0%|… » : notre message suffit
            snapshot_download(FASHN_REPO, revision=FASHN_REVISION, cache_dir=FASHN_CACHE, allow_patterns=FASHN_FILES)
        except Exception as error:
            print(f'[ERREUR] Téléchargement impossible ({type(error).__name__} : {error}). Vérifie ta connexion Internet.')
            return 1
        if not fashn_dir():
            print('[ERREUR] Le parseur FASHN est incomplet après le téléchargement. Relance l\'installeur.')
            return 1
        print('[OK] Parseur de vêtements FASHN téléchargé.')
    # 3. Essai hors ligne des deux modèles
    import numpy as np, cv2
    cv2.FaceDetectorYN.create(yunet(), '', (320, 320), 0.7)
    seg = fashn().predict(np.zeros((96, 64, 3), np.uint8))
    if seg.shape != (96, 64):
        print('[ERREUR] Le parseur FASHN ne répond pas comme prévu.')
        return 1
    print('[OK] Les deux modèles se chargent hors ligne.')
    print('Licences : YuNet MIT (OpenCV Zoo) ; FASHN Human Parser sous NVIDIA Source Code License for SegFormer,')
    print('           usage non commercial seulement (recherche ou évaluation).')
    return 0


if __name__ == '__main__':
    sys.exit(installer())
