@echo off
setlocal
cd /d "%~dp0nfc-daemon-python"
where python >nul 2>nul
if errorlevel 1 (
  echo Install Python 3.10+ and add it to PATH, then run this script again.
  exit /b 1
)
if not exist .venv\Scripts\python.exe (
  python -m venv .venv
  if errorlevel 1 exit /b 1
)
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 (
  echo Reader dependencies failed. Check the NFC driver and Python build tools.
  exit /b 1
)
echo Reader dependencies installed. Configure config.json using docs/SUPABASE_SETUP.md.
