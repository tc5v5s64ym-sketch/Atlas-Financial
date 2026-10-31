<#
.SYNOPSIS
  Fast-forward local main to match GitHub. Never discards work.

.DESCRIPTION
  GitHub main moves when pull requests merge. This folder does not. Run this
  at the start of a session, or install the scheduled task so it happens
  hourly and at logon.

  Safety contract — the script will:
    - fetch and prune
    - fast-forward local main only
    - leave the current branch alone if it is not main
    - refuse to touch a dirty worktree that has main checked out
    - refuse a non-fast-forward update

  It will never:
    - push
    - force-update
    - hard-reset the working tree
    - switch you off a feature branch
    - bypass hooks
    - update feature branches

  Logs to %LOCALAPPDATA%\atlas-financial\sync-main.log

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\sync-main.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\sync-main.ps1 -InstallTask
#>
[CmdletBinding()]
param(
    [switch]$InstallTask,
    [switch]$UninstallTask,
    [switch]$StatusOnly,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

$TaskName = 'AtlasFinancial-SyncMain'
$LogDir = Join-Path $env:LOCALAPPDATA 'atlas-financial'
$LogFile = Join-Path $LogDir 'sync-main.log'

function Get-ProjectRoot {
    $common = & git rev-parse --path-format=absolute --git-common-dir 2>$null
    if ($LASTEXITCODE -eq 0 -and $common) {
        return (Split-Path -Parent ($common -replace '/', '\').TrimEnd('\'))
    }
    return (Split-Path -Parent $PSScriptRoot)
}

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '{0}  {1}  {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    if (-not (Test-Path -LiteralPath $LogDir)) {
        New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    }
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
    if (Test-Path -LiteralPath $LogFile) {
        $item = Get-Item -LiteralPath $LogFile
        if ($item.Length -gt 1MB) {
            $kept = Get-Content -LiteralPath $LogFile -Tail 200
            Set-Content -LiteralPath $LogFile -Value $kept -Encoding UTF8
        }
    }
    if (-not $Quiet) {
        $color = switch ($Level) {
            'ERROR' { 'Red' }
            'WARN'  { 'Yellow' }
            'OK'    { 'Green' }
            default { 'White' }
        }
        Write-Host $Message -ForegroundColor $color
    }
}

function Get-WorktreeList {
    $raw = & git worktree list --porcelain
    $trees = @()
    $current = $null
    foreach ($line in $raw) {
        if ($line -match '^worktree (.+)$') {
            if ($current) { $trees += $current }
            $current = [pscustomobject]@{ Path = $Matches[1]; Branch = ''; Head = '' }
        } elseif ($line -match '^HEAD (.+)$' -and $current) {
            $current.Head = $Matches[1]
        } elseif ($line -match '^branch refs/heads/(.+)$' -and $current) {
            $current.Branch = $Matches[1]
        }
    }
    if ($current) { $trees += $current }
    return $trees
}

function Test-TrackedDirty {
    param([string]$Path)
    $status = & git -C $Path status --porcelain --untracked-files=no
    return [bool]$status
}

function Get-AheadBehind {
    param([string]$Left, [string]$Right)
    $pair = & git rev-list --left-right --count "$Left...$Right"
    $parts = $pair.Trim() -split '\s+'
    return [pscustomobject]@{ Ahead = [int]$parts[0]; Behind = [int]$parts[1] }
}

function Install-SyncTask {
    param([string]$Root)
    $script = Join-Path $PSScriptRoot 'sync-main.ps1'
    if (-not (Test-Path -LiteralPath $script)) { throw "Script not found: $script" }

    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

    $arg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -Quiet"
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg -WorkingDirectory $Root
    $logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $start = (Get-Date).Date.AddHours((Get-Date).Hour).AddHours(1)
    $hourly = New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval (New-TimeSpan -Hours 2) -RepetitionDuration (New-TimeSpan -Days 3650)
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($logon, $hourly) -Settings $settings -Principal $principal -Description 'Fast-forward local Atlas Financial main to origin/main. Never force-pushes or discards work.' | Out-Null
    Write-Log "Installed scheduled task '$TaskName' (at logon + every 2 hours)." 'OK'
    Write-Log "Log: $LogFile"
}

function Uninstall-SyncTask {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Log "Scheduled task '$TaskName' is not installed."
        return
    }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Log "Removed scheduled task '$TaskName'." 'OK'
}

