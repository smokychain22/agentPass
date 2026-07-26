<#
.SYNOPSIS
  Step 1 of 2 for installing the durable seller runtime: encrypts the
  heartbeat secret to disk (DPAPI, current Windows user only). Does NOT
  require elevation. After this, run register-task-elevated.ps1 from an
  Administrator PowerShell prompt to register the scheduled task itself.

.PARAMETER HeartbeatSecret
  The REPODIET_OKX_RUNTIME_HEARTBEAT_SECRET value. Only used to encrypt
  it to disk - never logged, never written in plaintext, never passed to
  the scheduled task as an argument.

.EXAMPLE
  .\install-scheduled-task.ps1 -HeartbeatSecret "the-secret-value"
  .\register-task-elevated.ps1   # from an elevated prompt
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$HeartbeatSecret
)

$ErrorActionPreference = "Stop"

$RuntimeDir = "$env:LOCALAPPDATA\RepoDiet\okx-seller-runtime"
$SecretsDir = "$RuntimeDir\secrets"

New-Item -ItemType Directory -Force -Path $SecretsDir | Out-Null
New-Item -ItemType Directory -Force -Path "$RuntimeDir\logs" | Out-Null

$secure = ConvertTo-SecureString -String $HeartbeatSecret -AsPlainText -Force
$encrypted = ConvertFrom-SecureString -SecureString $secure
Set-Content -Path "$SecretsDir\heartbeat-secret.enc" -Value $encrypted -Encoding utf8
$HeartbeatSecret = $null
$secure = $null

Write-Output "Heartbeat secret encrypted and stored (DPAPI, current user only). Plaintext discarded from this process."
Write-Output ""
Write-Output "Next: run register-task-elevated.ps1 from an elevated (Administrator) PowerShell prompt"
Write-Output "to register the scheduled task. This OS-level identity (the Windows account) is separate"
Write-Output "from the OKX account the runtime validates against, officialsmokychain@gmail.com - the"
Write-Output "runtime script checks that OKX identity explicitly on every tick before sending a heartbeat."
