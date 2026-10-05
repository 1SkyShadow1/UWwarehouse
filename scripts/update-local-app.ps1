param(
  [string]$SourceRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'UWAccountingSystem'),
  [switch]$SkipRestart,
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
function Get-CodeHash([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','') }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}
$SourceRoot = (Resolve-Path -LiteralPath $SourceRoot).Path.TrimEnd('\')
$InstallRoot = (Resolve-Path -LiteralPath $InstallRoot).Path.TrimEnd('\')
if ($SourceRoot -eq $InstallRoot) { throw 'Update requires a separate installed copy.' }
if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot 'server.js'))) { throw 'The local app is not installed here.' }
$sourceLock = Join-Path $SourceRoot 'package-lock.json'
$targetLock = Join-Path $InstallRoot 'package-lock.json'
if (-not (Test-Path -LiteralPath $targetLock) -or (Get-CodeHash $sourceLock) -ne (Get-CodeHash $targetLock)) {
  throw 'Dependency lockfiles differ. This code-only updater does not change installed dependencies.'
}

# Only application code, static assets, scripts and documentation are eligible.
# Never mirror the checkout: accounting state, .env, node_modules and source
# document libraries are outside this allowlist.
$files = @('server.js','package.json','package-lock.json','README.md')
foreach ($folder in @('public','scripts','docs')) {
  $folderPath = Join-Path $SourceRoot $folder
  if (Test-Path -LiteralPath $folderPath) {
    $files += @(Get-ChildItem -LiteralPath $folderPath -File -Recurse | ForEach-Object {
      if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked application files are not supported.' }
      $_.FullName.Substring($SourceRoot.Length + 1)
    })
  }
}
$files = @($files | Sort-Object -Unique)
$protected = @{}
foreach ($relative in @('.env','data\uw-state.json')) {
  $file = Join-Path $InstallRoot $relative
  if (Test-Path -LiteralPath $file) { $protected[$relative] = (Get-CodeHash $file) }
}
$backupRoot = Join-Path ([IO.Path]::GetTempPath()) ('uw-code-update-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backupRoot | Out-Null
$control = Join-Path $InstallRoot 'scripts\local-server-task.ps1'
$copied = @()
$restartRequired = -not $SkipRestart
try {
  if ($restartRequired) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $control Stop
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the installed application.' }
  }
  $inventory = @{}
  foreach ($relative in $files) {
    $source = Join-Path $SourceRoot $relative
    $target = [IO.Path]::GetFullPath((Join-Path $InstallRoot $relative))
    if (-not $target.StartsWith($InstallRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Application update path escaped the installation.' }
    $backup = Join-Path $backupRoot $relative
    $existed = Test-Path -LiteralPath $target
    if ($existed) {
      New-Item -ItemType Directory -Path (Split-Path $backup) -Force | Out-Null
      Copy-Item -LiteralPath $target -Destination $backup
    }
    $copied += [pscustomobject]@{Target=$target; Backup=$backup; Existed=$existed}
    New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
    $hash = (Get-CodeHash $source)
    if ((Get-CodeHash $target) -ne $hash) { throw "Code verification failed: $relative" }
    $inventory[$relative.Replace('\','/')] = $hash.ToLowerInvariant()
  }
  foreach ($relative in $protected.Keys) {
    if ((Get-CodeHash (Join-Path $InstallRoot $relative)) -ne $protected[$relative]) { throw "Protected file changed unexpectedly: $relative" }
  }
  $revision = 'local'
  if (Get-Command git -ErrorAction SilentlyContinue) {
    $gitRevision = & git -C $SourceRoot rev-parse HEAD 2>$null
    if ($LASTEXITCODE -eq 0) { $revision = [string]$gitRevision }
  }
  $build = @{revision=$revision;updatedAt=[DateTime]::UtcNow.ToString('o');files=$inventory}
  $buildPath = Join-Path $InstallRoot 'public\build-info.json'
  $buildBackup = Join-Path $backupRoot 'public\build-info.json'
  $buildExisted = Test-Path -LiteralPath $buildPath
  if ($buildExisted) { Copy-Item -LiteralPath $buildPath -Destination $buildBackup -Force }
  $copied += [pscustomobject]@{Target=$buildPath; Backup=$buildBackup; Existed=$buildExisted}
  [IO.File]::WriteAllText($buildPath,($build | ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
  if ($restartRequired) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $control Start
    if ($LASTEXITCODE -ne 0) { throw 'Could not restart the installed application.' }
    $deadline = (Get-Date).AddSeconds(45)
    $healthy = $false
    do {
      try { $healthy = [bool](Invoke-RestMethod 'http://127.0.0.1:8080/api/health' -TimeoutSec 3).ok } catch {}
      if (-not $healthy) { Start-Sleep -Seconds 1 }
    } while (-not $healthy -and (Get-Date) -lt $deadline)
    if (-not $healthy) { throw 'The updated application did not become healthy.' }
    $served = (Invoke-WebRequest "http://127.0.0.1:8080/index.html?verify=$revision" -UseBasicParsing -TimeoutSec 10).Content
    if (-not $served.Contains('js/pricing-core.js') -or -not $served.Contains('js/suppliers.js')) { throw 'Port 8080 is not serving the updated code.' }
    if (-not $NoBrowser) {
      & powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File (Join-Path $InstallRoot 'scripts\launch-local-app.ps1')
      if ($LASTEXITCODE -ne 0) { throw 'The updated app could not be opened.' }
    }
  }
  Write-Output "Updated $InstallRoot to $revision; verified $($files.Count) application files. Existing state and .env were preserved."
  Write-Output "Previous code retained at $backupRoot"
} catch {
  foreach ($entry in $copied) {
    if ($entry.Existed) { Copy-Item -LiteralPath $entry.Backup -Destination $entry.Target -Force }
    elseif (Test-Path -LiteralPath $entry.Target) { Remove-Item -LiteralPath $entry.Target -Force }
  }
  if ($restartRequired) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $control Start }
  throw
}
