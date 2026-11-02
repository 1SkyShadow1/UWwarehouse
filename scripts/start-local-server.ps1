$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dataRoot = Join-Path $root "data"
$storageConfig = Join-Path $root 'local-storage.json'
if (Test-Path -LiteralPath $storageConfig) {
  $localConfig = Get-Content -LiteralPath $storageConfig -Raw | ConvertFrom-Json
  if ($localConfig.localOnly) {
    $dataDrive = [IO.Path]::GetPathRoot([string]$localConfig.dataRoot)
    if (-not (Test-Path -LiteralPath $dataDrive)) {
      throw "The configured accounting drive is unavailable: $dataDrive"
    }
    $dataRoot = $localConfig.dataRoot
  }
}
$logRoot = Join-Path $dataRoot "logs"
$logFile = Join-Path $logRoot "server.log"
$maxLogBytes = 5MB
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$healthUrl = "http://127.0.0.1:8080/api/health"
$profileUrl = "http://127.0.0.1:8080/api/auth/config"
$startupTimeout = [TimeSpan]::FromSeconds(90)
$unhealthyLimit = 3
$script:lastReadinessError = "No response from the local API."

function Rotate-ServerLog {
  if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -ge $maxLogBytes) {
    Move-Item -LiteralPath $logFile -Destination "$logFile.1" -Force
  }
}

function Write-ServerLog([string]$message) {
  [IO.File]::AppendAllText($logFile, "[$(Get-Date -Format o)] $message`r`n", $utf8NoBom)
}

function Test-LocalAppReady {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.ok -ne $true) {
      $script:lastReadinessError = "The health endpoint did not report ready."
      return $false
    }
    $profiles = Invoke-RestMethod -Uri $profileUrl -TimeoutSec 3
    if (($profiles.PSObject.Properties.Name -contains 'configured') -and
        ($profiles.PSObject.Properties.Name -contains 'users') -and
        ($profiles.configured -is [bool]) -and
        ($profiles.users -is [array])) {
      $script:lastReadinessError = ''
      return $true
    }
    $script:lastReadinessError = "The profile endpoint returned an incomplete response."
  } catch {
    $script:lastReadinessError = $_.Exception.Message
  }
  return $false
}

function Stop-LocalServerProcess([Diagnostics.Process]$commandProcess) {
  $serverScript = Join-Path $root "server.js"
  $servers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($serverScript, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    (-not $commandProcess -or $_.ParentProcessId -eq $commandProcess.Id)
  })
  foreach ($server in $servers) {
    Stop-Process -Id $server.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if ($commandProcess -and -not $commandProcess.HasExited) {
    Stop-Process -Id $commandProcess.Id -Force -ErrorAction SilentlyContinue
  }
}

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
$serverScript = Join-Path $root "server.js"
$appLauncher = Join-Path $PSScriptRoot 'launch-local-app.ps1'
$browserLaunchRequested = $false

while ($true) {
  $commandProcess = $null
  $ready = Test-LocalAppReady
  if ($ready) {
    Write-ServerLog "Found an already-running healthy UW Accounting server."
  } else {
    Rotate-ServerLog
    Write-ServerLog "Starting UW Accounting server."
    $command = '"{0}" "{1}" >> "{2}" 2>&1' -f $nodePath, $serverScript, $logFile
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $env:ComSpec
    $startInfo.Arguments = "/d /c $command"
    $startInfo.WorkingDirectory = $root
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $commandProcess = [Diagnostics.Process]::Start($startInfo)
    $startupDeadline = [DateTime]::UtcNow.Add($startupTimeout)
    while ([DateTime]::UtcNow -lt $startupDeadline) {
      if ($commandProcess.HasExited) {
        Write-ServerLog "Server process exited during startup with code $($commandProcess.ExitCode)."
        break
      }
      if (Test-LocalAppReady) {
        $ready = $true
        Write-ServerLog "Health and profile endpoints are ready."
        break
      }
      Start-Sleep -Seconds 2
    }

    if (-not $ready) {
      if (-not $commandProcess.HasExited) {
        Write-ServerLog "Server did not become ready within 90 seconds ($script:lastReadinessError). Stopping the hung process before retrying."
      } else {
        Write-ServerLog "Server startup failed ($script:lastReadinessError). Retrying in 5 seconds."
      }
      Stop-LocalServerProcess $commandProcess
      $commandProcess.Dispose()
      Start-Sleep -Seconds 5
      continue
    }
  }

  if (-not $browserLaunchRequested -and (Test-Path -LiteralPath $appLauncher)) {
    $helperArgs = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $appLauncher
    try {
      Start-Process -FilePath 'powershell.exe' -ArgumentList $helperArgs -WindowStyle Hidden
      $browserLaunchRequested = $true
    } catch {
      Write-ServerLog "The API is ready, but the browser could not be opened automatically: $($_.Exception.Message)"
    }
  }

  $failedChecks = 0
  while ($true) {
    if ($commandProcess -and $commandProcess.HasExited) {
      Write-ServerLog "Server process exited with code $($commandProcess.ExitCode); restarting."
      break
    }
    Start-Sleep -Seconds 10
    if (Test-LocalAppReady) {
      $failedChecks = 0
      continue
    }
    $failedChecks++
    Write-ServerLog "Readiness check failed ($failedChecks/$unhealthyLimit): $script:lastReadinessError"
    if ($failedChecks -ge $unhealthyLimit) {
      Write-ServerLog "The local server remained unhealthy; restarting its process."
      Stop-LocalServerProcess $commandProcess
      break
    }
  }

  if ($commandProcess) {
    $commandProcess.Dispose()
  }
  Start-Sleep -Seconds 5
}
