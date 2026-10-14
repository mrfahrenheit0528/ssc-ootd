@echo off
:: ==============================================================
:: dev-daemon.bat
:: Runs the NFC Daemon in interactive development mode (with console output)
:: using the virtual environment on Windows.
:: ==============================================================

cd /d "%~dp0nfc-daemon-python"

if not exist ".venv\" (
    echo [ERROR] Virtual environment .venv not found in nfc-daemon-python\
    echo Please run setup-windows.bat first.
    pause
    exit /b 1
)

if not exist "config.json" (
    echo [ERROR] config.json not found in nfc-daemon-python\
    echo Please copy config.example.json to config.json and fill in your values.
    pause
    exit /b 1
)

:: Activate venv and run main.py interactively
call .venv\Scripts\activate.bat
echo Starting NFC Daemon in development mode...
echo (Press Ctrl+C to stop)
echo.
python main.py
pause
