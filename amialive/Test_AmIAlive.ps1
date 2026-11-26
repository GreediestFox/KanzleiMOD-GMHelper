# Stand-in test of the watchdog on a Windows PC: "ping" plays the server, a fake bat starts it. Nothing of the real server is touched.
#   powershell -ExecutionPolicy Bypass -File Test_AmIAlive.ps1            (run AFTER Build.bat and "AmIAlive.exe selftest")
# The exe is loaded as an assembly inside PowerShell (AMIALIVE_DIR points it at the test folder), so Windows policy that blocks new exes does not matter.
param([string]$Exe = (Join-Path $PSScriptRoot 'AmIAlive.exe'))
$ErrorActionPreference = 'Stop'
$t = Join-Path $env:TEMP 'AmIAlive_test'
Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $t | Out-Null
"process=ping`r`nbat=fake.bat`r`ngrace=8`r`ninterval=2`r`nloopmax=3`r`nloopminutes=10`r`nonloop=hold`r`ncheckstarters=1`r`n" | Set-Content "$t\AmIAlive.ini" -Encoding ascii
"@echo off`r`nif `"%1`"==`"wait`" (ping -n 100 127.0.0.1 >nul & exit /b)`r`nstart `"`" /min ping -n 600 127.0.0.1 >nul`r`n" | Set-Content "$t\fake.bat" -Encoding ascii
Get-Process ping -ErrorAction SilentlyContinue | Stop-Process -Force

$job = Start-Job -ScriptBlock {
    param($asm, $dir)
    $env:AMIALIVE_DIR = $dir
    $a = [Reflection.Assembly]::LoadFile($asm)
    $a.EntryPoint.Invoke($null, @(,[string[]]@()))
} -ArgumentList $Exe, $t

function Cmd([string]$arg) {
    $env:AMIALIVE_DIR = $t
    $a = [Reflection.Assembly]::LoadFile($Exe)
    $a.EntryPoint.Invoke($null, @(,[string[]]@($arg))) | Out-Null
}
function Np { (Get-Process ping -ErrorAction SilentlyContinue | Measure-Object).Count }
$script:bad = 0
function Check([string]$name, [bool]$ok) { if ($ok) { "  ok    $name" } else { "  FAIL  $name"; $script:bad++ } }

Start-Sleep 7
Check '1 the watchdog started the server on its own' ((Np) -gt 0)

Get-Process ping | Stop-Process -Force
Start-Sleep 14
Check '2 after a kill it was started again (after the grace time)' ((Np) -gt 0)

Cmd 'restart'
Start-Sleep 2
Check '3 planned restart: exactly one process' ((Np) -eq 1)

Cmd 'kill'
Start-Sleep 1
Check '4 kill switch: process is gone' ((Np) -eq 0)
Check '4 kill switch: hold mark written' (Test-Path "$t\AmIAlive.stopped")
Start-Sleep 14
Check '4 kill switch: stays off (no restart while held)' ((Np) -eq 0)

Cmd 'release'
Start-Sleep 6
Check '5 release: the watchdog starts it again' ((Np) -gt 0)

# another starter is already running the start bat (younger than the grace time): the watchdog must wait
Cmd 'kill'
$c = Start-Process cmd -ArgumentList '/c', 'fake.bat', 'wait' -PassThru -WorkingDirectory $t -WindowStyle Hidden
Cmd 'release'
Start-Sleep 5
Check '6 another starter is active: no second start' ((Np) -eq 0)
$c | Stop-Process -Force -ErrorAction SilentlyContinue

# crash loop: kill it 3 times as soon as it shows up -> kill switch must trip
Start-Sleep 12
for ($i = 1; $i -le 3; $i++) {
    $until = (Get-Date).AddSeconds(30)
    while ((Np) -eq 0 -and (Get-Date) -lt $until) { Start-Sleep 1 }
    Start-Sleep 1
    Get-Process ping -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep 3
}
Start-Sleep 12
Check '7 crash loop: the kill switch tripped (hold mark)' (Test-Path "$t\AmIAlive.stopped")
Check '7 crash loop: the server stays off' ((Np) -eq 0)

Stop-Job $job; Remove-Job $job -Force
Get-Process ping -ErrorAction SilentlyContinue | Stop-Process -Force
''
if ($script:bad -eq 0) { 'ALL CHECKS PASSED' } else { "$($script:bad) CHECK(S) FAILED - the log follows" }
Get-Content "$t\AmIAlive.log" | Select-Object -Last 40
