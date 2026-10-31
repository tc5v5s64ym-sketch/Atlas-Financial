# CurrentUser DPAPI helper. Arguments are paths/modes only — never a secret.
# Protect: UTF-8 bytes on stdin -> encrypted blob at -Path.
# Unprotect: blob at -Path -> UTF-8 bytes on stdout (no extra newline).
# Never writes plaintext to stderr or the host.

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('protect', 'unprotect')]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'

function Fail([string]$Message) {
  [Console]::Error.WriteLine($Message)
  exit 1
}

try {
  Add-Type -AssemblyName System.Security
} catch {
  Fail 'Windows Data Protection is unavailable.'
}

$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser

if ($Mode -eq 'protect') {
  $stdin = [Console]::OpenStandardInput()
  $ms = New-Object System.IO.MemoryStream
  $stdin.CopyTo($ms)
  $plain = $ms.ToArray()
  if ($plain.Length -eq 0) { Fail 'credential input was empty' }
  try {
    $protected = [System.Security.Cryptography.ProtectedData]::Protect($plain, $null, $scope)
  } catch {
    Fail 'Windows Data Protection could not encrypt the credential.'
  }
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  [System.IO.File]::WriteAllBytes($Path, $protected)
  exit 0
}

if (-not (Test-Path -LiteralPath $Path)) { Fail 'credential file is missing' }
try {
  $blob = [System.IO.File]::ReadAllBytes($Path)
  $plain = [System.Security.Cryptography.ProtectedData]::Unprotect($blob, $null, $scope)
} catch {
  Fail 'Windows Data Protection could not decrypt the credential.'
}
if ($plain.Length -eq 0) { Fail 'decrypted credential was empty' }
$stdout = [Console]::OpenStandardOutput()
$stdout.Write($plain, 0, $plain.Length)
$stdout.Flush()
exit 0
