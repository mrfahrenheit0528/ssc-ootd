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
}
