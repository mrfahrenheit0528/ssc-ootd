@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-reader.ps1" -UpdateOnly
if errorlevel 1 (
  echo Update did not complete. Review the error above.
  pause
  exit /b 1
)
pause
