@echo off
cd /d "%~dp0"
echo Starting GrandStay backend...
start "" http://localhost:3000/connection.html
node server\server.js
pause
