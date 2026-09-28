param(
  [ValidateSet("Start", "Stop", "Status", "Uninstall")]
  [string]$Action = "Status"
)

$ErrorActionPreference = "Stop"
$taskName = "UW Accounting Local Server"
$installRoot = Split-Path -Parent $PSScriptRoot
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

function Stop-LocalServerTask {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  $taskDeadline = (Get-Date).AddSeconds(10)
  do {
    $currentTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if (-not $currentTask -or $currentTask.State -ne "Running") { break }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $taskDeadline)

  $expectedServer = Join-Path $installRoot "server.js"
  $servers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($expectedServer, [StringComparison]::OrdinalIgnoreCase) -ge 0
  })
  foreach ($server in $servers) {
    Stop-Process -Id $server.ProcessId -Force
  }
  $deadline = (Get-Date).AddSeconds(5)
  do {
    $servers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object {
      $_.CommandLine -and $_.CommandLine.IndexOf($expectedServer, [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    if (-not $servers.Count) {
      return
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  throw "The local Node server did not stop."
}

if (-not $task) {
  if ($Action -eq "Status") {
    Write-Output "The '$taskName' task is not installed."
    exit 1
  }
  if ($Action -ne "Uninstall") {
    throw "The '$taskName' task is not installed."
  }
}

switch ($Action) {
  "Start" {
    Start-ScheduledTask -TaskName $taskName
    Write-Output "Started '$taskName'."
  }
  "Stop" {
    Stop-LocalServerTask
    Write-Output "Stopped '$taskName'."
  }
  "Status" {
    $task = Get-ScheduledTask -TaskName $taskName
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    [pscustomobject]@{
      Task = $task.TaskName
      State = $task.State
      LastRunTime = $info.LastRunTime
      LastTaskResult = $info.LastTaskResult
      LocalListener = [bool](Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue)
    } | Format-List
  }
  "Uninstall" {
    if ($task) {
      Stop-LocalServerTask
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    Write-Output "Removed the startup task. The app and its data folder were left intact."
  }
}
