@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.13+ or 24+ for dashboard development.
  exit /b 1
)
where python >nul 2>nul
if errorlevel 1 (
  echo Install Python 3.10+ and add it to PATH.
  exit /b 1
)
cd attendance-dashboard-web
call npm ci
if errorlevel 1 exit /b 1
if not exist .env copy .env.example .env >nul
cd ..
call setup-reader.bat
if errorlevel 1 exit /b 1
echo Development dependencies installed.
echo Follow docs/SUPABASE_SETUP.md to create the database and configure accounts.
echo Put your Supabase project URL and publishable key in attendance-dashboard-web\.env.
echo Launch the dashboard with dev-web.bat and the reader with dev-daemon.bat.
