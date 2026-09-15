$ErrorActionPreference = "Stop"
$port = 8080
Write-Host "Starting UW Accounting System at http://localhost:$port"
Write-Host "Keep this window open while using the app. Press Ctrl+C to stop."
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition

$nodeAvailable = $false
$nodePath = $null
try {
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $nodeAvailable = $true
} catch {}
if ($nodeAvailable) {
  Set-Location $root
  & $nodePath server.js
  exit $LASTEXITCODE
}

$pythonAvailable = $false
try {
  & python --version *> $null
  $pythonAvailable = ($LASTEXITCODE -eq 0)
} catch {}
if ($pythonAvailable) {
  Set-Location $root
  python -m http.server $port
  exit $LASTEXITCODE
}

Add-Type -AssemblyName System.Net
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Start-Process "http://localhost:$port/index.html"
$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json"
  ".svg" = "image/svg+xml"
  ".png" = "image/png"
  ".jpg" = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".gif" = "image/gif"
  ".webp" = "image/webp"
  ".pdf" = "application/pdf"
  ".doc" = "application/msword"
  ".docx" = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ".xls" = "application/vnd.ms-excel"
  ".xlsx" = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ".csv" = "text/csv; charset=utf-8"
}
try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($relative)) { $relative = "index.html" }
    $baseRoot = $root
    if ($relative -like '__source/*') {
      $baseRoot = 'D:\UW'
      $relative = $relative.Substring(9)
    }
    $file = Join-Path $baseRoot $relative
    if ((Test-Path $file -PathType Leaf) -and ((Resolve-Path $file).Path.StartsWith($baseRoot, [System.StringComparison]::OrdinalIgnoreCase))) {
      $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $file).Path)
      $extension = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
      $context.Response.ContentType = if ($mime.ContainsKey($extension)) { $mime[$extension] } else { "application/octet-stream" }
      $context.Response.Headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
      $context.Response.StatusCode = 200
      try {
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } catch [System.Net.HttpListenerException] {
        # The browser may cancel a request during navigation; continue serving later requests.
      } catch [System.IO.IOException] {
        # A disconnected client can close the response stream before it is written.
      }
    } else {
      $context.Response.StatusCode = 404
    }
    try { $context.Response.Close() } catch [System.Net.HttpListenerException] {}
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
