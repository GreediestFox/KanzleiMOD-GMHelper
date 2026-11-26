# Installs AmIAlive as the watchdog of the LiF server (run once, as Administrator, from the server folder).
# - scheduled task "AmIAlive": starts AmIAlive.exe at every boot (SYSTEM, no window, restarts itself if it ever exits)
# - the old task "LiF Server" (boot + every 5 min) is removed: AmIAlive takes over its job
# - optional desktop shortcut "AmIAlive screen": opens the live screen (a second AmIAlive.exe is only a viewer of the one the task runs)
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$exe = Join-Path $dir 'AmIAlive.exe'
foreach ($f in 'AmIAlive.exe', 'Start_LiF_Server_VPS.bat', 'ddctd_cm_yo_server.exe') { if (-not (Test-Path (Join-Path $dir $f))) { throw "$f not found in $dir (run this from the server folder)." } }
if (-not (Test-Path (Join-Path $dir 'AmIAlive.ini'))) { Write-Warning 'No AmIAlive.ini yet: defaults are used (no Discord, no crash reports). Copy AmIAlive.example.ini to AmIAlive.ini and edit it.' }
Get-ChildItem $dir -File | Unblock-File
try { Add-MpPreference -ExclusionPath $dir; Add-MpPreference -ExclusionProcess 'AmIAlive.exe' } catch { Write-Warning 'Defender exclusion not set' }

if (Get-ScheduledTask -TaskName 'LiF Server' -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName 'LiF Server' -Confirm:$false
    Write-Host 'Old task "LiF Server" removed'
}
Get-Process AmIAlive -ErrorAction SilentlyContinue | Stop-Process -Force

$action    = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $dir
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'AmIAlive' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'AmIAlive'

# desktop shortcut for the live screen (works for the current user; "Run as administrator" gives the full numbers of the server process)
try {
    $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'AmIAlive screen.lnk'
    $w = New-Object -ComObject WScript.Shell
    $s = $w.CreateShortcut($lnk); $s.TargetPath = $exe; $s.WorkingDirectory = $dir; $s.Description = 'AmIAlive live screen'; $s.Save()
    Write-Host "Shortcut: $lnk"
} catch { Write-Warning 'Shortcut not created' }

Write-Host ''
Write-Host 'Task "AmIAlive" created and started. It watches the server and starts it when it is not running and nobody else is starting it.'
Write-Host 'Live screen: double click the shortcut, or run  .\AmIAlive.exe  (keys: K kill switch, R restart, T stop, S release, U crash report, D discord test, Q quit)'
Write-Host 'In the server folder:'
Write-Host '  .\AmIAlive.exe status | restart | stop | release | kill | report | discord | selftest'
Write-Host 'Log: AmIAlive.log in the server folder.'
