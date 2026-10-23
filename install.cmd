@echo off
rem One-time setup: config, packages, desktop shortcut, firewall rule.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
echo.
pause
