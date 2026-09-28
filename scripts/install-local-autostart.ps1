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
$backupTaskName = "UW Accounting Daily Local Backup"
$backupRoot = "D:\UW FOREVER"
$backupFolders = @(
  $backupRoot,
  (Join-Path $backupRoot "Saved Invoices"),
  (Join-Path $backupRoot "Saved Quotes"),
  (Join-Path $backupRoot "Local Backups")
)
foreach ($folder in $backupFolders) {
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
}
$sourceAccount = "$env:USERDOMAIN\$env:USERNAME"
& icacls.exe $backupRoot /grant "${sourceAccount}:(OI)(CI)F" /T /C
if ($LASTEXITCODE -ne 0) {
  throw "Could not grant $sourceAccount full access to $backupRoot (icacls exit code $LASTEXITCODE)."
}
foreach ($folder in $backupFolders) {
  $probe = Join-Path $folder ".uw-write-check-$PID"
  [System.IO.File]::WriteAllText($probe, "ok")
  Remove-Item -LiteralPath $probe -Force
}
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

$backupScript = Join-Path $InstallRoot "scripts\backup-local-data.ps1"
if (-not (Test-Path $backupScript)) {
  throw "The local backup script was not installed at $backupScript."
}
$backupAction = New-ScheduledTaskAction -Execute $powershellPath -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`""
$backupTrigger = New-ScheduledTaskTrigger -Daily -At "2:00AM"
$backupSettings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
Register-ScheduledTask `
  -TaskName $backupTaskName `
  -Action $backupAction `
  -Trigger $backupTrigger `
  -Settings $backupSettings `
  -Principal $principal `
  -Description "Creates a daily local backup of UW Accounting state and managed documents, retaining 30 copies." `
  -Force | Out-Null

Write-Host "Installed the UW Accounting app at $InstallRoot"
$listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Write-Warning "Port 8080 is already in use. Stop the existing listener, then start the scheduled task manually."
} else {
  Start-ScheduledTask -TaskName $taskName
  Write-Host "Registered and started the per-user '$taskName' task. It will also start automatically at sign-in."
}
& $powershellPath -NoProfile -ExecutionPolicy Bypass -File $backupScript
if ($LASTEXITCODE -ne 0) {
  throw "The app is installed, but the immediate local backup failed."
}
Start-ScheduledTask -TaskName $backupTaskName
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
Write-Host "Registered daily backups to D:\UW FOREVER\Local Backups (30 copies retained). Invoices and quotes are saved to their dedicated folders."
Write-Host "Task controls: powershell -NoProfile -ExecutionPolicy Bypass -File `"$InstallRoot\scripts\local-server-task.ps1`" Status|Start|Stop|Uninstall"
