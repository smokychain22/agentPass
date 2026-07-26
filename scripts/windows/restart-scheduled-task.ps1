<#
.SYNOPSIS
  Stops and restarts the RepoDietOkxSellerRuntime scheduled task, and
  clears a stale lock file if the previous process already exited.
  Used to verify restart-after-failure behavior without a machine reboot.
#>

$TaskName = "RepoDietOkxSellerRuntime"
$LockFile = "$env:LOCALAPPDATA\RepoDiet\okx-seller-runtime\runtime.lock"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Output "Scheduled task '$TaskName' is not installed. Run install-scheduled-task.ps1 first."
    exit 1
}

Write-Output "Stopping task '$TaskName' (simulating a failure/termination)..."
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

Start-Sleep -Seconds 2

if (Test-Path $LockFile) {
    $lockPid = (Get-Content $LockFile -Raw -ErrorAction SilentlyContinue).Trim()
    $proc = Get-Process -Id $lockPid -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Output "Clearing stale lock file (PID $lockPid no longer running)."
        Remove-Item -Path $LockFile -Force -ErrorAction SilentlyContinue
    }
}

Write-Output "Starting task '$TaskName'..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

$task | Get-ScheduledTaskInfo
Write-Output ""
Write-Output "Run status-scheduled-task.ps1 to confirm the runtime resumed heartbeats."
