$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dataRoot = Join-Path $root "data"
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
Set-Location $root

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
