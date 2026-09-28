$ErrorActionPreference = "Stop"
$taskName = "UW Accounting Local Server"
$url = "http://127.0.0.1:8080/"
$healthUrl = "http://127.0.0.1:8080/api/health"
$deadline = (Get-Date).AddSeconds(45)

try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
  if (-not $health.ok) {
    throw "The local server health check did not pass."
  }
} catch {
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
        break
      }
    } catch {}
  } while ((Get-Date) -lt $deadline)

  if (-not $health -or -not $health.ok) {
    throw "The UW Accounting server did not become available at $url within 45 seconds. Check data\logs\server.log."
  }
}

Start-Process $url
