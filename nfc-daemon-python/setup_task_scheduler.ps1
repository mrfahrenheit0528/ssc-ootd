# ==============================================================
# setup_task_scheduler.ps1
# Registers the NFC Attendance Daemon to start automatically
# on user login via Windows Task Scheduler.
#
# Run ONCE as the logged-in user (no Administrator required).
# Right-click → "Run with PowerShell" OR:
#   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
#   .\setup_task_scheduler.ps1
# ==============================================================

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$BatPath    = Join-Path $ScriptDir "start_daemon.bat"
$TaskName   = "SSC_NFC_Attendance_Daemon"

# ── Validate bat file exists ──────────────────────────────────────────────────
if (-not (Test-Path $BatPath)) {
    Write-Error "start_daemon.bat not found at: $BatPath"
    exit 1
}

Write-Host "Registering Task Scheduler job: $TaskName" -ForegroundColor Cyan
Write-Host "Bat path: $BatPath"

# ── Remove old registration if it exists ─────────────────────────────────────
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# ── Build the task ────────────────────────────────────────────────────────────
# Trigger: At log on of the current user
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Action: Run cmd.exe /c start_daemon.bat (hidden)
$action  = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$BatPath`"" `
    -WorkingDirectory $ScriptDir

# Settings: No time limit, allow running on battery, hidden
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -Hidden

# Principal: Run as current user, only when logged in
$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

# ── Register ──────────────────────────────────────────────────────────────────
Register-ScheduledTask `
    -TaskName  $TaskName `
    -Trigger   $trigger `
    -Action    $action `
    -Settings  $settings `
    -Principal $principal `
    -Force | Out-Null

Write-Host ""
Write-Host "✅  Task '$TaskName' registered successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "The daemon will start automatically the next time you log in." -ForegroundColor Gray
Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Cyan
Write-Host "  Start now:   Start-ScheduledTask  -TaskName '$TaskName'"
Write-Host "  Stop:        Stop-ScheduledTask   -TaskName '$TaskName'"
Write-Host "  Remove:      Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
Write-Host "  View status: Get-ScheduledTask    -TaskName '$TaskName' | Select-Object *"
Write-Host ""

# ── Optional: start immediately ───────────────────────────────────────────────
$start = Read-Host "Start the daemon now? [Y/n]"
if ($start -ne 'n' -and $start -ne 'N') {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Daemon started. Check logs\daemon.log for output." -ForegroundColor Green
}
