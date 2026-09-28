$ErrorActionPreference = "Stop"
$backupScript = Join-Path $PSScriptRoot "backup-local-data.ps1"
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "uw-backup-test-$PID"
$appRoot = Join-Path $testRoot "app"
$dataRoot = Join-Path $appRoot "data"
$invoiceRoot = Join-Path $testRoot "invoices"
$quoteRoot = Join-Path $testRoot "quotes"
$sourceRoot = Join-Path $testRoot "UW"
$backupRoot = Join-Path $testRoot "backups"
$environmentFile = Join-Path $appRoot ".env"

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Throws([scriptblock]$Action, [string]$Message) {
  $threw = $false
  try {
    & $Action
  } catch {
    $threw = $true
  }
  Assert-True $threw $Message
}

try {
  foreach ($folder in @(
    $appRoot,
    (Join-Path $appRoot "scripts"),
    (Join-Path $appRoot "node_modules"),
    (Join-Path $appRoot ".git"),
    (Join-Path $appRoot ".agents"),
    $dataRoot,
    (Join-Path $dataRoot "documents"),
    (Join-Path $dataRoot "logs"),
    (Join-Path $dataRoot "upload-tmp"),
    $invoiceRoot,
    $quoteRoot,
    $sourceRoot,
    (Join-Path $sourceRoot "2026"),
    $backupRoot
  )) {
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
  }
  Set-Content -LiteralPath (Join-Path $appRoot "server.js") -Value "application code" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $appRoot "scripts\backup-local-data.ps1") -Value "recovery script" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $appRoot "node_modules\library.js") -Value "rebuildable dependency" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $appRoot ".git\history") -Value "rebuildable version history" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $appRoot ".agents\private-config") -Value "private agent configuration" -Encoding UTF8
  $snapshot = [ordered]@{
    version = 1
    revision = 7
    updatedAt = (Get-Date).ToString("o")
    data = [ordered]@{ invoices = @(); scannedDocuments = @(); fnbStatements = @() }
  } | ConvertTo-Json -Depth 8
  Set-Content -LiteralPath (Join-Path $dataRoot "uw-state.json") -Value $snapshot -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $dataRoot "uw-state.json.bak") -Value $snapshot -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $dataRoot "documents\scan.bin") -Value "managed document bytes" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $dataRoot "logs\server.log") -Value "runtime log excluded" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $dataRoot "upload-tmp\unfinished.tmp") -Value "unfinished upload excluded" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $invoiceRoot "invoice.pdf") -Value "invoice bytes" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $quoteRoot "quote.pdf") -Value "quote bytes" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $sourceRoot "2026\receipt.pdf") -Value "reference archive bytes" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $sourceRoot ".hidden-index") -Value "hidden source file" -Encoding UTF8
  Set-Content -LiteralPath $environmentFile -Value "GEMINI_API_KEY=backup-test-secret`r`n" -Encoding UTF8

  & $backupScript `
    -AppRoot $appRoot `
    -DataRoot $dataRoot `
    -BackupRoot $backupRoot `
    -InvoicesRoot $invoiceRoot `
    -QuotesRoot $quoteRoot `
    -SourceRoots @($sourceRoot) `
    -EnvironmentFile $environmentFile `
    -RetentionCount 5
  $backup = Get-ChildItem -LiteralPath $backupRoot -Directory | Select-Object -First 1
  Assert-True ($null -ne $backup) "Backup script did not create a backup directory."
  $manifestPath = Join-Path $backup.FullName "backup-manifest.json"
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-True ($manifest.schemaVersion -eq 2) "Expected a versioned integrity manifest."
  Assert-True ($manifest.files.Count -eq $manifest.fileCount) "Manifest file count does not match its inventory."
  Assert-True ((Test-Path (Join-Path $backup.FullName "Application Files\server.js")) -and (Test-Path (Join-Path $backup.FullName "Application Files\scripts\backup-local-data.ps1"))) "Application recovery files are missing."
  Assert-True (-not (Test-Path (Join-Path $backup.FullName "Application Files\node_modules\library.js"))) "Rebuildable dependencies should not be copied."
  Assert-True (-not (Test-Path (Join-Path $backup.FullName "Application Files\.git\history"))) "Git history should not be copied into the local backup."
  Assert-True (-not (Test-Path (Join-Path $backup.FullName "Application Files\.env"))) "Plaintext environment configuration must not be backed up."
  Assert-True ($manifest.files.group -contains "Source Library\UW" -or $manifest.files.group -contains "Source Library/UW") "Source library was omitted from the backup."
  Assert-True ((Test-Path (Join-Path $backup.FullName "Saved Invoices\invoice.pdf")) -and (Test-Path (Join-Path $backup.FullName "Saved Quotes\quote.pdf"))) "Saved invoice or quote export is missing."
  Assert-True ((Test-Path (Join-Path $backup.FullName "Source Library\UW\.hidden-index")) -and (Test-Path (Join-Path $backup.FullName "Source Library\UW\2026\receipt.pdf"))) "Visible or hidden source files were omitted."
  Assert-True (-not (Test-Path (Join-Path $backup.FullName "Application Data\logs\server.log"))) "Runtime logs should not be backed up."
  Assert-True (-not (Test-Path (Join-Path $backup.FullName "Application Data\upload-tmp\unfinished.tmp"))) "Incomplete temporary uploads should not be backed up."
  $encryptedEnvironment = Get-Content -LiteralPath (Join-Path $backup.FullName "local-environment.dpapi") -Raw -Encoding UTF8
  Assert-True ($encryptedEnvironment -notmatch "backup-test-secret") "Environment secrets must not be stored as plaintext."
  & $backupScript -VerifyPath $backup.FullName

  Set-Content -LiteralPath (Join-Path $backup.FullName "Saved Invoices\invoice.pdf") -Value "modified invoice" -Encoding UTF8
  Assert-Throws { & $backupScript -VerifyPath $backup.FullName } "Verifier accepted a modified backup file."

  Write-Host "Backup test passed: app files, persistent data, managed documents, invoice/quote exports, source files, encrypted configuration, and integrity checks."
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}
