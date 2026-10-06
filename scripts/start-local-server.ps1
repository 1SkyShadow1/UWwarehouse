$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dataRoot = Join-Path $root "data"
$storageConfig = Join-Path $root 'local-storage.json'
if (Test-Path -LiteralPath $storageConfig) {
  $localConfig=Get-Content -LiteralPath $storageConfig -Raw | ConvertFrom-Json
  if ($localConfig.localOnly) {
    if (-not (Test-Path -LiteralPath ([IO.Path]::GetPathRoot($localConfig.dataRoot)))) { throw 'Connect the external data drive before starting the app.' }
    $dataRoot=$localConfig.dataRoot
  }
}
$logRoot = Join-Path $dataRoot "logs"
$logFile = Join-Path $logRoot "server.log"
$maxLogBytes = 5MB

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$nodePath = (Get-Command node -ErrorAction Stop).Source
$env:HOST = "127.0.0.1"
$env:PORT = "8080"
$env:UW_DATA_DIR = $dataRoot
$env:UW_DOCUMENTS_DIR = Join-Path $dataRoot "documents"
$env:UW_SOURCE_DIR = "D:\UW"
$env:UW_SOURCE_DIRS = "D:\UW FOREVER"
$env:UW_INVOICES_DIR = "D:\UW FOREVER\Saved Invoices"
$env:UW_QUOTES_DIR = "D:\UW FOREVER\Saved Quotes"
Set-Location $root

# Launch once per service start, after health succeeds. The helper and desktop
# shortcut coordinate so restarting the server cannot create duplicate tabs.
$appLauncher = Join-Path $PSScriptRoot 'launch-local-app.ps1'
if (Test-Path -LiteralPath $appLauncher) {
  $helperArgs = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $appLauncher
  Start-Process -FilePath 'powershell.exe' -ArgumentList $helperArgs -WindowStyle Hidden
}

while ($true) {
  if ((Test-Path $logFile) -and (Get-Item $logFile).Length -ge $maxLogBytes) {
    Move-Item -Path $logFile -Destination "$logFile.1" -Force
  }
  $startLine = "[$(Get-Date -Format o)] Starting UW Accounting server."
  [System.IO.File]::AppendAllText($logFile, "`r`n$startLine`r`n", $utf8NoBom)
  $command = '"{0}" "{1}" >> "{2}" 2>&1' -f $nodePath, (Join-Path $root "server.js"), $logFile
  & $env:ComSpec /d /c $command
  $exitCode = $LASTEXITCODE
  [System.IO.File]::AppendAllText($logFile, "[$(Get-Date -Format o)] Server stopped with exit code $exitCode; restarting in 5 seconds.`r`n", $utf8NoBom)
  Start-Sleep -Seconds 5
}
