param(
  [string]$DataRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) "data"),
  [string]$BackupRoot = "D:\UW FOREVER\Local Backups",
  [string]$InvoicesRoot = "D:\UW FOREVER\Saved Invoices",
  [string]$QuotesRoot = "D:\UW FOREVER\Saved Quotes",
  [ValidateRange(1, 365)]
  [int]$RetentionCount = 30
)

$ErrorActionPreference = "Stop"
$DataRoot = [System.IO.Path]::GetFullPath($DataRoot)
$BackupRoot = [System.IO.Path]::GetFullPath($BackupRoot)
if (-not (Test-Path -LiteralPath $DataRoot -PathType Container)) {
  throw "Local application data folder does not exist: $DataRoot"
}
if ($BackupRoot.StartsWith("$DataRoot\", [StringComparison]::OrdinalIgnoreCase)) {
  throw "The backup destination must not be inside the application data folder."
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
  & robocopy.exe $DataRoot $temporary /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XD "logs" "upload-tmp"
  if ($LASTEXITCODE -ge 8) {
    throw "Copying local accounting data failed (robocopy exit code $LASTEXITCODE)."
  }
  foreach ($savedRoot in @(
    @{ Source = $InvoicesRoot; Destination = (Join-Path $temporary "Saved Invoices") },
    @{ Source = $QuotesRoot; Destination = (Join-Path $temporary "Saved Quotes") }
  )) {
    New-Item -ItemType Directory -Path $savedRoot.Destination -Force | Out-Null
    if (Test-Path -LiteralPath $savedRoot.Source -PathType Container) {
      & robocopy.exe $savedRoot.Source $savedRoot.Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1
      if ($LASTEXITCODE -ge 8) {
        throw "Copying saved documents from $($savedRoot.Source) failed (robocopy exit code $LASTEXITCODE)."
      }
    }
  }

  $manifest = [ordered]@{
    createdAt = (Get-Date).ToString("o")
    source = $DataRoot
    contents = "Local state, state backup, and managed documents. Environment secrets are excluded."
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $temporary "backup-manifest.json"), ($manifest | ConvertTo-Json), $utf8NoBom)
  Move-Item -LiteralPath $temporary -Destination $destination

  $backups = @(Get-ChildItem -LiteralPath $BackupRoot -Directory |
    Where-Object { $_.Name -match '^UWAccounting-\d{8}-\d{6}-\d{3}$' } |
    Sort-Object Name -Descending)
  foreach ($oldBackup in $backups | Select-Object -Skip $RetentionCount) {
    Remove-Item -LiteralPath $oldBackup.FullName -Recurse -Force
  }
  Write-Host "Local accounting backup created: $destination"
} finally {
  if (Test-Path -LiteralPath $temporary) {
    Remove-Item -LiteralPath $temporary -Recurse -Force
  }
}
