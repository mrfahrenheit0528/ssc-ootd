@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-reader.ps1"
if errorlevel 1 (
  echo Installation did not complete. Review the error above.
  pause
  exit /b 1
)
pause
