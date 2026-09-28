$ErrorActionPreference = "Stop"
$installRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $installRoot ".env"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$taskName = "UW Accounting Local Server"
Add-Type -AssemblyName System.Net.Http
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

function ConvertFrom-SecurePrompt {
  param([Parameter(Mandatory = $true)][Security.SecureString]$Value)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Read-RequiredSecret {
  param([Parameter(Mandatory = $true)][string]$Prompt)
  $secure = Read-Host $Prompt -AsSecureString
  try {
    $plain = ConvertFrom-SecurePrompt $secure
    if ([string]::IsNullOrWhiteSpace($plain)) {
      throw "A value is required for: $Prompt"
    }
    return $plain
  } finally {
    $secure.Dispose()
  }
}

function Read-ConfirmedPassphrase {
  param([Parameter(Mandatory = $true)][string]$Name)
  $first = Read-RequiredSecret "$Name's existing passphrase (input is hidden)"
  try {
    $second = Read-RequiredSecret "Re-enter $Name's existing passphrase"
    if (-not [string]::Equals($first, $second, [StringComparison]::Ordinal)) {
      throw "The two entries for $Name did not match. No passphrase was saved."
    }
    if ($first.Length -lt 12) {
      throw "$Name's passphrase is shorter than the configured 12-character minimum."
    }
    return $first
  } catch {
    $first = $null
    throw
  }
}

function Test-SupabaseEndpoint {
  param(
    [Parameter(Mandatory = $true)][System.Net.Http.HttpClient]$Client,
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$Label
  )
  try {
    $response = $Client.GetAsync($Uri).GetAwaiter().GetResult()
    try {
      if (-not $response.IsSuccessStatusCode) {
        throw "Supabase $Label check failed (HTTP $([int]$response.StatusCode)). Confirm the service-role key and run the required SQL migrations."
      }
    } finally {
      $response.Dispose()
    }
  } catch {
    if ($_.Exception.Message -like "Supabase $Label check failed*") { throw }
    throw "Supabase $Label check could not reach the project: $($_.Exception.Message)"
  }
}

function Write-LocalEnv {
  param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Values)
  $lines = foreach ($key in $Values.Keys) {
    $value = [string]$Values[$key]
    if ($key -eq "UW_AUTH_USERS_JSON") {
      "$key='$value'"
    } else {
      $escaped = $value.Replace('\', '\\').Replace('"', '\"')
      "$key=`"$escaped`""
    }
  }
  $temporaryPath = "$envPath.$PID.tmp"
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($temporaryPath, [string[]]$lines, $utf8NoBom)
  Move-Item -Path $temporaryPath -Destination $envPath -Force

  $fileAcl = New-Object System.Security.AccessControl.FileSecurity
  $fileAcl.SetAccessRuleProtection($true, $false)
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
    $fileAcl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $envPath -AclObject $fileAcl
}

if (-not (Test-Path (Join-Path $installRoot "server.js"))) {
  throw "Run this setup from the installed copy under $env:LOCALAPPDATA\UWAccountingSystem."
}

$existing = @{}
if (Test-Path $envPath) {
  $parseCode = 'const fs=require("fs");const d=require("dotenv").parse(fs.readFileSync(process.argv[1]));process.stdout.write(JSON.stringify(d));'
  $rawExisting = & $nodePath -e $parseCode $envPath
  if ($LASTEXITCODE -ne 0) { throw "Could not safely read the existing local environment file." }
  $parsedExisting = ($rawExisting -join "`n") | ConvertFrom-Json
  foreach ($property in $parsedExisting.PSObject.Properties) {
    $existing[$property.Name] = [string]$property.Value
  }
}

Write-Host ""
Write-Host "UW local authentication and integration setup"
Write-Host "Secrets entered below stay on this PC. Passphrases and keys are hidden while typing and are never printed."
Write-Host "Use the same Brian and Evans passphrases as before. Retrieve the existing Supabase and Google secrets from your provider settings."
Write-Host ""

$brianPassword = Read-ConfirmedPassphrase "Brian"
try {
  $evansPassword = Read-ConfirmedPassphrase "Evans"
  try {
    $supabaseDefault = if ($existing["SUPABASE_URL"]) { $existing["SUPABASE_URL"] } else { "https://ubmbfkgbyhxnaylhuuul.supabase.co" }
    $supabaseUrl = (Read-Host "Supabase project URL [$supabaseDefault]").Trim().TrimEnd('/')
    if (-not $supabaseUrl) { $supabaseUrl = $supabaseDefault }
    $parsedUrl = $null
    if (-not [Uri]::TryCreate($supabaseUrl, [UriKind]::Absolute, [ref]$parsedUrl) -or $parsedUrl.Scheme -ne "https" -or $parsedUrl.Host -notmatch '\.supabase\.co$') {
      throw "Enter the HTTPS project URL shown in Supabase Project Settings → API."
    }
    $serviceRoleKey = Read-RequiredSecret "Supabase service-role secret key (not the anon/publishable key; input is hidden)"
    $googleClientId = (Read-Host "Google OAuth Web client ID (press Enter to keep the configured/default ID)").Trim()
    if (-not $googleClientId) {
      $googleClientId = $existing["GOOGLE_CLIENT_ID"]
    }
    if (-not $googleClientId) {
      $googleClientId = "543852392281-hgn4dojctifs8lh31lldullqd7bsfmd5.apps.googleusercontent.com"
    }
    if ($googleClientId -notmatch '^[0-9]+-[A-Za-z0-9-]+\.apps\.googleusercontent\.com$') {
      throw "The Google OAuth client ID does not look like a Web application client ID."
    }
    $googleClientSecret = Read-RequiredSecret "Google OAuth client secret from the same Web client (input is hidden)"
    $redirectUri = (Read-Host "Google redirect URI (press Enter to use local default)").Trim()
    if (-not $redirectUri) {
      $redirectUri = "http://localhost:8080/api/google-drive/callback"
    }
    if ($redirectUri -ne "http://localhost:8080/api/google-drive/callback") {
      throw "For this local installation, use exactly http://localhost:8080/api/google-drive/callback and register it in the Google Web OAuth client."
    }

    $tokenEncryptionKey = $existing["UW_TOKEN_ENCRYPTION_KEY"]
    if (-not $tokenEncryptionKey) {
      $secureEncryptionKey = Read-Host "Existing UW_TOKEN_ENCRYPTION_KEY from the previous deployment (input is hidden; Enter only if unavailable)" -AsSecureString
      try {
        $tokenEncryptionKey = ConvertFrom-SecurePrompt $secureEncryptionKey
      } finally {
        $secureEncryptionKey.Dispose()
      }
    }
    if (-not $tokenEncryptionKey) {
      $bytes = New-Object byte[] 32
      $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
      try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
      $tokenEncryptionKey = [Convert]::ToBase64String($bytes)
      $bytes = $null
      Write-Warning "A new encryption key will be created. Previously encrypted Google Drive tokens cannot be decrypted; reconnect Google Drive once setup finishes."
      $confirmNewKey = Read-Host "Type RECONNECT to continue with a new key"
      if ($confirmNewKey -cne "RECONNECT") {
        throw "Setup cancelled; the existing encryption key is required to preserve saved Google Drive credentials."
      }
    }
    try {
      $decodedKey = [Convert]::FromBase64String($tokenEncryptionKey)
      if ($decodedKey.Length -ne 32) { throw "The encryption key must decode to exactly 32 bytes." }
    } catch {
      throw "UW_TOKEN_ENCRYPTION_KEY must be the existing base64-encoded 32-byte key. Do not use the generated example from the README."
    }

    $workspace = (Read-Host "Supabase workspace ID (press Enter for the existing/default value)").Trim()
    if (-not $workspace) { $workspace = if ($existing["SUPABASE_WORKSPACE"]) { $existing["SUPABASE_WORKSPACE"] } else { "default" } }
    $stateTable = if ($existing["SUPABASE_STATE_TABLE"]) { $existing["SUPABASE_STATE_TABLE"] } else { "uw_accounting_data" }
    $documentBucket = if ($existing["SUPABASE_DOCUMENT_BUCKET"]) { $existing["SUPABASE_DOCUMENT_BUCKET"] } else { "uw-documents" }
    $sessionTable = if ($existing["SUPABASE_SESSION_TABLE"]) { $existing["SUPABASE_SESSION_TABLE"] } else { "uw_auth_sessions" }
    $secretTable = if ($existing["SUPABASE_SECRET_TABLE"]) { $existing["SUPABASE_SECRET_TABLE"] } else { "uw_secure_secrets" }
    foreach ($table in @($stateTable, $sessionTable, $secretTable, "uw_documents")) {
      if ($table -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw "Invalid Supabase table identifier: $table" }
    }
    if ($documentBucket -notmatch '^[A-Za-z0-9_-]+$') { throw "Invalid Supabase Storage bucket name." }

    Write-Host "Checking the Supabase project, required tables, and private documents bucket..."
    $http = New-Object System.Net.Http.HttpClient
    try {
      $http.Timeout = [TimeSpan]::FromSeconds(20)
      $http.DefaultRequestHeaders.Add("apikey", $serviceRoleKey)
      $http.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $serviceRoleKey)
      $tableQueries = @(
        @{ Name = "account state"; Table = $stateTable; Select = "workspace_id" },
        @{ Name = "durable login sessions"; Table = $sessionTable; Select = "token_hash" },
        @{ Name = "encrypted Drive secrets"; Table = $secretTable; Select = "secret_name" },
        @{ Name = "document registry"; Table = "uw_documents"; Select = "storage_path" }
      )
      foreach ($query in $tableQueries) {
        $encodedTable = [Uri]::EscapeDataString($query.Table)
        $select = [Uri]::EscapeDataString($query.Select)
        $uri = "$supabaseUrl/rest/v1/$encodedTable`?select=$select&limit=1"
        Test-SupabaseEndpoint -Client $http -Uri $uri -Label $query.Name
        Write-Host "  OK: $($query.Name)"
      }
      $bucket = [Uri]::EscapeDataString($documentBucket)
      $storageUri = "$supabaseUrl/storage/v1/object/list/$bucket"
      $body = New-Object System.Net.Http.StringContent('{"prefix":"","limit":1,"offset":0}', [Text.Encoding]::UTF8, "application/json")
      $response = $http.PostAsync($storageUri, $body).GetAwaiter().GetResult()
      try {
        if (-not $response.IsSuccessStatusCode) {
          throw "Supabase private bucket check failed (HTTP $([int]$response.StatusCode)). Confirm the '$documentBucket' bucket and service-role access."
        }
      } finally {
        $body.Dispose()
        $response.Dispose()
      }
      Write-Host "  OK: private document bucket"
    } finally {
      $http.Dispose()
    }

    $envValues = [ordered]@{}
    foreach ($key in $existing.Keys) { $envValues[$key] = $existing[$key] }
    $envValues["PORT"] = "8080"
    $envValues["HOST"] = "127.0.0.1"
    $envValues["NODE_ENV"] = "development"
    $envValues["UW_DATA_DIR"] = Join-Path $installRoot "data"
    $envValues["UW_DOCUMENTS_DIR"] = Join-Path $installRoot "data\documents"
    if ($existing["UW_API_KEY"]) {
      $envValues["UW_API_KEY"] = $existing["UW_API_KEY"]
    } else {
      $apiKeyBytes = New-Object byte[] 32
      $randomNumberGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
      try {
        $randomNumberGenerator.GetBytes($apiKeyBytes)
        $envValues["UW_API_KEY"] = ([BitConverter]::ToString($apiKeyBytes)).Replace("-", "").ToLowerInvariant()
      } finally {
        $randomNumberGenerator.Dispose()
        [Array]::Clear($apiKeyBytes, 0, $apiKeyBytes.Length)
      }
    }
    $envValues["UW_AUTH_USERS_JSON"] = ""
    $envValues["UW_TOKEN_ENCRYPTION_KEY"] = $tokenEncryptionKey
    $envValues["SUPABASE_URL"] = $supabaseUrl
    $envValues["SUPABASE_SERVICE_ROLE_KEY"] = $serviceRoleKey
    $envValues["SUPABASE_WORKSPACE"] = $workspace
    $envValues["SUPABASE_STATE_TABLE"] = $stateTable
    $envValues["SUPABASE_DOCUMENT_BUCKET"] = $documentBucket
    $envValues["SUPABASE_SESSION_TABLE"] = $sessionTable
    $envValues["SUPABASE_SECRET_TABLE"] = $secretTable
    $envValues["GOOGLE_CLIENT_ID"] = $googleClientId
    $envValues["GOOGLE_CLIENT_SECRET"] = $googleClientSecret
    $envValues["GOOGLE_REDIRECT_URI"] = $redirectUri

    $env:UW_LOCAL_AUTH_INPUT = ConvertTo-Json -InputObject @{ brian = $brianPassword; evans = $evansPassword } -Compress
    try {
      $authJson = & $nodePath (Join-Path $PSScriptRoot "hash-local-auth-users.js")
      if ($LASTEXITCODE -ne 0) { throw "Local passphrase hashing failed." }
      $envValues["UW_AUTH_USERS_JSON"] = ($authJson -join "`n").Trim()
    } finally {
      Remove-Item Env:\UW_LOCAL_AUTH_INPUT -ErrorAction SilentlyContinue
    }
    Write-LocalEnv -Values $envValues
    $envValues.Clear()
    $existing.Clear()
    $serviceRoleKey = $null
    $googleClientSecret = $null
    $tokenEncryptionKey = $null
    $decodedKey = $null
  } catch {
      $brianPassword = $null
      $evansPassword = $null
      throw
  }
} catch {
  $brianPassword = $null
  throw
}

Write-Host "Local environment saved with account passphrase hashes and file permissions restricted to this Windows user, SYSTEM, and Administrators."
Write-Host "Restarting the local server and verifying both profiles, Supabase access, and the Google OAuth redirect..."

$taskControl = Join-Path $installRoot "scripts\local-server-task.ps1"
$powershellPath = Join-Path $PSHOME "powershell.exe"
& $powershellPath -NoProfile -ExecutionPolicy Bypass -File $taskControl Stop
if ($LASTEXITCODE -ne 0) { throw "The existing local server task could not be stopped." }
& $powershellPath -NoProfile -ExecutionPolicy Bypass -File $taskControl Start
if ($LASTEXITCODE -ne 0) { throw "The local server task could not be restarted. The protected configuration remains saved." }

$deadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Seconds 1
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/health" -TimeoutSec 3
    if ($health.ok) { break }
  } catch {}
} while ((Get-Date) -lt $deadline)
if (-not $health -or -not $health.ok) {
  throw "The local server did not become healthy. Configuration is saved; inspect data\logs\server.log."
}

