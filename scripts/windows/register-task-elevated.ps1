<#
.SYNOPSIS
  Registers (or atomically replaces) the RepoDietOkxSellerRuntime scheduled
  task. Requires an elevated (Administrator) PowerShell session - Task
  Scheduler registration is denied under a standard user token in this
  environment.

  Run install-scheduled-task.ps1 first (non-elevated is fine - it only
  encrypts the heartbeat secret to disk). Then run THIS script from an
  elevated PowerShell prompt.

.NOTES
  Fail-closed by design:
  - Never unregisters the existing task before the new definition is built
    and validated; Register-ScheduledTask -Force replaces atomically, so
    there is no window where the task does not exist.
  - Exports the previous task definition (if any) to a timestamped backup
    XML before replacing it, and restores it automatically if registration
    fails.
  - Every Scheduled Tasks cmdlet call uses -ErrorAction Stop so failures
    throw instead of silently continuing.
  - Never prints a success message unless the final task object is
    independently re-queried and confirmed to exist.
  - Exits 1 on any failure.
#>

$ErrorActionPreference = "Stop"
$TaskName = "RepoDietOkxSellerRuntime"
$ScriptPath = Join-Path $PSScriptRoot "okx-seller-runtime.ps1"
$BackupDir = "$env:LOCALAPPDATA\RepoDiet\okx-seller-runtime\task-backups"

function Fail {
    param([string]$Message)
    Write-Error $Message
    exit 1
}

try {
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

    $previousTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $backupPath = $null
    if ($previousTask) {
        $backupPath = Join-Path $BackupDir "$TaskName-$(Get-Date -Format yyyyMMddHHmmss).xml"
        Export-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-File -FilePath $backupPath -Encoding utf8
        Write-Output "Backed up existing task definition to: $backupPath"
    } else {
        Write-Output "No existing task found - this is a fresh install, not a replace."
    }

    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""

    # Main trigger: start at logon.
    $logonTrigger = New-ScheduledTaskTrigger -AtLogOn

    # Watchdog trigger: fires every 1 minute for a bounded 3650-day (10 year)
    # window - a valid, in-range ISO 8601 duration (P3650D / PT1M), unlike
    # [TimeSpan]::MaxValue which serializes to an out-of-range value
    # (P99999999DT23H59M59S) that Task Scheduler rejects. -RepetitionInterval
    # and -RepetitionDuration must be passed directly to New-ScheduledTaskTrigger
    # (only the -Once parameter set supports them together); assigning
    # .Repetition.Duration / .Repetition.Interval after construction fails
    # with "property not found" because .Repetition is null until built this way.
    # MultipleInstances=IgnoreNew makes firing this while the runtime is
    # already alive a safe no-op; it only matters when the runtime has died
    # and Task Scheduler's own RestartOnFailure did not recover it (observed
    # to be unreliable here for externally-killed, not self-exited, workers).
    $watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval (New-TimeSpan -Minutes 1) `
        -RepetitionDuration (New-TimeSpan -Days 3650)

    $triggers = @($logonTrigger, $watchdogTrigger)

    $settings = New-ScheduledTaskSettingsSet `
        -MultipleInstances IgnoreNew `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -StartWhenAvailable `
        -DontStopOnIdleEnd `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries

    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

    try {
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
    } catch {
        Write-Error "Register-ScheduledTask failed: $($_.Exception.Message)"
        if ($backupPath -and (Test-Path $backupPath)) {
            Write-Output "Attempting to restore the previous task definition from backup..."
            try {
                Register-ScheduledTask -TaskName $TaskName -Xml (Get-Content $backupPath -Raw) -ErrorAction Stop | Out-Null
                Write-Output "Previous task definition restored successfully."
            } catch {
                Write-Error "Restore from backup ALSO failed: $($_.Exception.Message). Task '$TaskName' may not exist. Backup XML is at: $backupPath"
            }
        }
        exit 1
    }

    # Verify - never trust the absence of an exception as proof of success.
    $verifiedTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $verifiedTask) {
        Fail "Registration returned no error, but the task does not exist on re-query. Treating as failure."
    }

    Write-Output "Scheduled task '$TaskName' registered and verified present:"
    Write-Output "  - Triggers: AtLogOn ($env:USERDOMAIN\$env:USERNAME) + watchdog every 1 minute (Daily/P1D/PT1M)"
    Write-Output "  - MultipleInstances: IgnoreNew - prevents duplicate instances at the Task Scheduler level."
    Write-Output "  - RestartCount: 999, RestartInterval: 1 minute - restart after failure."
    Write-Output ""
    Write-Output "Starting the task now for an immediate first run..."
    Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    Start-Sleep -Seconds 2
    $verifiedTask | Get-ScheduledTaskInfo
} catch {
    Write-Error "register-task-elevated.ps1 failed: $($_.Exception.Message)"
    exit 1
}
