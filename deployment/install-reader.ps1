param([string]$DashboardUrl = '')
$ErrorActionPreference = 'Stop'
$packageDir = $PSScriptRoot
$installDir = Join-Path $env:LOCALAPPDATA 'SSC Attendance Reader'
$exe = Join-Path $installDir 'SSCReader.exe'
$taskName = 'SSC_NFC_Attendance_Daemon'

if (-not [Environment]::Is64BitOperatingSystem) { throw 'This package requires 64-bit Windows.' }
if (-not (Test-Path -LiteralPath (Join-Path $packageDir 'SSCReader.exe'))) { throw 'Extract the complete ZIP before running the installer.' }
if (-not (Test-Path -LiteralPath (Join-Path $packageDir 'config.json')) -and -not (Test-Path -LiteralPath (Join-Path $installDir 'config.json'))) {
    throw 'The private registered config.json is missing. Use the prepared private office package.'
}
if (([IO.Path]::GetFullPath($packageDir)).TrimEnd('\') -eq ([IO.Path]::GetFullPath($installDir)).TrimEnd('\')) {
    throw 'Run this installer from the extracted handoff folder, not from the installed application folder.'
}

# Request a graceful stop only for an already installed executable.
if (Test-Path -LiteralPath $exe) {
    Start-Process -FilePath $exe -ArgumentList '--stop' -WindowStyle Hidden -Wait
    $deadline = (Get-Date).AddSeconds(40)
    do {
        $running = @(Get-Process -Name SSCReader -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
        if ($running.Count -eq 0) { break }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
    if ($running.Count) { throw 'The previous reader is still stopping. Wait, then rerun this installer.' }
}

New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $packageDir 'SSCReader.exe') -Destination $exe -Force
foreach ($directory in @('_internal', 'sounds')) {
    Copy-Item -LiteralPath (Join-Path $packageDir $directory) -Destination $installDir -Recurse -Force
}
foreach ($name in @('config.example.json', 'Check Reader.cmd', 'READ ME FIRST.md')) {
    Copy-Item -LiteralPath (Join-Path $packageDir $name) -Destination (Join-Path $installDir $name) -Force
}
# Never overwrite the office computer's identity, queue, cached roster, or logs.
foreach ($name in @('config.json', 'attendance-supabase.db', 'office-settings.json')) {
    $source = Join-Path $packageDir $name
    $target = Join-Path $installDir $name
    if ((Test-Path -LiteralPath $source) -and -not (Test-Path -LiteralPath $target)) { Copy-Item -LiteralPath $source -Destination $target }
}

$reportPath = Join-Path $installDir 'diagnostics.json'
$check = Start-Process -FilePath $exe -ArgumentList @('--check', '--report', 'diagnostics.json') -WorkingDirectory $installDir -WindowStyle Hidden -Wait -PassThru
if ($check.ExitCode -ne 0) { throw "Reader checks failed. Open $reportPath and fix the listed issue before retrying." }

$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $installDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
foreach ($item in @(@('Start SSC Reader', ''), @('Stop SSC Reader', '--stop'))) {
    $shortcut = $shell.CreateShortcut((Join-Path $desktop ($item[0] + '.lnk')))
    $shortcut.TargetPath = $exe
    $shortcut.Arguments = $item[1]
    $shortcut.WorkingDirectory = $installDir
    $shortcut.Save()
}
if (-not $DashboardUrl) {
    $settingsFile = Join-Path $installDir 'office-settings.json'
    if (Test-Path -LiteralPath $settingsFile) { $DashboardUrl = (Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json).dashboard_url }
}
if ($DashboardUrl) {
    $uri = $null
    if (-not [Uri]::TryCreate($DashboardUrl, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https') { throw 'The dashboard shortcut needs a valid HTTPS URL.' }
    $shortcut = $shell.CreateShortcut((Join-Path $desktop 'SSC Attendance Dashboard.url'))
    $shortcut.TargetPath = $DashboardUrl
    $shortcut.Save()
}
Start-ScheduledTask -TaskName $taskName
Write-Host "Installed to $installDir" -ForegroundColor Green
Write-Host 'The reader starts now and at Windows sign-in. Plug in the ACR122U and keep the PC awake.'
Write-Host 'Existing office configuration and attendance files were preserved. No cloud database reset was performed.'
