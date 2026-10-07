param(
  [string]$AppRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$DataRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) "data"),
  [string]$BackupRoot = "D:\UW FOREVER\Local Backups",
  [string]$InvoicesRoot = "D:\UW FOREVER\Saved Invoices",
  [string]$QuotesRoot = "D:\UW FOREVER\Saved Quotes",
  [string[]]$SourceRoots = @("D:\UW"),
  [string]$EnvironmentFile = (Join-Path (Split-Path -Parent $PSScriptRoot) ".env"),
  [string]$VerifyPath = "",
  [string]$RestorePath = "",
  [string]$RestoreDestination = "",
  [switch]$FullBackup,
  [ValidateRange(1, 365)]
  [int]$RetentionCount = 30
)

$ErrorActionPreference = "Stop"
# Use the encryption module belonging to this PowerShell runtime. Launchers such
# as npm can inherit another PowerShell version's module search path.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$manifestName = "backup-manifest.json"
$encryptedEnvironmentName = "local-environment.dpapi"
$excludedDataDirectories = @("logs", "upload-tmp")
$excludedAppDirectories = @(".git", "node_modules", "data", ".agents", ".claude")
$excludedAppFiles = @(".env")
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot 'incremental-backup.ps1')

function Get-NormalizedFullPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
}
function Get-FileHash([string]$LiteralPath,[string]$Algorithm='SHA256') {
  $stream=[IO.File]::Open($LiteralPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete));$sha=[Security.Cryptography.SHA256]::Create()
  try { return [pscustomobject]@{Hash=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','')} }
  finally {$stream.Dispose();$sha.Dispose()}
}

function Test-PathWithin([string]$Path, [string]$Parent) {
  $normalizedPath = (Get-NormalizedFullPath $Path) + [System.IO.Path]::DirectorySeparatorChar
  $normalizedParent = (Get-NormalizedFullPath $Parent) + [System.IO.Path]::DirectorySeparatorChar
  return $normalizedPath.StartsWith($normalizedParent, [StringComparison]::OrdinalIgnoreCase)
}

function Get-RelativeFilePath([string]$Root, [string]$FilePath) {
  $prefix = (Get-NormalizedFullPath $Root) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $FilePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "File is outside its backup root: $FilePath"
  }
  return $FilePath.Substring($prefix.Length).Replace("\", "/")
}

function Get-TreeFiles([string]$Root, [string[]]$ExcludedDirectories = @(), [string[]]$ExcludedFiles = @()) {
  $files = @(Get-ChildItem -LiteralPath $Root -File -Recurse -Force)
  foreach ($file in $files) {
    $relativePath = Get-RelativeFilePath $Root $file.FullName
    $segments = $relativePath.Split("/")
    $excludedSegment = @($segments | Where-Object { $ExcludedDirectories -contains $_ }).Count -gt 0
    if ($excludedSegment -or $ExcludedFiles -contains $file.Name) {
      continue
    }
    $file
  }
}

function Get-TreeManifest([string]$Root, [string]$Group, [string[]]$ExcludedDirectories = @(), [string[]]$ExcludedFiles = @()) {
  $entries = @(
    Get-TreeFiles $Root $ExcludedDirectories $ExcludedFiles | ForEach-Object {
      [ordered]@{
        group = $Group
        path = Get-RelativeFilePath $Root $_.FullName
        length = [long]$_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    } | Sort-Object path
  )
  return $entries
}

function Assert-TreeMatches([string]$Source, [string]$Destination, [string]$Group, [string[]]$ExcludedDirectories = @(), [string[]]$ExcludedFiles = @()) {
  $sourceEntries = @(Get-TreeManifest $Source $Group $ExcludedDirectories $ExcludedFiles)
  $destinationEntries = @(Get-TreeManifest $Destination $Group)
  if ($sourceEntries.Count -ne $destinationEntries.Count) {
    throw "$Group copy is incomplete: source has $($sourceEntries.Count) files; copied tree has $($destinationEntries.Count)."
  }
  for ($index = 0; $index -lt $sourceEntries.Count; $index++) {
    $sourceEntry = $sourceEntries[$index]
    $destinationEntry = $destinationEntries[$index]
    if ($sourceEntry.path -cne $destinationEntry.path -or
        $sourceEntry.length -ne $destinationEntry.length -or
        $sourceEntry.sha256 -cne $destinationEntry.sha256) {
      throw "$Group copy verification failed for '$($sourceEntry.path)'."
    }
  }
  return $sourceEntries
}

function Assert-ValidAccountingSnapshot([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Required accounting snapshot is missing: $Path"
  }
  try {
    $snapshot = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Accounting snapshot is not valid JSON: $Path"
  }
  if ($null -eq $snapshot.data -or $snapshot.data -isnot [System.Management.Automation.PSCustomObject] -or
      $snapshot.revision -isnot [ValueType] -or $snapshot.revision -lt 0) {
    throw "Accounting snapshot is missing its data object or valid revision: $Path"
  }
}

function Assert-BackupValid([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "Backup folder does not exist: $Path"
  }
  $manifestPath = Join-Path $Path $manifestName
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Backup manifest is missing: $manifestPath"
  }
  try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Backup manifest is not valid JSON: $manifestPath"
  }
  if ($manifest.schemaVersion -eq 3) { return Assert-IncrementalBackupValid $Path $manifest }
  if ($manifest.schemaVersion -ne 2 -or -not $manifest.files) {
    throw "Backup manifest format is unsupported or contains no file inventory: $manifestPath"
  }

  $expected = @{}
  foreach ($entry in $manifest.files) {
    $relativePath = [string]$entry.path
    if (-not $relativePath -or [System.IO.Path]::IsPathRooted($relativePath) -or
        $relativePath.Split("/") -contains ".." -or $expected.ContainsKey($relativePath)) {
      throw "Backup manifest contains an invalid or duplicate path."
    }
    $expected[$relativePath] = $entry
  }
  $actual = @(Get-ChildItem -LiteralPath $Path -File -Recurse -Force | Where-Object {
    (Get-RelativeFilePath $Path $_.FullName) -cne $manifestName
  })
  if ($actual.Count -ne $expected.Count) {
    throw "Backup file inventory mismatch: manifest lists $($expected.Count) files; found $($actual.Count)."
  }
  foreach ($file in $actual) {
    $relativePath = Get-RelativeFilePath $Path $file.FullName
    if (-not $expected.ContainsKey($relativePath)) {
      throw "Backup contains an unlisted file: $relativePath"
    }
    $entry = $expected[$relativePath]
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ([long]$file.Length -ne [long]$entry.length -or $hash -cne [string]$entry.sha256) {
      throw "Backup integrity verification failed for '$relativePath'."
    }
  }
  Assert-ValidAccountingSnapshot (Join-Path $Path "Application Data\uw-state.json")
  $encryptedEnvironment = Join-Path $Path $encryptedEnvironmentName
  if (-not (Test-Path -LiteralPath $encryptedEnvironment -PathType Leaf)) {
    throw "Encrypted local environment configuration is missing from the backup."
  }
  try {
    $null = ConvertTo-SecureString -String (Get-Content -LiteralPath $encryptedEnvironment -Raw -Encoding UTF8).Trim()
  } catch {
    throw "Encrypted local environment configuration cannot be decrypted by this Windows user."
  }
  return $manifest
}

