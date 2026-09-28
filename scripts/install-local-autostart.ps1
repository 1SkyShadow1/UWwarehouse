param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "UWAccountingSystem"),
  [switch]$Update
)

$ErrorActionPreference = "Stop"
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
if ($InstallRoot -eq $sourceRoot) {
  throw "Choose an installation folder separate from the project checkout."
}

$taskName = "UW Accounting Local Server"
$alreadyInstalled = Test-Path $InstallRoot
if ($alreadyInstalled -and -not $Update) {
  throw "The installation folder already exists. Use -Update to update code without overwriting its data."
}
if ($Update) {
  $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existingTask) {
    & (Join-Path $InstallRoot "scripts\local-server-task.ps1") Stop
  }
}

if ($alreadyInstalled) {
  & robocopy.exe $sourceRoot $InstallRoot /E /R:2 /W:1 /XD ".git" "node_modules" ".agents" ".claude" "data" /XF ".git" ".env"
} else {
  & robocopy.exe $sourceRoot $InstallRoot /E /R:2 /W:1 /XD ".git" "node_modules" ".agents" ".claude" /XF ".git" ".env"
}
if ($LASTEXITCODE -ge 8) {
  throw "Copying application files failed (robocopy exit code $LASTEXITCODE)."
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$npmPath = Join-Path (Split-Path $nodePath) "npm.cmd"
if (-not (Test-Path $npmPath)) {
  throw "Could not find npm.cmd beside Node.js at $npmPath."
}
Push-Location $InstallRoot
try {
  & $npmPath ci --omit=dev
  if ($LASTEXITCODE -ne 0) {
    throw "Installing application dependencies failed (npm exit code $LASTEXITCODE)."
  }
} finally {
  Pop-Location
}

$launcher = Join-Path $InstallRoot "scripts\start-local-server.ps1"
if (-not (Test-Path $launcher)) {
  throw "The local server launcher was not installed at $launcher."
}
$powershellPath = Join-Path $PSHOME "powershell.exe"
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Starts and restarts the localhost-only UW Accounting server at user sign-in." `
  -Force | Out-Null

Write-Host "Installed the UW Accounting app at $InstallRoot"
$listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Write-Warning "Port 8080 is already in use. Stop the existing listener, then start the scheduled task manually."
} else {
  Start-ScheduledTask -TaskName $taskName
  Write-Host "Registered and started the per-user '$taskName' task. It will also start automatically at sign-in."
}
$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$shortcutPath = Join-Path $desktop "UW Accounting System.lnk"
$launcher = Join-Path $InstallRoot "scripts\launch-local-app.ps1"
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellPath
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
$shortcut.WorkingDirectory = $InstallRoot
$shortcut.IconLocation = Join-Path $InstallRoot "public\uw-accounting.ico"
$shortcut.Description = "Start UW Accounting locally and open the app."
$shortcut.Save()
Write-Host "Created the desktop shortcut: $shortcutPath"
Write-Host "Task controls: powershell -NoProfile -ExecutionPolicy Bypass -File `"$InstallRoot\scripts\local-server-task.ps1`" Status|Start|Stop|Uninstall"
