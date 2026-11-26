# Creates the R2 bucket, the 30 day rule, the two secrets and deploys the worker "amialive-crash-receiver".
# Run once in this folder:   powershell -ExecutionPolicy Bypass -File Deploy_Crash_Receiver.ps1
# Needs Node.js and a login to your Cloudflare account (the first wrangler call opens the browser).
# The two tokens are read from  crash-receiver-secrets.txt  (UPLOAD_TOKEN=... / ADMIN_TOKEN=...), a private file that is NOT in git.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$secretsFile = Join-Path $PSScriptRoot 'crash-receiver-secrets.txt'
if (-not (Test-Path $secretsFile)) { throw "crash-receiver-secrets.txt not found next to this script." }
$sec = @{}
Get-Content $secretsFile | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)\s*=\s*(\S+)\s*$') { $sec[$Matches[1]] = $Matches[2] } }
foreach ($k in 'UPLOAD_TOKEN', 'ADMIN_TOKEN') { if (-not $sec[$k]) { throw "$k missing in crash-receiver-secrets.txt" } }

if (-not (Test-Path node_modules)) { npm install }
Write-Host '1) bucket'
try { npx wrangler r2 bucket create amialive-crash } catch { Write-Warning 'bucket exists already (fine) or could not be created: check the message above' }
Write-Host '2) 30 day rule (everything under crash/ is deleted after 30 days)'
try { npx wrangler r2 bucket lifecycle add amialive-crash expire-30d crash/ --expire-days 30 } catch { Write-Warning 'lifecycle rule not set (maybe it exists, or your wrangler is older): the worker deletes old reports daily anyway' }
Write-Host '3) secrets (written without a trailing newline)'
foreach ($k in 'UPLOAD_TOKEN', 'ADMIN_TOKEN') { cmd /c "<nul set /p=$($sec[$k])| npx wrangler secret put $k" }
Write-Host '4) deploy'
npx wrangler deploy
Write-Host ''
Write-Host 'Done. Test from the server folder:  AmIAlive.exe report   (it must print: uploaded crash/...)'
