#!/usr/bin/env bash
# Fabrique le paquet d'import à partir d'un dossier de photos portées sur fond vert (README.md).
#   scripts/assemblage/fabriquer.sh "<dossier des photos>" [--regles] [--fond]
# La même commande, relancée, fait l'étape suivante (tableau à remplir, puis le zip).
# Mac et Linux : non testés (la chaîne est testée sous Windows avec fabriquer.bat).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="$HERE/.venv/bin/python"
[ -x "$PY" ] || PY="$HERE/.venv/Scripts/python.exe"   # Git Bash sous Windows
if [ ! -x "$PY" ]; then
    echo "[ERREUR] La chaîne photos n'est pas installée : lance d'abord bash installer_photos.sh, à la racine du projet."
    exit 1
fi
if [ $# -lt 1 ]; then
    echo "Usage : bash scripts/assemblage/fabriquer.sh \"<dossier des photos>\" [--regles] [--fond]"
    exit 2
fi
exec "$PY" -I "$HERE/fabriquer.py" "$@"
