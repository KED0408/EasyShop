@echo off
title EasyShop runner
cd /d "%~dp0"
echo Starting the EasyShop runner. Leave this window open while it works.
echo To stop it, close this window.
echo.
node runner.mjs
echo.
pause
