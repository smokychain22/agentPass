<#
.SYNOPSIS
  Stops and removes the RepoDietOkxSellerRuntime scheduled task and its
  local runtime state (lock file, logs, encrypted secret). Does not touch
  any OKX Agent, service, or Vercel configuration.
#>

param(
    [switch]$KeepLogs
)

$TaskName = "RepoDietOkxSellerRuntime"
$RuntimeDir = "$env:LOCALAPPDATA\RepoDiet\okx-seller-runtime"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Write-Output "Stopping and unregistering task '$TaskName'..."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
} else {
    Write-Output "Scheduled task '$TaskName' was not installed."
}

Remove-Item -Path "$RuntimeDir\runtime.lock" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$RuntimeDir\secrets" -Recurse -Force -ErrorAction SilentlyContinue

if (-not $KeepLogs) {
    Remove-Item -Path "$RuntimeDir\logs" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Output "Removed lock file, encrypted secret, and logs."
} else {
    Write-Output "Removed lock file and encrypted secret. Logs kept at $RuntimeDir\logs (-KeepLogs)."
}
