param([switch]$VerifyOnly)
$ErrorActionPreference = "Stop"
$launchMutex = New-Object Threading.Mutex($false, "Local\UWAccountingBrowserLaunch")
$ownsLaunch = $launchMutex.WaitOne(0)
if (-not $ownsLaunch) { $launchMutex.Dispose(); exit 0 }
try {
$taskName = "UW Accounting Local Server"
$url = "http://127.0.0.1:8080/"
$healthUrl = "http://127.0.0.1:8080/api/health"
$profileUrl = "http://127.0.0.1:8080/api/auth/config"
$deadline = (Get-Date).AddSeconds(90)
$ready = $false

try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
  if (-not $health.ok) {
    throw "The local server health check did not pass."
  }
  $profiles = Invoke-RestMethod -Uri $profileUrl -TimeoutSec 3
  if (-not ($profiles.PSObject.Properties.Name -contains 'configured') -or -not ($profiles.PSObject.Properties.Name -contains 'users')) {
    throw "The profile service response is incomplete."
  }
  $ready = $true
} catch {
  $ready = $false
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $task) {
    throw "The UW Accounting startup task is not installed. Run install-local-autostart.ps1 first."
  }
  if ($task.State -ne "Running") {
    Start-ScheduledTask -TaskName $taskName
  }

  do {
    Start-Sleep -Seconds 1
    try {
      $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
      if ($health.ok) {
        $profiles = Invoke-RestMethod -Uri $profileUrl -TimeoutSec 3
        if (-not ($profiles.PSObject.Properties.Name -contains 'configured') -or -not ($profiles.PSObject.Properties.Name -contains 'users')) {
          throw "The profile service response is incomplete."
        }
        $ready = $true
        break
      }
    } catch {}
  } while ((Get-Date) -lt $deadline)

  if (-not $ready) {
    throw "The UW Accounting server and profile service did not become ready at $url within 90 seconds. Check data\logs\server.log."
  }
}

if (-not $VerifyOnly) {
  $launchStamp = Join-Path ([IO.Path]::GetTempPath()) 'uw-accounting-browser-opened.txt'
  $recentLaunch = (Test-Path -LiteralPath $launchStamp) -and ((Get-Date) - (Get-Item -LiteralPath $launchStamp).LastWriteTime).TotalSeconds -lt 15
  if (-not $recentLaunch) {
    $buildFile = Join-Path (Split-Path -Parent $PSScriptRoot) 'public\build-info.json'
    if (Test-Path -LiteralPath $buildFile) {
      $build = Get-Content -LiteralPath $buildFile -Raw | ConvertFrom-Json
      $url += '?build=' + [Uri]::EscapeDataString([string]$build.updatedAt)
    }
    Start-Process $url
    [IO.File]::WriteAllText($launchStamp, [DateTime]::UtcNow.ToString('o'))
  }
} else { Write-Output "Verified local app: $url" }

} finally { $launchMutex.ReleaseMutex(); $launchMutex.Dispose() }
