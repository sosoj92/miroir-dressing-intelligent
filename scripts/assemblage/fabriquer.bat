@echo off
setlocal EnableExtensions
title Mon Dressing - paquet de photos
rem Fabrique le paquet d'import a partir d'un dossier de photos portees sur fond vert (README.md).
rem Glisse le dossier sur ce fichier, ou : fabriquer.bat "C:\chemin\du\dossier" [--regles] [--fond]
rem La meme commande, relancee, fait l'etape suivante (tableau a remplir, puis le zip).
set "PY=%~dp0.venv\Scripts\python.exe"
set "RC=1"
if not exist "%PY%" (
    echo [ERREUR] La chaine photos n'est pas installee : lance d'abord INSTALLER_PHOTOS.bat,
    echo a la racine du projet.
    goto :fin
)
set "DOSSIER=%~1"
if not "%DOSSIER%"=="" goto :sans_barre
echo Glisse ton dossier de photos sur fabriquer.bat, ou colle son chemin ici.
set /p "DOSSIER=Dossier des photos : "
set "DOSSIER=%DOSSIER:"=%"

:sans_barre
rem une barre finale fermerait mal les guillemets ("C:\dossier\")
if "%DOSSIER%"=="" goto :fin
if not "%DOSSIER:~-1%"=="\" goto :lancer
set "DOSSIER=%DOSSIER:~0,-1%"
goto :sans_barre

:lancer
"%PY%" -I "%~dp0fabriquer.py" "%DOSSIER%" %2 %3 %4
set "RC=%errorlevel%"

:fin
echo.
pause
exit /b %RC%
