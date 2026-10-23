@echo off
rem Update this copy from GitHub and restart it (production copy).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update.ps1"
echo.
pause
