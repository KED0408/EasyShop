@echo off
title EasyShop - start automatically
cd /d "%~dp0"
node install-startup.mjs
echo.
echo The runner is now running in the background (minimised) and will start by itself
echo every time you sign in to Windows. Use the app buttons as normal.
echo.
pause