$authConfig = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/auth/config" -TimeoutSec 10
if (-not $authConfig.configured -or @($authConfig.users).Count -ne 2) {
  throw "The local server did not load both authorized profiles."
}
$driveConfig = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/google-drive/config" -TimeoutSec 10
if (-not $driveConfig.clientConfigured -or $driveConfig.redirectUri -ne $redirectUri) {
  throw "Google OAuth client configuration did not load with the local redirect URI."
}

$handler = New-Object System.Net.Http.HttpClientHandler
$handler.CookieContainer = New-Object System.Net.CookieContainer
$handler.AllowAutoRedirect = $false
$client = New-Object System.Net.Http.HttpClient($handler)
try {
  foreach ($account in @(
    @{ Name = "Brian"; Identifier = "brian"; Password = $brianPassword },
    @{ Name = "Evans"; Identifier = "evans"; Password = $evansPassword }
  )) {
    $json = ConvertTo-Json -InputObject @{ email = $account.Identifier; password = $account.Password } -Compress
    $content = New-Object System.Net.Http.StringContent($json, [Text.Encoding]::UTF8, "application/json")
    $response = $client.PostAsync("http://127.0.0.1:8080/api/auth/login", $content).GetAwaiter().GetResult()
    try {
      if ([int]$response.StatusCode -ne 200) { throw "$($account.Name)'s existing passphrase did not authenticate locally (HTTP $([int]$response.StatusCode))." }
    } finally {
      $content.Dispose()
      $response.Dispose()
    }
    Write-Host "  OK: $($account.Name)'s passphrase authenticates"
  }

  $supabaseResponse = $client.GetAsync("http://127.0.0.1:8080/api/supabase/status").GetAwaiter().GetResult()
  try {
    if (-not $supabaseResponse.IsSuccessStatusCode) { throw "The local app could not authenticate to Supabase (HTTP $([int]$supabaseResponse.StatusCode))." }
    $supabaseStatus = $supabaseResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
    if (-not $supabaseStatus.connected) { throw "The local app reports Supabase disconnected." }
    Write-Host "  OK: app-level Supabase state API"
  } finally {
    $supabaseResponse.Dispose()
  }

  $driveStatusResponse = $client.GetAsync("http://127.0.0.1:8080/api/google-drive/status").GetAwaiter().GetResult()
  try {
    if (-not $driveStatusResponse.IsSuccessStatusCode) { throw "The local Google Drive status check failed (HTTP $([int]$driveStatusResponse.StatusCode))." }
    $driveStatus = $driveStatusResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
  } finally {
    $driveStatusResponse.Dispose()
  }

  $authRequest = $client.GetAsync("http://127.0.0.1:8080/api/google-drive/auth").GetAwaiter().GetResult()
  try {
    if ([int]$authRequest.StatusCode -ne 302 -or -not $authRequest.Headers.Location) {
      throw "The Google authorization endpoint did not produce a sign-in redirect."
    }
    $authorizationUri = [Uri]$authRequest.Headers.Location
    Add-Type -AssemblyName System.Web
    $query = [System.Web.HttpUtility]::ParseQueryString($authorizationUri.Query)
    if ($query.Get("redirect_uri") -ne $redirectUri) {
      throw "The Google authorization URL does not contain the configured local redirect URI."
    }
    Write-Host "  OK: Google OAuth authorization URL and callback"
  } finally {
    $authRequest.Dispose()
  }

  $logout = $client.PostAsync("http://127.0.0.1:8080/api/auth/logout", (New-Object System.Net.Http.StringContent("{}", [Text.Encoding]::UTF8, "application/json"))).GetAwaiter().GetResult()
  $logout.Dispose()
} finally {
  $client.Dispose()
  $handler.Dispose()
  $brianPassword = $null
  $evansPassword = $null
}

if (-not $driveStatus.connected) {
  Write-Warning "Google OAuth is configured and its callback is verified, but no saved Drive authorization was restored. Open the app and choose Sign in with Google Drive once to authorize this installation."
} else {
  Write-Host "  OK: saved Google Drive authorization restored"
}

Write-Host "Setup complete. Open http://localhost:8080. The app uses the same Brian and Evans passphrases, and Supabase and Drive OAuth configuration passed local checks."