if ($RestorePath) {
  if (-not $RestoreDestination) { throw 'RestoreDestination is required.' }
  $snapshotPath = Get-NormalizedFullPath $RestorePath
  $verifiedManifest = Assert-BackupValid $snapshotPath
  Restore-BackupSnapshot $snapshotPath $RestoreDestination $verifiedManifest
  return
}
if ($VerifyPath) {
  $verifiedManifest = Assert-BackupValid (Get-NormalizedFullPath $VerifyPath)
  Write-Host "Backup verified: $VerifyPath ($($verifiedManifest.files.Count) files, $($verifiedManifest.totalBytes) bytes)."
  return
}

$AppRoot = Get-NormalizedFullPath $AppRoot
$DataRoot = Get-NormalizedFullPath $DataRoot
$BackupRoot = Get-NormalizedFullPath $BackupRoot
$InvoicesRoot = Get-NormalizedFullPath $InvoicesRoot
$QuotesRoot = Get-NormalizedFullPath $QuotesRoot
$EnvironmentFile = Get-NormalizedFullPath $EnvironmentFile
$SourceRoots = @($SourceRoots | ForEach-Object { Get-NormalizedFullPath $_ })

if (-not (Test-Path -LiteralPath $DataRoot -PathType Container)) {
  throw "Local application data folder does not exist: $DataRoot"
}
if (-not (Test-Path -LiteralPath $AppRoot -PathType Container)) {
  throw "Installed application folder does not exist: $AppRoot"
}
if (Test-PathWithin $BackupRoot $DataRoot -or Test-PathWithin $DataRoot $BackupRoot) {
  throw 'The backup and primary application data directories must be separate.'
}
if (-not (Test-Path -LiteralPath $InvoicesRoot -PathType Container)) {
  throw "Saved invoices folder does not exist: $InvoicesRoot"
}
if (-not (Test-Path -LiteralPath $QuotesRoot -PathType Container)) {
  throw "Saved quotes folder does not exist: $QuotesRoot"
}
if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
  throw "Local environment configuration is missing: $EnvironmentFile"
}
foreach ($sourceRoot in $SourceRoots) {
  if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    throw "Configured system source folder does not exist: $sourceRoot"
  }
}
if (Test-PathWithin $BackupRoot $AppRoot -or Test-PathWithin $BackupRoot $InvoicesRoot -or Test-PathWithin $BackupRoot $QuotesRoot) {
  throw "The backup destination must not be inside any source data folder."
}
foreach ($sourceRoot in $SourceRoots) {
  if (Test-PathWithin $BackupRoot $sourceRoot -or Test-PathWithin $sourceRoot $BackupRoot) {
    throw "Backup and source paths must not overlap: $BackupRoot and $sourceRoot"
  }
}
Assert-ValidAccountingSnapshot (Join-Path $DataRoot "uw-state.json")
if (Test-Path -LiteralPath (Join-Path $DataRoot "uw-state.json.bak") -PathType Leaf) {
  Assert-ValidAccountingSnapshot (Join-Path $DataRoot "uw-state.json.bak")
}

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
$destination = Join-Path $BackupRoot "UWAccounting-$timestamp"
$temporary = Join-Path $BackupRoot ".UWAccounting-$timestamp-$PID.tmp"
if (Test-Path -LiteralPath $destination) {
  throw "Backup destination already exists: $destination"
}

