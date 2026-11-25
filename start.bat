@echo off
title Tank Wars Server
cd /d "%~dp0"
if not exist node_modules\qrcode call npm install
node server.js
echo.
echo The server stopped. Read any error message above.
pause
