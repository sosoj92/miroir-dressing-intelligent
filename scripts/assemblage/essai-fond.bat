@echo off
setlocal EnableExtensions
title Mon Dressing - essai du fond vert
rem Essai du fond vert avant de tout photographier (README.md, option --fond) : glisse sur ce fichier
rem un dossier de 2 ou 3 photos d'essai. Il ecrit controle\fond\<cle>.jpg (le sujet detoure sur fond
rem noir) dans ce dossier et ne fabrique rien d'autre. Meme chose que : fabriquer.bat "<dossier>" --fond
set "DOSSIER=%~1"
if not "%DOSSIER%"=="" goto :lancer
echo Glisse ton dossier de photos d'essai sur essai-fond.bat, ou colle son chemin ici.
set /p "DOSSIER=Dossier des photos : "
if not defined DOSSIER goto :vide
set "DOSSIER=%DOSSIER:"=%"
if "%DOSSIER%"=="" goto :vide

:lancer
call "%~dp0fabriquer.bat" "%DOSSIER%" --fond
exit /b %errorlevel%

:vide
echo Aucun dossier choisi.
pause
exit /b 1
