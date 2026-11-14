@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -Command "$app = Join-Path (Get-Location) 'SSCReader.exe'; $report = Join-Path (Get-Location) 'diagnostics.json'; $process = Start-Process -FilePath $app -ArgumentList @('--check','--report','diagnostics.json') -WindowStyle Hidden -Wait -PassThru; if (Test-Path -LiteralPath $report) { Get-Content -LiteralPath $report }; exit $process.ExitCode"
pause
