# Shared backup helpers. Files are addressed by SHA-256; snapshots contain a full
# inventory, so recovery never depends on replaying other incremental snapshots.
function Get-BackupObjectPath([string]$StoreRoot,[string]$Hash) {
  if ($Hash -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid backup object hash.' }
  $path = Join-Path $StoreRoot ($Hash.Substring(0,2) + '\' + $Hash)
  if (-not (Test-PathWithin $path $StoreRoot)) { throw 'Object path escaped the backup store.' }
  return $path
}

function Assert-IncrementalInventory($Manifest) {
  if ($Manifest.schemaVersion -ne 3 -or -not $Manifest.files -or $Manifest.fileCount -ne @($Manifest.files).Count) { throw 'Invalid incremental backup inventory.' }
  $seen = @{}; $bytes = [long]0
  foreach ($entry in $Manifest.files) {
    $relative = [string]$entry.path
    if (-not $relative -or [IO.Path]::IsPathRooted($relative) -or $relative.Contains('\') -or $relative.Contains(':') -or
        @($relative.Split('/') | Where-Object { $_ -eq '..' -or $_ -eq '.' -or $_ -eq '' }).Count -or $seen.ContainsKey($relative) -or
        [string]$entry.sha256 -cnotmatch '^[a-f0-9]{64}$' -or [long]$entry.length -lt 0) { throw 'Invalid or duplicate incremental backup entry.' }
    $seen[$relative] = $true; $bytes += [long]$entry.length
  }
  if ($bytes -ne [long]$Manifest.totalBytes) { throw 'Incremental inventory byte count differs.' }
  foreach ($directory in $Manifest.directories) {
    if (-not $directory -or [IO.Path]::IsPathRooted($directory) -or $directory.Contains('\') -or $directory.Contains(':') -or
        @($directory.Split('/') | Where-Object { $_ -eq '..' -or $_ -eq '.' -or $_ -eq '' }).Count) { throw 'Invalid incremental backup directory.' }
  }
  foreach ($required in @('Application Data/uw-state.json','local-environment.dpapi')) {
    if (-not $seen.ContainsKey($required)) { throw "Required backup file is missing: $required" }
  }
}

function Assert-IncrementalBackupValid([string]$Path,$Manifest) {
  Assert-IncrementalInventory $Manifest
  $storeRoot = Join-Path (Split-Path -Parent $Path) '_objects'
  $verified = @{}
  foreach ($entry in $Manifest.files) {
    $objectPath = Get-BackupObjectPath $storeRoot $entry.sha256
    if (-not (Test-Path -LiteralPath $objectPath -PathType Leaf)) { throw "Backup object missing: $($entry.path)" }
    if (-not $verified.ContainsKey($entry.sha256)) {
      if ((Get-FileHash -LiteralPath $objectPath).Hash.ToLowerInvariant() -cne $entry.sha256) { throw "Backup object integrity failed: $($entry.path)" }
      $verified[$entry.sha256] = (Get-Item -LiteralPath $objectPath).Length
    }
    if ([long]$verified[$entry.sha256] -ne [long]$entry.length) { throw "Backup object length differs: $($entry.path)" }
  }
  $state = $Manifest.files | Where-Object path -eq 'Application Data/uw-state.json'
  Assert-ValidAccountingSnapshot (Get-BackupObjectPath $storeRoot $state.sha256)
  $environment = $Manifest.files | Where-Object path -eq 'local-environment.dpapi'
  try { $null = ConvertTo-SecureString -String (Get-Content -LiteralPath (Get-BackupObjectPath $storeRoot $environment.sha256) -Raw -Encoding UTF8).Trim() }
  catch { throw 'Encrypted configuration cannot be decrypted by this Windows user.' }
  return $Manifest
}

function Add-BackupObject([string]$Source,[string]$Hash,[long]$Length,[string]$StoreRoot,$Verified,$Stats) {
  $destination = Get-BackupObjectPath $StoreRoot $Hash
  if ($Verified.ContainsKey($Hash)) { return }
  if (Test-Path -LiteralPath $destination -PathType Leaf) {
    if ((Get-Item -LiteralPath $destination).Length -ne $Length -or (Get-FileHash -LiteralPath $destination).Hash.ToLowerInvariant() -cne $Hash) {
      throw "Existing backup object is corrupt; previous snapshots are retained: $Hash"
    }
  } else {
    if (Test-Path -LiteralPath $destination) { throw 'Backup object path is occupied by a directory.' }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    $temporaryObject = "$destination.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    try {
      Copy-Item -LiteralPath $Source -Destination $temporaryObject
      if ((Get-Item -LiteralPath $temporaryObject).Length -ne $Length -or (Get-FileHash -LiteralPath $temporaryObject).Hash.ToLowerInvariant() -cne $Hash) {
        throw "Source changed while copying or backup verification failed: $Source. Run the backup again."
      }
      Move-Item -LiteralPath $temporaryObject -Destination $destination
      $Stats.newObjects++; $Stats.newBytes += $Length
    } finally { if (Test-Path -LiteralPath $temporaryObject) { Remove-Item -LiteralPath $temporaryObject -Force } }
  }
  $Verified[$Hash] = $true
}

function New-IncrementalBackup($CopySets,[string]$Temporary,[string]$Destination,[string]$Root,[string]$EnvironmentPath) {
  $lockPath = Join-Path $Root '.incremental-backup.lock'
  try { $lock = [IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
  catch { throw 'Another incremental backup is running. Existing snapshots were retained.' }
  try {
    $storeRoot = Join-Path $Root '_objects'; $verified = @{}; $stats = @{newObjects=0;newBytes=[long]0}; $entries = @(); $directories = @()
    foreach ($set in $CopySets) {
      $directories += $set.Name
      foreach ($directory in @(Get-ChildItem -LiteralPath $set.Source -Directory -Recurse -Force)) {
        $relative = Get-RelativeFilePath $set.Source $directory.FullName
        if (@($relative.Split('/') | Where-Object { $set.ExcludedDirectories -contains $_ }).Count) { continue }
        if ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked backup directory is unsupported: $($directory.FullName)" }
        $directories += $set.Name+'/'+$relative
      }
      foreach ($file in @(Get-TreeFiles $set.Source $set.ExcludedDirectories $set.ExcludedFiles)) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked backup source is unsupported: $($file.FullName)" }
        $hash = (Get-FileHash -LiteralPath $file.FullName).Hash.ToLowerInvariant()
        $length = (Get-Item -LiteralPath $file.FullName).Length
        Add-BackupObject $file.FullName $hash $length $storeRoot $verified $stats
        $entries += [ordered]@{group=$set.Name;path=($set.Name+'/'+(Get-RelativeFilePath $set.Source $file.FullName));length=[long]$length;sha256=$hash;lastWriteUtc=$file.LastWriteTimeUtc.ToString('o');attributes=[int]$file.Attributes}
      }
    }
    # Keep DPAPI encryption and reuse the prior encrypted object when its plaintext
    # is unchanged. Plaintext credentials are never written into the backup.
    $environmentText = Get-Content -LiteralPath $EnvironmentPath -Raw -Encoding UTF8
    $encryptedText = $null
    $previous = Get-ChildItem -LiteralPath $Root -Directory | Where-Object Name -match '^UWAccounting-\d{8}-\d{6}-\d{3}$' | Sort-Object Name -Descending | Select-Object -First 1
    if ($previous) {
      $previousManifest = Get-Content -LiteralPath (Join-Path $previous.FullName 'backup-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($previousManifest.schemaVersion -eq 3) {
        Assert-IncrementalInventory $previousManifest
        $previousEnvironment = $previousManifest.files | Where-Object path -eq 'local-environment.dpapi'
        $previousPath = Get-BackupObjectPath $storeRoot $previousEnvironment.sha256
        if ((Get-FileHash -LiteralPath $previousPath).Hash.ToLowerInvariant() -cne $previousEnvironment.sha256) { throw 'Previous encrypted configuration object is corrupt.' }
      } else { $previousPath = Join-Path $previous.FullName 'local-environment.dpapi' }
      if (Test-Path -LiteralPath $previousPath -PathType Leaf) {
        $candidate = (Get-Content -LiteralPath $previousPath -Raw -Encoding UTF8).Trim()
        $secureCandidate = ConvertTo-SecureString -String $candidate
        if ((New-Object System.Net.NetworkCredential('', $secureCandidate)).Password -ceq $environmentText) { $encryptedText = $candidate }
      }
    }
    if (-not $encryptedText) { $encryptedText = ConvertFrom-SecureString (ConvertTo-SecureString -String $environmentText -AsPlainText -Force) }
    $environmentTemporary = Join-Path $Temporary 'local-environment.dpapi'
    [IO.File]::WriteAllText($environmentTemporary,$encryptedText,$utf8NoBom)
    $environmentHash = (Get-FileHash -LiteralPath $environmentTemporary).Hash.ToLowerInvariant()
    $environmentLength = (Get-Item -LiteralPath $environmentTemporary).Length
    Add-BackupObject $environmentTemporary $environmentHash $environmentLength $storeRoot $verified $stats
    $entries += [ordered]@{group='Encrypted Local Configuration';path='local-environment.dpapi';length=[long]$environmentLength;sha256=$environmentHash}
    Remove-Item -LiteralPath $environmentTemporary
    $totalBytes = [long]0; foreach ($entry in $entries) { $totalBytes += [long]$entry.length }
    $manifest = [ordered]@{schemaVersion=3;createdAt=(Get-Date).ToString('o');storage='sha256-objects';fileCount=$entries.Count;totalBytes=$totalBytes;newObjects=$stats.newObjects;newBytes=$stats.newBytes;files=$entries;directories=@($directories | Sort-Object -Unique);sourceLibraries=@($SourceRoots);applicationDataSource=$DataRoot;applicationFilesSource=$AppRoot;invoiceExportsSource=$InvoicesRoot;quoteExportsSource=$QuotesRoot;environmentBackup='DPAPI-encrypted for this Windows user';historyPolicy='Snapshots and content objects retained; no automatic history deletion.'}
    Assert-IncrementalInventory $manifest
    [IO.File]::WriteAllText((Join-Path $Temporary 'backup-manifest.json'),($manifest | ConvertTo-Json -Depth 8),$utf8NoBom)
    # Objects were individually verified before publication; the ledger must also parse.
    $state = $entries | Where-Object path -eq 'Application Data/uw-state.json'
    Assert-ValidAccountingSnapshot (Get-BackupObjectPath $storeRoot $state.sha256)
    Move-Item -LiteralPath $Temporary -Destination $Destination
    Write-Host "Incremental backup created and verified: $Destination ($($entries.Count) files referenced; $($stats.newObjects) new objects / $($stats.newBytes) new bytes)."
  } finally { $lock.Dispose() }
}

function Restore-BackupSnapshot([string]$Snapshot,[string]$Destination,$Manifest) {
  $destinationPath = Get-NormalizedFullPath $Destination
  if (Test-Path -LiteralPath $destinationPath) { throw 'Restore destination must be a new folder; live data is never overwritten.' }
  $parent = Split-Path -Parent $destinationPath
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $staging = Join-Path $parent ('.uw-restore-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $staging | Out-Null
  try {
    foreach ($directory in $Manifest.directories) {
      $target = Join-Path $staging $directory
      if ([IO.Path]::IsPathRooted($directory) -or -not (Test-PathWithin $target $staging)) { throw 'Restore directory escaped its staging directory.' }
      New-Item -ItemType Directory -Path $target -Force | Out-Null
    }
    foreach ($entry in $Manifest.files) {
      $target = Join-Path $staging $entry.path
      if (-not (Test-PathWithin $target $staging)) { throw 'Restore path escaped its staging directory.' }
      $source = if ($Manifest.schemaVersion -eq 3) { Get-BackupObjectPath (Join-Path (Split-Path -Parent $Snapshot) '_objects') $entry.sha256 } else { Join-Path $Snapshot $entry.path }
      New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
      Copy-Item -LiteralPath $source -Destination $target
      if ((Get-Item -LiteralPath $target).Length -ne [long]$entry.length -or (Get-FileHash -LiteralPath $target).Hash.ToLowerInvariant() -cne $entry.sha256) { throw "Restored file verification failed: $($entry.path)" }
      if ($entry.lastWriteUtc) { (Get-Item -LiteralPath $target).LastWriteTimeUtc = [datetime]::Parse($entry.lastWriteUtc) }
      if ($null -ne $entry.attributes) { (Get-Item -LiteralPath $target).Attributes = [IO.FileAttributes]$entry.attributes }
    }
    Assert-ValidAccountingSnapshot (Join-Path $staging 'Application Data\uw-state.json')
    Move-Item -LiteralPath $staging -Destination $destinationPath
    Write-Host "Backup restored and verified into $destinationPath. Encrypted configuration remains encrypted."
  } finally {
    if (Test-Path -LiteralPath $staging) {
      if (-not (Test-PathWithin $staging $parent)) { throw 'Restore cleanup escaped its parent directory.' }
      Remove-Item -LiteralPath $staging -Recurse -Force
    }
  }
}
