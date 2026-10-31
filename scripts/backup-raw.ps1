<#
.SYNOPSIS
  Mirrors raw/ (and scripts/local-config.json) into OneDrive.

.DESCRIPTION
  raw/ is gitignored by design, so GitHub is not a backup. Some of it cannot be
  re-fetched: TD's transaction window is 18 months and card statements are
  retained 12. This copies it into the owner's own OneDrive so a disk failure
  is not a total loss.

  Read-only against the source. Nothing in raw/ is ever modified.

  The destination is a MIRROR: a file deleted from raw/ is deleted from the
  backup on the next run. That is intentional -- it keeps the backup a faithful
  copy rather than an ever-growing pile -- but it means the backup does not
  protect against an accidental deletion that goes unnoticed. Guards below
  refuse to mirror an empty or shrunken source for exactly that reason.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\backup-raw.ps1
#>
[CmdletBinding()]
param(
    # Defaults to the main working tree's raw/, resolved via git so this works
    # unchanged from inside a worktree (where raw/ does not exist).
    [string]$Source,
    [string]$Destination = (Join-Path $env:OneDrive 'atlas-financial-backup'),
    # Mirror deletions through even when the source has shrunk a lot. Off by
    # default so a half-deleted raw/ cannot silently destroy the backup.
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Get-ProjectRoot {
    $common = & git rev-parse --path-format=absolute --git-common-dir 2>$null
    if ($LASTEXITCODE -eq 0 -and $common) {
        return (Split-Path -Parent ($common -replace '/', '\').TrimEnd('\'))
    }
    return (Split-Path -Parent $PSScriptRoot)
}

$projectRoot = Get-ProjectRoot
if (-not $Source) { $Source = Join-Path $projectRoot 'raw' }

Write-Host "Project root : $projectRoot"
Write-Host "Source       : $Source"
Write-Host "Destination  : $Destination"
Write-Host ''

# --- Guards ------------------------------------------------------------------

if (-not (Test-Path -LiteralPath $Source)) {
    throw "Source does not exist: $Source"
}
if (-not $env:OneDrive) {
    throw 'No $env:OneDrive on this machine. Pass -Destination explicitly.'
}

$srcFiles = @(Get-ChildItem -LiteralPath $Source -Recurse -File -Force)
$srcBytes = ($srcFiles | Measure-Object -Property Length -Sum).Sum
if (-not $srcBytes) { $srcBytes = 0 }

if ($srcFiles.Count -eq 0) {
    throw "Source holds no files. Refusing to mirror an empty directory over the backup."
}

$rawDest = Join-Path $Destination 'raw'
if ((Test-Path -LiteralPath $rawDest) -and -not $Force) {
    $prev = @(Get-ChildItem -LiteralPath $rawDest -Recurse -File -Force |
              Where-Object { $_.Name -ne 'MANIFEST.txt' })
    if ($prev.Count -gt 0 -and $srcFiles.Count -lt [math]::Floor($prev.Count * 0.8)) {
        throw ("Source has $($srcFiles.Count) files but the backup holds $($prev.Count). " +
               'That is a big shrink -- refusing to mirror the deletions. ' +
               'Re-run with -Force if the deletions are intended.')
    }
}

Write-Host ("Backing up {0} files, {1} MB" -f $srcFiles.Count, [math]::Round($srcBytes / 1MB, 2))

# --- Mirror ------------------------------------------------------------------

if (-not (Test-Path -LiteralPath $Destination)) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
}

# /MIR mirror, /R:2 /W:2 short retries, /NFL /NDL /NJH quiet, /NP no progress.
& robocopy $Source $rawDest /MIR /R:2 /W:2 /NFL /NDL /NJH /NP | Out-Null
$rc = $LASTEXITCODE
if ($rc -ge 8) { throw "robocopy failed with exit code $rc" }

# scripts/local-config.json is gitignored too and holds the account fragments
# the analysis scripts need. Small, and equally unbacked-up.
$localConfig = Join-Path $projectRoot 'scripts\local-config.json'
if (Test-Path -LiteralPath $localConfig) {
    Copy-Item -LiteralPath $localConfig -Destination (Join-Path $Destination 'local-config.json') -Force
    Write-Host 'Also copied scripts/local-config.json'
}

# --- Verify ------------------------------------------------------------------

$dstFiles = @(Get-ChildItem -LiteralPath $rawDest -Recurse -File -Force |
              Where-Object { $_.Name -ne 'MANIFEST.txt' })
$dstBytes = ($dstFiles | Measure-Object -Property Length -Sum).Sum
if (-not $dstBytes) { $dstBytes = 0 }

if ($dstFiles.Count -ne $srcFiles.Count -or $dstBytes -ne $srcBytes) {
    throw ("Verification FAILED. source $($srcFiles.Count) files / $srcBytes bytes, " +
           "backup $($dstFiles.Count) files / $dstBytes bytes.")
}

# Hash manifest, so a later run can prove the copy is still intact rather than
# merely present. Lives in the destination only.
$lines = @("atlas-financial raw/ backup manifest",
           "written  : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
           "source   : $Source",
           "files    : $($srcFiles.Count)",
           "bytes    : $srcBytes",
           '')
foreach ($f in ($srcFiles | Sort-Object FullName)) {
    $rel = $f.FullName.Substring($Source.Length).TrimStart('\')
    $h = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
    $lines += ('{0}  {1,10}  {2}' -f $h, $f.Length, $rel)
}
$lines | Out-File -FilePath (Join-Path $rawDest 'MANIFEST.txt') -Encoding utf8

Write-Host ''
Write-Host ("OK  {0} files / {1} MB verified at {2}" -f `
            $dstFiles.Count, [math]::Round($dstBytes / 1MB, 2), $rawDest)
Write-Host 'SHA-256 manifest written to MANIFEST.txt in the backup.'

# robocopy returns 1 for "files were copied", which would otherwise become this
# script's exit code and read as a failure to any scheduler.
exit 0
