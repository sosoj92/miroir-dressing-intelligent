#!/usr/bin/env bash
# Installation de la chaîne photos de Mon Dressing sur Mac (Apple Silicon) ou Linux : l'équivalent
# d'INSTALLER_PHOTOS.bat (scripts/assemblage/README.md).
#   1. uv (gestionnaire Python officiel d'Astral) s'il manque, avec son script d'installation officiel ;
#   2. Python 3.13 et les dépendances aux versions exactes de scripts/assemblage/uv.lock (uv sync) ;
#   3. une seule fois, les deux modèles dans scripts/assemblage/modeles : le détecteur de visage YuNet
#      (OpenCV Zoo, empreinte SHA-256 vérifiée) et le parseur de vêtements FASHN (Hugging Face).
# Rien d'autre n'est téléchargé. Aucun compte ni aucune clé n'est demandé. Aucune photo n'est envoyée.
# NON TESTÉ sur Mac et Linux : la chaîne est testée sous Windows. Mac Intel : non pris en charge
# (torch n'existe plus pour ce processeur).
set -euo pipefail
cd "$(dirname "$0")"

echo
echo "============================================================"
echo "      INSTALLATION DE LA CHAÎNE PHOTOS DE MON DRESSING"
echo "============================================================"
echo

if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "x86_64" ]; then
    echo "[ERREUR] Mac Intel : torch (le moteur du parseur de vêtements) n'existe plus pour ce processeur."
    echo "Utilise un Mac Apple Silicon, un PC Windows ou Linux."
    exit 1
fi

find_uv() {
    if command -v uv >/dev/null 2>&1; then command -v uv; return; fi
    for candidate in "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv"; do
        if [ -x "$candidate" ]; then echo "$candidate"; return; fi
    done
}

UV="$(find_uv || true)"
if [ -z "$UV" ]; then
    echo "uv est absent. Il s'installe avec le script officiel d'Astral (https://astral.sh/uv/install.sh)."
    read -r -p "L'installer maintenant ? [o/N] : " answer
    case "$answer" in
        [oO]*) curl -LsSf https://astral.sh/uv/install.sh | sh ;;
        *) echo "Installe uv (https://docs.astral.sh/uv/) puis relance ce fichier."; exit 1 ;;
    esac
    UV="$(find_uv || true)"
    if [ -z "$UV" ]; then
        echo "[ERREUR] uv vient peut-être d'être installé, mais il est introuvable. Ouvre un nouveau terminal et relance."
        exit 1
    fi
fi
echo "[OK] uv : $UV"
echo

EXTRA=()
read -r -p "Tes photos sont-elles en HEIC (iPhone) ? [o/N] : " heic
case "$heic" in
    [oO]*) EXTRA=(--extra heic); echo "[OK] Les photos HEIC seront lues." ;;
esac

echo
echo "[1/2] Python 3.13 et dépendances, dont torch (environ 1 Go, plusieurs minutes la première fois)..."
if ! "$UV" sync --project scripts/assemblage --locked ${EXTRA[@]+"${EXTRA[@]}"}; then
    echo "[ERREUR] Les dépendances n'ont pas pu être installées. Vérifie ta connexion Internet, puis relance."
    exit 1
fi

PY="scripts/assemblage/.venv/bin/python"
[ -x "$PY" ] || PY="scripts/assemblage/.venv/Scripts/python.exe"   # Git Bash sous Windows
echo
echo "[2/2] Modèles : détecteur de visage YuNet et parseur de vêtements FASHN (environ 245 Mo)..."
if ! "$PY" -I scripts/assemblage/fabriquer.py --installer; then
    echo "[ERREUR] Les modèles n'ont pas pu être installés. Relance ce fichier."
    exit 1
fi

echo
echo "============================================================"
echo "Installation terminée."
echo "Pour fabriquer ton paquet : bash scripts/assemblage/fabriquer.sh \"<dossier des photos>\""
echo "(mode d'emploi : scripts/assemblage/README.md)."
echo "============================================================"