function Sync-LocalMain {
    param([string]$Root, [bool]$ReportOnly)

    Set-Location -LiteralPath $Root

    Write-Log "Fetch origin --prune  ($Root)"
    & git fetch origin --prune
    if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }

    $localMain = (& git rev-parse refs/heads/main).Trim()
    $originMain = (& git rev-parse refs/remotes/origin/main).Trim()
    $currentBranch = (& git rev-parse --abbrev-ref HEAD).Trim()

    Write-Log ("local main    {0}" -f $localMain.Substring(0, 7))
    Write-Log ("origin/main   {0}" -f $originMain.Substring(0, 7))
    Write-Log ("this checkout {0}" -f $currentBranch)

    $worktrees = @(Get-WorktreeList)
    $mainTree = $worktrees | Where-Object { $_.Branch -eq 'main' } | Select-Object -First 1

    if ($localMain -eq $originMain) {
        Write-Log 'main is already synced with GitHub.' 'OK'
        Show-WorktreeNotes $worktrees
        return 0
    }

    & git merge-base --is-ancestor refs/heads/main refs/remotes/origin/main
    if ($LASTEXITCODE -ne 0) {
        Write-Log 'local main has diverged from origin/main. Refusing to update — this is not a fast-forward.' 'ERROR'
        return 1
    }

    $counts = Get-AheadBehind 'refs/heads/main' 'refs/remotes/origin/main'
    Write-Log ("local main is {0} commit(s) behind origin/main." -f $counts.Behind) 'WARN'

    if ($ReportOnly) {
        Write-Log 'Status only — no refs updated.'
        Show-WorktreeNotes $worktrees
        return 2
    }

    if ($mainTree) {
        if (Test-TrackedDirty $mainTree.Path) {
            Write-Log ("Cannot fast-forward main: dirty tracked files in {0}" -f $mainTree.Path) 'ERROR'
            return 2
        }
        Write-Log ("Fast-forwarding main in {0}" -f $mainTree.Path)
        & git -C $mainTree.Path merge --ff-only origin/main
        if ($LASTEXITCODE -ne 0) { throw 'git merge --ff-only failed' }
    } else {
        Write-Log 'main is not checked out; updating the local main ref only.'
        & git update-ref refs/heads/main $originMain $localMain
        if ($LASTEXITCODE -ne 0) { throw 'git update-ref failed' }
    }

    $now = (& git rev-parse refs/heads/main).Trim()
    if ($now -ne $originMain) {
        Write-Log 'main still does not match origin/main after update.' 'ERROR'
        return 1
    }

    Write-Log ("main fast-forwarded to {0}" -f $now.Substring(0, 7)) 'OK'
    Show-WorktreeNotes (Get-WorktreeList)
    return 0
}

function Show-WorktreeNotes {
    param($Worktrees)
    foreach ($wt in $Worktrees) {
        if (-not $wt.Branch -or $wt.Branch -eq 'main') { continue }
        $upstreamRef = '{0}@{{upstream}}' -f $wt.Branch
        $upstream = $null
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $upstream = & git rev-parse --abbrev-ref --symbolic-full-name $upstreamRef 2>$null
            if ($LASTEXITCODE -ne 0) { $upstream = $null }
        } catch {
            $upstream = $null
        } finally {
            $ErrorActionPreference = $prev
        }
        if (-not $upstream) { continue }
        $ab = Get-AheadBehind $wt.Branch $upstream
        if ($ab.Behind -gt 0 -or $ab.Ahead -gt 0) {
            Write-Log ("note: {0} at {1} is {2} ahead / {3} behind {4} (not updated)" -f $wt.Branch, $wt.Path, $ab.Ahead, $ab.Behind, $upstream)
        }
    }
}

$root = Get-ProjectRoot
if (-not (Test-Path (Join-Path $root '.git'))) {
    throw "Not an Atlas checkout: $root"
}

try {
    if ($InstallTask) {
        Install-SyncTask -Root $root
        exit 0
    }
    if ($UninstallTask) {
        Uninstall-SyncTask
        exit 0
    }
    $code = Sync-LocalMain -Root $root -ReportOnly:([bool]$StatusOnly)
    exit $code
} catch {
    Write-Log $_.Exception.Message 'ERROR'
    exit 1
}
