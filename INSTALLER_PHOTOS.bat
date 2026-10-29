@echo off
setlocal EnableExtensions
title Installation de la chaine photos de Mon Dressing
cd /d "%~dp0"
rem Installation, en double-clic, de l'outil du PC qui transforme des photos portees sur fond vert
rem en paquet d'import pour Mon Dressing (mode silhouette, scripts\assemblage\README.md) :
rem  1. uv (gestionnaire Python officiel d'Astral) via winget s'il manque ;
rem  2. Python 3.13 et les dependances aux versions exactes de scripts\assemblage\uv.lock (uv sync) ;
rem  3. une seule fois, les deux modeles dans scripts\assemblage\modeles : le detecteur de visage
rem     YuNet (OpenCV Zoo, empreinte SHA-256 verifiee) et le parseur de vetements FASHN (Hugging Face).
rem Rien d'autre n'est telecharge. Aucun compte ni aucune cle n'est demande. Aucune photo n'est envoyee.

echo.
echo ============================================================
echo       INSTALLATION DE LA CHAINE PHOTOS DE MON DRESSING
echo ============================================================
echo.

call :trouver_uv
if defined UV goto :uv_pret
where winget >nul 2>&1
if errorlevel 1 (
    echo [ERREUR] uv est absent et winget est indisponible.
    echo Installe uv depuis https://docs.astral.sh/uv/ puis relance ce fichier.
    goto :echec
)
echo uv est absent : installation avec winget ^(paquet officiel astral-sh.uv^)...
winget install --id astral-sh.uv -e --source winget --accept-source-agreements --accept-package-agreements
call :trouver_uv
if not defined UV (
    echo [ERREUR] uv vient peut-etre d'etre installe, mais Windows ne le trouve pas encore.
    echo Ferme cette fenetre puis relance INSTALLER_PHOTOS.bat.
    goto :echec
)

:uv_pret
echo [OK] uv : %UV%
echo.
set "EXTRA="
choice /C ON /N /M "Tes photos sont-elles en HEIC (iPhone) ? [O]ui/[N]on : "
if errorlevel 2 goto :sans_heic
set "EXTRA=--extra heic"
echo [OK] Les photos HEIC seront lues.
:sans_heic

echo.
echo [1/2] Python 3.13 et dependances, dont torch sans CUDA
echo       ^(environ 1 Go sur le disque, plusieurs minutes la premiere fois^)...
"%UV%" sync --project scripts\assemblage --locked %EXTRA%
if errorlevel 1 (
    echo [ERREUR] Les dependances n'ont pas pu etre installees.
    echo Verifie ta connexion Internet, puis relance ce fichier.
    goto :echec
)

echo.
echo [2/2] Modeles : detecteur de visage YuNet et parseur de vetements FASHN ^(environ 245 Mo^)...
"scripts\assemblage\.venv\Scripts\python.exe" -I scripts\assemblage\fabriquer.py --installer
if errorlevel 1 (
    echo [ERREUR] Les modeles n'ont pas pu etre installes. Relance ce fichier.
    goto :echec
)

echo.
echo ============================================================
echo Installation terminee.
echo Pour fabriquer ton paquet : glisse ton dossier de photos sur
echo scripts\assemblage\fabriquer.bat ^(mode d'emploi : scripts\assemblage\README.md^).
echo ============================================================
goto :fin

:trouver_uv
rem UV = chemin de uv.exe, ou vide. Ordre : installateur officiel d'Astral, winget, puis le PATH.
set "UV="
if exist "%USERPROFILE%\.local\bin\uv.exe" (
    set "UV=%USERPROFILE%\.local\bin\uv.exe"
    exit /b 0
)
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\uv.exe" (
    set "UV=%LOCALAPPDATA%\Microsoft\WinGet\Links\uv.exe"
    exit /b 0
)
for /f "delims=" %%i in ('where uv 2^>nul') do (
    set "UV=%%i"
    exit /b 0
)
exit /b 0

:echec
echo.
echo Installation incomplete. Corrige le point ci-dessus puis relance ce fichier.
pause
exit /b 1

:fin
pause
exit /b 0
