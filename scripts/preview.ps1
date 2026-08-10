<#
.SYNOPSIS
  Serve the site locally so changes can be checked before they are deployed.

.DESCRIPTION
  The live site is password-gated and `data.json` sits at the repo root while the
  page is served from `public/`, so opening `public/index.html` directly does not
  work -- app.js fetches `/data.json` and gets a 404.

  This stages both into one directory and serves it statically, with no password
  and no server.js. It is a rendering check only: the auth and security behaviour
  of the real server is NOT exercised here.

  Verify before pushing. A change that breaks the page is invisible in a diff.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\preview.ps1
#>
[CmdletBinding()]
param(
    [int]$Port = 8899,
    [string]$StageDir = (Join-Path $env:TEMP 'atlas-preview')
)

$ErrorActionPreference = 'Stop'

function Get-ProjectRoot {
    $common = & git rev-parse --path-format=absolute --git-common-dir 2>$null
    if ($LASTEXITCODE -eq 0 -and $common) {
        return (Split-Path -Parent ($common -replace '/', '\').TrimEnd('\'))
    }
    return (Split-Path -Parent $PSScriptRoot)
}

# Serve the working tree being edited, not the main checkout -- otherwise this
# previews whatever was last merged rather than the change under review.
$src = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $src 'public'))) { $src = Get-ProjectRoot }

$publicDir = Join-Path $src 'public'
$dataFile = Join-Path $src 'data.json'
foreach ($p in @($publicDir, $dataFile)) {
    if (-not (Test-Path $p)) { throw "Not found: $p" }
}

New-Item -ItemType Directory -Path $StageDir -Force | Out-Null
Get-ChildItem $StageDir -File | Remove-Item -Force
Copy-Item (Join-Path $publicDir '*') -Destination $StageDir -Recurse -Force
Copy-Item $dataFile -Destination $StageDir -Force

# Fail loudly here rather than as a blank page in the browser.
try { Get-Content $dataFile -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null }
catch { throw "data.json is not valid JSON: $_" }

& node --check (Join-Path $publicDir 'app.js')
if ($LASTEXITCODE -ne 0) { throw 'public/app.js has a syntax error' }

Write-Host "Serving $src"
Write-Host "  staged to $StageDir"
Write-Host "  http://localhost:$Port"
Write-Host ''
Write-Host 'Rendering check only -- password and security behaviour are not exercised.'
Write-Host ''

& npx --yes http-server $StageDir -p $Port -c-1
