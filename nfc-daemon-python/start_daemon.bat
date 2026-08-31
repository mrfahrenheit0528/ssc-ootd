@echo off
:: ============================================================
:: start_daemon.bat
:: Launches the NFC Attendance Daemon silently in the background
:: using pythonw.exe (no console window).
::
:: Place this file in nfc-daemon-python\
:: ============================================================

:: Move to the script's own directory so relative paths work
cd /d "%~dp0"

:: Activate virtual environment (adjust path if you used a different venv name)
set VENV_PYTHON=.venv\Scripts\pythonw.exe

:: Check venv exists
if not exist "%VENV_PYTHON%" (
    echo [ERROR] Virtual environment not found at %VENV_PYTHON%
    echo Run: python -m venv .venv ^&^& .venv\Scripts\activate ^&^& pip install -r requirements.txt
    pause
    exit /b 1
)

:: Check config exists
if not exist "config.json" (
    echo [ERROR] config.json not found. Copy config.example.json to config.json and fill in your values.
    pause
    exit /b 1
)

:: Create logs directory if missing
if not exist "logs" mkdir logs

:: Launch the daemon silently — output goes to logs\daemon.log
:: The start "" /min trick is NOT used here because pythonw.exe has no console at all.
"%VENV_PYTHON%" main.py >> "logs\daemon.log" 2>&1
