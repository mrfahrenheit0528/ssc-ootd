@echo off
setlocal enabledelayedexpansion

:: ==============================================================
:: setup-windows.bat
:: One-click automated development environment setup for Windows.
:: Run this once after cloning the repo on your Windows PC.
:: ==============================================================

cd /d "%~dp0"
echo ============================================================
echo   SSC Attendance System - Windows Environment Setup
echo ============================================================
echo.

:: 1. Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in your PATH.
    echo Please install Node.js v22.12+ or v24+ from https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
node -e "const [major,minor]=process.versions.node.split('.').map(Number); process.exit((major===22 && minor>=12)||major>=24 ? 0 : 1)"
if errorlevel 1 (
    echo [ERROR] Node.js v22.12+ or v24+ is required. Found !NODE_VER!.
    pause
    exit /b 1
)
echo [OK] Found Node.js: !NODE_VER!

:: 2. Check Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in your PATH.
    echo Please install Python 3.10+ from https://www.python.org/
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('python --version') do set PY_VER=%%i
echo [OK] Found Python: !PY_VER!
echo.

:: 3. Setup Web Dashboard
echo ------------------------------------------------------------
echo [1/2] Setting up Web Dashboard (attendance-dashboard-web)...
echo ------------------------------------------------------------
cd attendance-dashboard-web
echo Installing locked npm dependencies...
call npm ci
if errorlevel 1 (
    echo [ERROR] npm ci failed.
    cd ..
    pause
    exit /b 1
)

if not exist ".env" (
    echo [NOTICE] .env not found. Copying .env.example to .env...
    copy .env.example .env >nul
    echo [ACTION REQUIRED] Please edit attendance-dashboard-web\.env with your Firebase Web credentials.
) else (
    echo [OK] .env exists.
)
cd ..
echo.

:: 4. Setup NFC Daemon
echo ------------------------------------------------------------
echo [2/2] Setting up NFC Daemon (nfc-daemon-python)...
echo ------------------------------------------------------------
cd nfc-daemon-python

if not exist ".venv\" (
    echo Creating Python virtual environment (.venv)...
    python -m venv .venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create virtual environment.
        cd ..
        pause
        exit /b 1
    )
)

echo Installing Python requirements...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip >nul 2>nul
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [WARNING] Some dependencies failed to install.
    echo If pyscard failed, ensure PC/SC or Visual C++ Redistributable is installed.
)

if not exist "config.json" (
    echo [NOTICE] config.json not found. Copying config.example.json to config.json...
    copy config.example.json config.json >nul
    echo [ACTION REQUIRED] Please edit nfc-daemon-python\config.json with your settings.
) else (
    echo [OK] config.json exists.
)

if not exist "serviceAccountKey.json" (
    echo [ACTION REQUIRED] Please place your Firebase serviceAccountKey.json into nfc-daemon-python\
) else (
    echo [OK] serviceAccountKey.json exists.
)
cd ..

echo.
echo ============================================================
echo   Setup Complete!
echo ============================================================
echo.
echo Next steps:
echo   1. Copy credentials from your Linux PC (or Firebase console):
echo      - attendance-dashboard-web\.env
echo      - nfc-daemon-python\config.json
echo      - nfc-daemon-python\serviceAccountKey.json
echo.
echo   2. To start development:
echo      - Double-click 'dev-web.bat' to launch the Web Dashboard
echo      - Double-click 'dev-daemon.bat' to run the NFC Daemon
echo.
pause
