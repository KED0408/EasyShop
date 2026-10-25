@echo off
cd /d "%~dp0"
node install-startup.mjs --remove
taskkill /F /IM node.exe >nul 2>&1
echo The runner has been stopped and will no longer start by itself.
pause
