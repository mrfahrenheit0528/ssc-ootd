# Pester 3+ tests. All task/process/shortcut operations are mocked.
$workspace = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $PSScriptRoot 'install-reader.ps1'

Describe 'Office reader installer preserves existing private state' {
    BeforeEach {
        $script:originalLocal = $env:LOCALAPPDATA
        $script:fixture = Join-Path $workspace ('.local\installer-tests\' + [guid]::NewGuid().ToString())
        $script:package = Join-Path $fixture 'package'
        $env:LOCALAPPDATA = Join-Path $fixture 'profile'
        $script:installed = Join-Path $env:LOCALAPPDATA 'SSC Attendance Reader'
        New-Item -ItemType Directory -Path $package -Force | Out-Null
        foreach ($folder in @('_internal','sounds')) { New-Item -ItemType Directory -Path (Join-Path $package $folder) -Force | Out-Null }
        foreach ($name in @('SSCReader.exe','config.example.json','config.json','attendance-supabase.db','Check Reader.cmd','READ ME FIRST.md')) {
            Set-Content -LiteralPath (Join-Path $package $name) -Value ('new-' + $name)
        }
        Set-Content -LiteralPath (Join-Path $package 'office-settings.json') -Value '{"dashboard_url":""}'
        Copy-Item -LiteralPath $installer -Destination (Join-Path $package 'install-reader.ps1')
        Mock Start-Process { [pscustomobject]@{ExitCode=0} }
        Mock Get-Process { @() }
        Mock New-ScheduledTaskAction { [Microsoft.Management.Infrastructure.CimInstance]::new('MSFT_TaskAction') }
        Mock New-ScheduledTaskTrigger { [Microsoft.Management.Infrastructure.CimInstance]::new('MSFT_TaskTrigger') }
        Mock New-ScheduledTaskSettingsSet { [Microsoft.Management.Infrastructure.CimInstance]::new('MSFT_TaskSettings') }
        Mock New-ScheduledTaskPrincipal { [Microsoft.Management.Infrastructure.CimInstance]::new('MSFT_TaskPrincipal') }
        Mock Register-ScheduledTask {}
        Mock Start-ScheduledTask {}
        Mock New-Object {
            $shell = [pscustomobject]@{}
            $shell | Add-Member ScriptMethod CreateShortcut {
                param($path)
                $shortcut = [pscustomobject]@{TargetPath='';Arguments='';WorkingDirectory=''}
                $shortcut | Add-Member ScriptMethod Save {}
                return $shortcut
            }
            return $shell
        } -ParameterFilter { $ComObject -eq 'WScript.Shell' }
    }
    AfterEach { $env:LOCALAPPDATA = $script:originalLocal }

    It 'copies private state only on the first installation and registers the background task' {
        & (Join-Path $package 'install-reader.ps1')
        (Get-Content -LiteralPath (Join-Path $installed 'config.json') -Raw).Trim() | Should Be 'new-config.json'
        (Get-Content -LiteralPath (Join-Path $installed 'attendance-supabase.db') -Raw).Trim() | Should Be 'new-attendance-supabase.db'
        Assert-MockCalled Register-ScheduledTask -Times 1 -Exactly -Scope It
        Assert-MockCalled Start-ScheduledTask -Times 1 -Exactly -Scope It
    }

    It 'retains the office identity, queued attendance and logs on a repeat installation' {
        New-Item -ItemType Directory -Path (Join-Path $installed 'logs') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $installed 'config.json') -Value 'existing-private-identity'
        Set-Content -LiteralPath (Join-Path $installed 'attendance-supabase.db') -Value 'existing-pending-queue'
        Set-Content -LiteralPath (Join-Path $installed 'logs\daemon.log') -Value 'existing-log'
        & (Join-Path $package 'install-reader.ps1')
        (Get-Content -LiteralPath (Join-Path $installed 'config.json') -Raw).Trim() | Should Be 'existing-private-identity'
        (Get-Content -LiteralPath (Join-Path $installed 'attendance-supabase.db') -Raw).Trim() | Should Be 'existing-pending-queue'
        (Get-Content -LiteralPath (Join-Path $installed 'logs\daemon.log') -Raw).Trim() | Should Be 'existing-log'
    }

    It 'does not start or register attendance when local diagnostics fail' {
        Mock Start-Process { [pscustomobject]@{ExitCode=1} }
        { & (Join-Path $package 'install-reader.ps1') } | Should Throw
        Assert-MockCalled Register-ScheduledTask -Times 0 -Exactly -Scope It
        Assert-MockCalled Start-ScheduledTask -Times 0 -Exactly -Scope It
    }

    It 'requires an existing installation for an update-only package' {
        { & (Join-Path $package 'install-reader.ps1') -UpdateOnly } | Should Throw
        Assert-MockCalled Start-Process -Times 0 -Exactly -Scope It
        Assert-MockCalled Register-ScheduledTask -Times 0 -Exactly -Scope It
    }

    It 'backs up an update and preserves office sounds and the pending queue' {
        New-Item -ItemType Directory -Path (Join-Path $installed 'sounds') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $installed 'SSCReader.exe') -Value 'old-program'
        Set-Content -LiteralPath (Join-Path $installed 'config.json') -Value 'office-identity'
        Set-Content -LiteralPath (Join-Path $installed 'attendance-supabase.db') -Value 'office-pending-scans'
        Set-Content -LiteralPath (Join-Path $installed 'sounds\success.wav') -Value 'office-custom-audio'
        Set-Content -LiteralPath (Join-Path $package 'sounds\success.wav') -Value 'package-audio'
        & (Join-Path $package 'install-reader.ps1') -UpdateOnly
        (Get-Content -LiteralPath (Join-Path $installed 'sounds\success.wav') -Raw).Trim() | Should Be 'office-custom-audio'
        (Get-Content -LiteralPath (Join-Path $installed 'attendance-supabase.db') -Raw).Trim() | Should Be 'office-pending-scans'
        $backup = @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'SSC Reader Backups') -Directory)
        $backup.Count | Should Be 1
        (Get-Content -LiteralPath (Join-Path $backup[0].FullName 'SSCReader.exe') -Raw).Trim() | Should Be 'old-program'
        (Get-Content -LiteralPath (Join-Path $backup[0].FullName 'config.json') -Raw).Trim() | Should Be 'office-identity'
    }
}