try {
  New-Item -ItemType Directory -Path $temporary -Force | Out-Null
  $copySets = @(
    @{ Name = "Application Files"; Source = $AppRoot; Destination = (Join-Path $temporary "Application Files"); ExcludedDirectories = $excludedAppDirectories; ExcludedFiles = $excludedAppFiles },
    @{ Name = "Application Data"; Source = $DataRoot; Destination = (Join-Path $temporary "Application Data"); ExcludedDirectories = $excludedDataDirectories },
    @{ Name = "Saved Invoices"; Source = $InvoicesRoot; Destination = (Join-Path $temporary "Saved Invoices"); ExcludedDirectories = @() },
    @{ Name = "Saved Quotes"; Source = $QuotesRoot; Destination = (Join-Path $temporary "Saved Quotes"); ExcludedDirectories = @() }
  )
  for ($index = 0; $index -lt $SourceRoots.Count; $index++) {
    $sourceRoot = $SourceRoots[$index]
    $sourceName = Split-Path -Leaf $sourceRoot
    $sameNameCount = @($SourceRoots | Where-Object { (Split-Path -Leaf $_) -ceq $sourceName }).Count
    if ($sameNameCount -gt 1) {
      throw "Source roots have duplicate folder names; cannot create a clear backup path for '$sourceName'."
    }
    $copySets += @{ Name = "Source Library/$sourceName"; Source = $sourceRoot; Destination = (Join-Path $temporary "Source Library\$sourceName"); ExcludedDirectories = @() }
  }

  if (-not $FullBackup) {
    New-IncrementalBackup $copySets $temporary $destination $BackupRoot $EnvironmentFile
    return
  }
  $fileEntries = @()
  foreach ($copySet in $copySets) {
    New-Item -ItemType Directory -Path $copySet.Destination -Force | Out-Null
    $robocopyArguments = @($copySet.Source, $copySet.Destination, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:2", "/W:1", "/XJ", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
    if ($copySet.ExcludedDirectories.Count -gt 0) {
      $robocopyArguments += "/XD"
      $robocopyArguments += $copySet.ExcludedDirectories
    }
    if ($copySet.ExcludedFiles -and $copySet.ExcludedFiles.Count -gt 0) {
      $robocopyArguments += "/XF"
      $robocopyArguments += $copySet.ExcludedFiles
    }
    & robocopy.exe @robocopyArguments
    $robocopyExitCode = $LASTEXITCODE
    if ($robocopyExitCode -ge 8) {
      throw "Copying $($copySet.Name) failed (robocopy exit code $robocopyExitCode)."
    }
    $entries = @(Assert-TreeMatches $copySet.Source $copySet.Destination $copySet.Name $copySet.ExcludedDirectories $copySet.ExcludedFiles)
    foreach ($entry in $entries) {
      $fileEntries += [ordered]@{
        group = $entry.group
        path = "$($copySet.Name)/$($entry.path)"
        length = $entry.length
        sha256 = $entry.sha256
      }
    }
  }

  $environmentText = Get-Content -LiteralPath $EnvironmentFile -Raw -Encoding UTF8
  $secureEnvironment = ConvertTo-SecureString -String $environmentText -AsPlainText -Force
  $encryptedEnvironmentText = ConvertFrom-SecureString -SecureString $secureEnvironment
  [System.IO.File]::WriteAllText((Join-Path $temporary $encryptedEnvironmentName), $encryptedEnvironmentText, $utf8NoBom)
  $null = ConvertTo-SecureString -String (Get-Content -LiteralPath (Join-Path $temporary $encryptedEnvironmentName) -Raw -Encoding UTF8).Trim()
  $environmentFilePath = $encryptedEnvironmentName
  $environmentHash = (Get-FileHash -LiteralPath (Join-Path $temporary $encryptedEnvironmentName) -Algorithm SHA256).Hash.ToLowerInvariant()
  $fileEntries += [ordered]@{
    group = "Encrypted Local Configuration"
    path = $environmentFilePath
    length = (Get-Item -LiteralPath (Join-Path $temporary $encryptedEnvironmentName)).Length
    sha256 = $environmentHash
  }

  $totalBytes = [long]0
  foreach ($entry in $fileEntries) {
    $totalBytes += [long]$entry.length
  }
  $manifest = [ordered]@{
    schemaVersion = 2
    createdAt = (Get-Date).ToString("o")
    applicationDataSource = $DataRoot
    applicationFilesSource = $AppRoot
    sourceLibraries = @($SourceRoots)
    invoiceExportsSource = $InvoicesRoot
    quoteExportsSource = $QuotesRoot
    environmentBackup = "DPAPI-encrypted for this Windows user; reconfigure integrations after moving to another Windows account or PC."
    excludedApplicationDataDirectories = $excludedDataDirectories
    excludedApplicationFileDirectories = $excludedAppDirectories
    excludedApplicationFiles = $excludedAppFiles
    fileCount = $fileEntries.Count
    totalBytes = $totalBytes
    files = $fileEntries
  }
  [System.IO.File]::WriteAllText((Join-Path $temporary $manifestName), ($manifest | ConvertTo-Json -Depth 8), $utf8NoBom)
  if (-not (Test-PathWithin $temporary $BackupRoot) -or -not (Test-PathWithin $destination $BackupRoot)) { throw 'Backup move escaped the backup directory.' }
  Move-Item -LiteralPath $temporary -Destination $destination

  $verifiedManifest = Assert-BackupValid $destination
  $backups = @(Get-ChildItem -LiteralPath $BackupRoot -Directory |
    Where-Object { $_.Name -match '^UWAccounting-\d{8}-\d{6}-\d{3}$' } |
    Where-Object {
      # Explicit full-backup retention must never remove incremental history.
      try { (Get-Content -LiteralPath (Join-Path $_.FullName $manifestName) -Raw -Encoding UTF8 | ConvertFrom-Json).schemaVersion -eq 2 }
      catch { $false }
    } |
    Sort-Object Name -Descending)
  foreach ($oldBackup in $backups | Select-Object -Skip $RetentionCount) {
    if (-not (Test-PathWithin $oldBackup.FullName $BackupRoot)) { throw 'Backup cleanup escaped the backup directory.' }
    Remove-Item -LiteralPath $oldBackup.FullName -Recurse -Force
  }
  Write-Host "Local system backup created and verified: $destination ($($verifiedManifest.fileCount) files, $($verifiedManifest.totalBytes) bytes)."
} finally {
  if (Test-Path -LiteralPath $temporary) {
    if (-not (Test-PathWithin $temporary $BackupRoot)) { throw 'Temporary cleanup escaped the backup directory.' }
    Remove-Item -LiteralPath $temporary -Recurse -Force
  }
}
