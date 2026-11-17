@echo off
rem Buchlover starten (oeffnet den Browser auf http://127.0.0.1:8765/)
cd /d "%~dp0"
where py >nul 2>nul && (py -3 -m buchlover %*) || (python -m buchlover %*)
if errorlevel 1 pause
