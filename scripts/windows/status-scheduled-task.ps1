<#
.SYNOPSIS
  Reports RepoDietOkxSellerRuntime scheduled-task state and tails recent
  runtime log lines. Read-only - makes no changes.
#>

$TaskName = "RepoDietOkxSellerRuntime"
$LogFile = "$env:LOCALAPPDATA\RepoDiet\okx-seller-runtime\logs\runtime.log"
$LockFile = "$env:LOCALAPPDATA\RepoDiet\okx-seller-runtime\runtime.lock"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Output "Scheduled task '$TaskName' is not installed."
    exit 1
}

$info = $task | Get-ScheduledTaskInfo
Write-Output "Task: $TaskName"
Write-Output "  State:            $($task.State)"
Write-Output "  Last run time:    $($info.LastRunTime)"
Write-Output "  Last result:      $($info.LastTaskResult)"
Write-Output "  Next run time:    $($info.NextRunTime)"
Write-Output "  Number of missed: $($info.NumberOfMissedRuns)"

if (Test-Path $LockFile) {
    $lockPid = (Get-Content $LockFile -Raw -ErrorAction SilentlyContinue).Trim()
    $proc = Get-Process -Id $lockPid -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Output "  Lock file PID:    $lockPid (alive, started $($proc.StartTime))"
    } else {
        Write-Output "  Lock file PID:    $lockPid (stale - process not running)"
    }
} else {
    Write-Output "  Lock file:        none"
}

Write-Output ""
Write-Output "Last 20 log lines:"
if (Test-Path $LogFile) {
    Get-Content $LogFile -Tail 20
} else {
    Write-Output "  (no log file yet - task may not have run)"
}
