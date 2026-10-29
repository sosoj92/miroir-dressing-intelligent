# Repères des yeux (YuNet, OpenCV) : milieu des yeux et écart entre les yeux de chaque photo, qui
# recalent toutes les photos les unes sur les autres. Calculés sur la photo telle que la charge
# chroma.load (orientation EXIF appliquée, 1600 px de haut).
import numpy as np, cv2

SCORE_MIN = 0.7   # confiance minimale d'un visage


def eyes(rgb, model):
    """rgb : photo [0, 1] (chroma.load). Renvoie {'eye_mid': [x, y], 'eye_dist', 'score'} du plus grand
    visage, ou None si aucun visage n'est trouvé."""
    bgr = cv2.cvtColor((rgb * 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]
    det = cv2.FaceDetectorYN.create(model, '', (w, h), SCORE_MIN)
    _, faces = det.detect(bgr)
    if faces is None or len(faces) == 0:
        return None
    face = max(faces, key=lambda r: r[2] * r[3])
    re, le = face[4:6], face[6:8]  # œil droit, œil gauche (dans l'image)
    mid = (re + le) / 2
    return {'eye_mid': [float(mid[0]), float(mid[1])], 'eye_dist': float(np.linalg.norm(le - re)),
            'score': float(face[-1])}
