$ErrorActionPreference = "Stop"
$installRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $installRoot ".env"
$taskControl = Join-Path $installRoot "scripts\local-server-task.ps1"

if (-not (Test-Path (Join-Path $installRoot "server.js"))) {
  throw "Run this setup from the installed copy under $env:LOCALAPPDATA\UWAccountingSystem."
}
if (-not (Test-Path $envPath)) {
  throw "The local integration configuration was not found. Configure local integrations first."
}

$secureKey = Read-Host "New Gemini API key (input is hidden; revoke any key previously pasted into chat)" -AsSecureString
$pointer = [IntPtr]::Zero
$temporaryPath = $null
$lines = $null
try {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
  if ($pointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
  $secureKey.Dispose()
}

try {
  if ([string]::IsNullOrWhiteSpace($apiKey) -or $apiKey.Length -lt 20 -or $apiKey.Length -gt 512) {
    throw "The Gemini API key must contain between 20 and 512 characters."
  }
  if ($apiKey.Contains("'") -or $apiKey.Contains("`r") -or $apiKey.Contains("`n")) {
    throw "The Gemini API key contains characters that cannot be safely stored in the local environment file."
  }

  $lines = [System.Collections.Generic.List[string]]::new()
  if (Test-Path $envPath) {
    foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
      if ($line -notmatch '^\s*GEMINI_API_KEY\s*=') {
        $lines.Add($line)
      }
    }
  }
  $lines.Add("GEMINI_API_KEY='$apiKey'")

  $temporaryPath = "$envPath.$PID.tmp"
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  $owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl
  $allow = [System.Security.AccessControl.AccessControlType]::Allow
  foreach ($principalName in @($owner, "SYSTEM", "BUILTIN\Administrators")) {
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      $principalName,
      $fullControl,
      [System.Security.AccessControl.InheritanceFlags]::None,
      [System.Security.AccessControl.PropagationFlags]::None,
      $allow
    )
    $acl.AddAccessRule($rule)
  }
  New-Item -ItemType File -Path $temporaryPath -Force | Out-Null
  Set-Acl -LiteralPath $temporaryPath -AclObject $acl
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($temporaryPath, $lines.ToArray(), $utf8NoBom)
  Move-Item -LiteralPath $temporaryPath -Destination $envPath -Force
} finally {
  if ($temporaryPath -and (Test-Path $temporaryPath)) {
    Remove-Item -LiteralPath $temporaryPath -Force
  }
  if ($lines) {
    $lines.Clear()
  }
  $apiKey = $null
}

& (Join-Path $PSHOME "powershell.exe") -NoProfile -ExecutionPolicy Bypass -File $taskControl Stop
if ($LASTEXITCODE -ne 0) {
  throw "The local server could not be stopped. The protected Gemini setting was saved."
}
& (Join-Path $PSHOME "powershell.exe") -NoProfile -ExecutionPolicy Bypass -File $taskControl Start
if ($LASTEXITCODE -ne 0) {
  throw "The local server could not be restarted. The protected Gemini setting was saved."
}

$deadline = (Get-Date).AddSeconds(45)
$aiConfig = $null
do {
  Start-Sleep -Seconds 1
  try {
    $aiConfig = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/ai/config" -TimeoutSec 3
  } catch {}
} while ((-not $aiConfig) -and (Get-Date) -lt $deadline)

if (-not $aiConfig -or -not $aiConfig.configured -or -not $aiConfig.providers.gemini) {
  throw "The server restarted, but Gemini is not reported as configured. Inspect data\logs\server.log without sharing secrets."
}

Write-Host "Gemini is configured on the local server. The API key remains in the ACL-restricted .env and was not sent to the browser."
Write-Host "Open http://localhost:8080 and retry the AI review."
