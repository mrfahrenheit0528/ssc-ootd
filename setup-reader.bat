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
.venv\Scripts\python.exe -m pip install --only-binary=pyscard -r requirements.txt
if errorlevel 1 (
  echo Reader dependency installation failed.
  echo This Windows setup uses a prebuilt pyscard package, without SWIG or C++ build tools.
  echo Check internet access and use a supported CPython version, such as Python 3.12 64-bit.
  echo If the virtual environment uses another Python version, see docs/SUPABASE_SETUP.md.
  exit /b 1
)
.venv\Scripts\python.exe -c "from smartcard.System import readers; from smartcard.scard import SCardEstablishContext"
if errorlevel 1 (
  echo The smart-card Python module could not load. See docs/SUPABASE_SETUP.md.
  exit /b 1
)
echo Reader dependencies installed. Configure config.json using docs/SUPABASE_SETUP.md.
