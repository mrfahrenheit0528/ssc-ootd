@echo off
:: ==============================================================
:: dev-web.bat
:: Starts the Web Dashboard dev server on Windows (http://localhost:5173).
:: ==============================================================

cd /d "%~dp0attendance-dashboard-web"

if not exist "node_modules\" (
    echo [NOTICE] node_modules not found. Installing dependencies...
    call npm install
)

if not exist ".env" (
    echo [WARNING] .env file not found in attendance-dashboard-web\
    echo Please copy .env.example to .env and configure your Firebase credentials.
    pause
)

echo Starting Web Dashboard development server...
echo Press Ctrl+C to stop.
echo.
call npm run dev
pause
