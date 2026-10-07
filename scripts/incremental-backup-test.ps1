$ErrorActionPreference='Stop'
$script=Join-Path $PSScriptRoot 'backup-local-data.ps1'
$root=Join-Path ([IO.Path]::GetTempPath()) ('uw-incremental-test-'+[guid]::NewGuid().ToString('N'))
$app=Join-Path $root 'app';$data=Join-Path $root 'data';$invoices=Join-Path $root 'invoices';$quotes=Join-Path $root 'quotes';$source=Join-Path $root 'UW';$backups=Join-Path $root 'backups'
function Assert($Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Throws([scriptblock]$Action,[string]$Message){$failed=$false;try{& $Action}catch{$failed=$true};Assert $failed $Message}
function Run-Backup {
  & $script -AppRoot $app -DataRoot $data -BackupRoot $backups -InvoicesRoot $invoices -QuotesRoot $quotes -SourceRoots @($source) -EnvironmentFile (Join-Path $app '.env') -RetentionCount 1
  return (Get-ChildItem -LiteralPath $backups -Directory | Where-Object Name -like 'UWAccounting-*' | Sort-Object Name -Descending | Select-Object -First 1).FullName
}
function Manifest([string]$Snapshot){Get-Content -LiteralPath (Join-Path $Snapshot 'backup-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json}
try {
  foreach($folder in @($app,$data,$invoices,$quotes,$source)){New-Item -ItemType Directory -Path $folder -Force|Out-Null}
  New-Item -ItemType Directory -Path (Join-Path $source 'empty-folder') | Out-Null
  Set-Content -LiteralPath (Join-Path $app 'server.js') -Value 'application code' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $app '.env') -Value 'TEST_KEY=fixture-private-configuration' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $data 'uw-state.json') -Value '{"revision":7,"data":{"invoices":[],"quotes":[]}}' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $invoices 'invoice.pdf') -Value 'same document bytes' -Encoding UTF8
  Copy-Item -LiteralPath (Join-Path $invoices 'invoice.pdf') -Destination (Join-Path $quotes 'quote.pdf')
  Set-Content -LiteralPath (Join-Path $source 'old.txt') -Value 'old source content' -Encoding UTF8
  $first=Run-Backup;$m1=Manifest $first
  Assert ($m1.schemaVersion -eq 3 -and $m1.newObjects -eq 5) 'Identical documents were not deduplicated.'
  Assert ($m1.fileCount -eq 6) 'Logical file inventory is incomplete.'
  $second=Run-Backup;$m2=Manifest $second
  Assert ($m2.newObjects -eq 0 -and $m2.newBytes -eq 0) 'Unchanged backup copied data again.'
  $lock=[IO.File]::Open((Join-Path $backups '.incremental-backup.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try {Throws {Run-Backup|Out-Null} 'Concurrent incremental backup was allowed.'} finally {$lock.Dispose()}
  $stamp=(Get-Item -LiteralPath (Join-Path $source 'old.txt')).LastWriteTimeUtc
  Set-Content -LiteralPath (Join-Path $source 'old.txt') -Value 'new source content' -Encoding UTF8
  (Get-Item -LiteralPath (Join-Path $source 'old.txt')).LastWriteTimeUtc=$stamp
  $third=Run-Backup;$m3=Manifest $third
  Assert ($m3.newObjects -eq 1) 'Changed content with the same timestamp was missed.'
  Remove-Item -LiteralPath (Join-Path $source 'old.txt')
  Rename-Item -LiteralPath (Join-Path $quotes 'quote.pdf') -NewName 'renamed.pdf'
  $fourth=Run-Backup;$m4=Manifest $fourth
  Assert ($m4.newObjects -eq 0 -and $m4.fileCount -eq 5) 'Deletion or rename recopied unchanged contents.'
  Assert ((Get-ChildItem -LiteralPath $backups -Directory | Where-Object Name -like 'UWAccounting-*').Count -eq 4) 'Incremental history was deleted.'
  foreach($snapshot in @($first,$second,$third,$fourth)){& $script -VerifyPath $snapshot}
  $restoreFirst=Join-Path $root 'restored-first';$restoreFourth=Join-Path $root 'restored-fourth'
  & $script -RestorePath $first -RestoreDestination $restoreFirst
  & $script -RestorePath $fourth -RestoreDestination $restoreFourth
  Assert ((Get-Content -LiteralPath (Join-Path $restoreFirst 'Source Library/UW/old.txt') -Raw).Trim() -eq 'old source content') 'An older snapshot did not restore its original data.'
  Assert (-not (Test-Path -LiteralPath (Join-Path $restoreFourth 'Source Library/UW/old.txt'))) 'Deleted file reappeared in the newest restore.'
  Assert (Test-Path -LiteralPath (Join-Path $restoreFourth 'Saved Quotes/renamed.pdf')) 'Renamed document did not restore.'
  Assert (-not (Test-Path -LiteralPath (Join-Path $restoreFourth 'Saved Quotes/quote.pdf'))) 'Old filename reappeared in the newest restore.'
  Assert (Test-Path -LiteralPath (Join-Path $restoreFourth 'Source Library/UW/empty-folder') -PathType Container) 'Empty source folder was lost.'
  Assert (-not ((Get-Content -LiteralPath (Join-Path $restoreFourth 'local-environment.dpapi') -Raw) -match 'fixture-private')) 'Restored configuration is plaintext.'
  Throws {& $script -RestorePath $first -RestoreDestination $restoreFourth} 'Restore overwrote an existing destination.'
  $before=(Get-ChildItem -LiteralPath $backups -Directory | Where-Object Name -like 'UWAccounting-*').Count
  Set-Content -LiteralPath (Join-Path $data 'uw-state.json') -Value 'invalid ledger'
  Throws {Run-Backup|Out-Null} 'Invalid ledger was backed up as a valid snapshot.'
  Assert ((Get-ChildItem -LiteralPath $backups -Directory | Where-Object Name -like 'UWAccounting-*').Count -eq $before) 'A failed backup was published.'
  $hash=($m4.files | Where-Object path -eq 'Saved Invoices/invoice.pdf').sha256
  $object=Join-Path (Join-Path $backups '_objects') ($hash.Substring(0,2)+'/'+$hash)
  Set-Content -LiteralPath $object -Value 'tampered object'
  Throws {& $script -VerifyPath $fourth} 'Corrupt object passed verification.'
  Throws {& $script -RestorePath $fourth -RestoreDestination (Join-Path $root 'corrupt-restore')} 'Corrupt snapshot was restored.'
  Assert (-not (Test-Path -LiteralPath (Join-Path $root 'corrupt-restore'))) 'A corrupt restore was published.'
  $m4.files[0].path='../escape.txt'
  $m4 | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $fourth 'backup-manifest.json') -Encoding UTF8
  Throws {& $script -RestorePath $fourth -RestoreDestination (Join-Path $root 'escaped-restore')} 'Invalid manifest path was accepted.'
  Write-Host 'Incremental backup tests passed: deduplication, zero-copy unchanged runs, unchanged timestamps, deletion/rename history, independent restores, encryption, failures and corruption.'
} finally {
  if(Test-Path -LiteralPath $root){if(-not ([IO.Path]::GetFullPath($root)).StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)){throw 'Test cleanup escaped Temp.'};Remove-Item -LiteralPath $root -Recurse -Force}
}
