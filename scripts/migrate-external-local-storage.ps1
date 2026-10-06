param(
  [string]$InstallRoot=(Join-Path $env:LOCALAPPDATA 'UWAccountingSystem'),
  [string]$ExternalRoot='D:\UW FOREVER',
  [string]$SourceLibrary='D:\UW'
)
$ErrorActionPreference='Stop'
$InstallRoot=(Resolve-Path -LiteralPath $InstallRoot).Path
$ExternalRoot=(Resolve-Path -LiteralPath $ExternalRoot).Path.TrimEnd('\')
if($ExternalRoot -eq [IO.Path]::GetPathRoot($ExternalRoot).TrimEnd('\')){throw 'Choose a named external folder, not the drive root.'}
function Hash-File([string]$Path){
  $stream=[IO.File]::OpenRead($Path);$sha=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','')}
  finally{$stream.Dispose();$sha.Dispose()}
}
function Verified-Copy([string]$Source,[string]$Destination){
  if(-not [IO.Path]::GetFullPath($Destination).StartsWith($ExternalRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Copy destination escaped the external folder.'}
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  & robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
  if($LASTEXITCODE -ge 8){throw "Copy failed: $Source"}
  $count=0
  foreach($file in Get-ChildItem -LiteralPath $Source -File -Recurse -Force){
    $target=Join-Path $Destination $file.FullName.Substring($Source.Length+1)
    if(-not (Test-Path -LiteralPath $target) -or (Hash-File $file.FullName) -ne (Hash-File $target)){throw "Copy verification failed: $target"}
    $count++
  }
  Write-Output "Verified $count copied files at $Destination"
}
$originalData=Join-Path $InstallRoot 'data'
$newData=Join-Path $ExternalRoot 'Accounting Data'
$configPath=Join-Path $InstallRoot 'local-storage.json'
if(Test-Path -LiteralPath $configPath){throw 'A storage configuration already exists. Review it before running migration again.'}
if(Test-Path -LiteralPath (Join-Path $newData 'uw-state.json')){throw 'The destination already contains a ledger. Migration will not overwrite it.'}
$originalBackupAction=(Get-ScheduledTask -TaskName 'UW Accounting Daily Local Backup').Actions
$backupActionChanged=$false
$envHash=Hash-File (Join-Path $InstallRoot '.env')
# Stage the reference library while the server is still running. Only the ledger
# copy and path switch require stopping the application.
$library=Join-Path $ExternalRoot 'Source Library\UW'
if(Test-Path -LiteralPath $SourceLibrary){Verified-Copy (Resolve-Path -LiteralPath $SourceLibrary).Path $library}
$control=Join-Path $InstallRoot 'scripts\local-server-task.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $control Stop
if($LASTEXITCODE -ne 0){throw 'Could not stop the app before migrating.'}
try{
  Verified-Copy $originalData $newData
  $state=Get-Content -LiteralPath (Join-Path $newData 'uw-state.json') -Raw | ConvertFrom-Json
  if(-not $state.data){throw 'Migrated ledger is invalid.'}
  foreach($folder in @('Local Backups','Saved Invoices','Saved Quotes')){New-Item -ItemType Directory -Path (Join-Path $ExternalRoot $folder) -Force | Out-Null}
  $account="$env:USERDOMAIN\$env:USERNAME"
  & icacls.exe $newData /inheritance:r /grant:r "${account}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' /Q
  if($LASTEXITCODE -ne 0){throw 'Could not preserve private access to the new application data directory.'}
  $config=@{localOnly=$true;dataRoot=$newData;documentsRoot=(Join-Path $newData 'documents');sourceRoot=$library;additionalSourceRoots=@((Join-Path $ExternalRoot 'Saved Invoices'),(Join-Path $ExternalRoot 'Saved Quotes'));invoicesRoot=(Join-Path $ExternalRoot 'Saved Invoices');quotesRoot=(Join-Path $ExternalRoot 'Saved Quotes')}
  [IO.File]::WriteAllText($configPath,($config|ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
  if((Hash-File (Join-Path $InstallRoot '.env')) -ne $envHash){throw 'Existing credentials changed unexpectedly.'}
  $backupScript=Join-Path $InstallRoot 'scripts\backup-local-data.ps1'
  $arguments='-NoProfile -ExecutionPolicy Bypass -File "{0}" -AppRoot "{1}" -DataRoot "{2}" -EnvironmentFile "{3}" -SourceRoots "{4}"' -f $backupScript,$InstallRoot,$newData,(Join-Path $InstallRoot '.env'),$library
  $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
  Set-ScheduledTask -TaskName 'UW Accounting Daily Local Backup' -Action $action | Out-Null
  $backupActionChanged=$true
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $control Start
  if($LASTEXITCODE -ne 0){throw 'Could not start the migrated application.'}
  Write-Output "Primary ledger and managed documents migrated to $newData. Original copies retained at $originalData."
  Write-Output "Daily backups now read the external datastore and write to $ExternalRoot\Local Backups."
}catch{
  if($backupActionChanged){Set-ScheduledTask -TaskName 'UW Accounting Daily Local Backup' -Action $originalBackupAction | Out-Null}
  if(Test-Path -LiteralPath $configPath){Remove-Item -LiteralPath $configPath -Force}
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $control Start
  throw
}
