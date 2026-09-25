@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org then run this again. & pause & exit /b 1)
if not exist node_modules\pdfjs-dist\package.json call npm install
node src\server.js --open
pause
