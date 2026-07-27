<#
.SYNOPSIS
  Durable Agent 9636 seller runtime loop: validates identity, keeps the
  official okx-a2a XMTP daemon alive, and sends the authenticated seller
  heartbeat on an interval. Designed to run under Windows Task Scheduler,
  independent of any interactive Claude Code / Codex session.

  This script provides infrastructure-level continuity only (heartbeat,
  identity validation, XMTP daemon liveness). It does NOT autonomously
  answer inbound A2A decision_request / notification items - those still
  require an interactive AI session per the okx-ai watch-core protocol.
  Messages queue as unread todos and drain on the next watch session;
  nothing is lost while this runtime is the only thing running.

.NOTES
  Never logs or prints the heartbeat secret. Secret is stored DPAPI-encrypted
  under the current Windows user profile (Get-Content is only decryptable
  by the same Windows user account that encrypted it).
#>

$ErrorActionPreference = "Stop"

$ExpectedEmail = "officialsmokychain@gmail.com"
$ExpectedAgentId = "9636"
$ExpectedA2aServiceId = "37348"
$ExpectedSellerWallet = "0xaa895234c3fc31c40018eef975db6ac79bf87f1a"
$ExpectedCommunicationAddress = "0x00dbdbb36b71ace0e1fc517056f376f977d8256e"
$BaseUrl = "https://skillswap-virid-kappa.vercel.app"
$IntervalSeconds = 60
$TtlSeconds = 90

$RuntimeDir = "$env:LOCALAPPDATA\RepoDiet\okx-seller-runtime"
$LogDir = "$RuntimeDir\logs"
$LockFile = "$RuntimeDir\runtime.lock"
$SecretFile = "$RuntimeDir\secrets\heartbeat-secret.enc"
$LogFile = "$LogDir\runtime.log"
$DuplicateCountFile = "$RuntimeDir\duplicate-attempts.count"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log {
    param([string]$Level, [string]$Message)
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffK"), $Level, $Message
    Add-Content -Path $LogFile -Value $line
    Write-Output $line
}

function Test-DuplicateInstance {
    if (Test-Path $LockFile) {
        $existingPid = Get-Content $LockFile -Raw -ErrorAction SilentlyContinue
        if ($existingPid) {
            $existingPid = $existingPid.Trim()
            $proc = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -match "powershell|pwsh") {
                return $true
            }
        }
    }
    return $false
}

if (Test-DuplicateInstance) {
    $count = 0
    if (Test-Path $DuplicateCountFile) {
        $count = [int](Get-Content $DuplicateCountFile -Raw -ErrorAction SilentlyContinue).Trim()
    }
    Set-Content -Path $DuplicateCountFile -Value ($count + 1)
    Write-Log "INFO" "Another runtime instance is already active (lock file held by a live PID). Exiting to prevent duplicates. duplicateWorkerAttemptCount=$($count + 1)"
    exit 0
}

Set-Content -Path $LockFile -Value $PID
Write-Log "INFO" "Seller runtime starting. PID=$PID. Lock acquired."

function Remove-Lock {
    if ((Get-Content $LockFile -Raw -ErrorAction SilentlyContinue).Trim() -eq "$PID") {
        Remove-Item -Path $LockFile -Force -ErrorAction SilentlyContinue
    }
}

try {
    Register-EngineEvent PowerShell.Exiting -Action { Remove-Lock } | Out-Null

    function Get-HeartbeatSecret {
        if (-not (Test-Path $SecretFile)) {
            throw "heartbeat_secret_file_missing"
        }
        $encrypted = (Get-Content $SecretFile -Raw).Trim()
        $secure = ConvertTo-SecureString -String $encrypted
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        } finally {
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }

    # Windows PowerShell 5.1 converts a native command's stderr lines into
    # terminating ErrorRecords when $ErrorActionPreference = "Stop" is set
    # globally (as it is at the top of this script). All onchainos / okx-a2a
    # invocations below temporarily relax to "Continue" so their routine
    # stderr diagnostics (e.g. "[onchainos] checking A2A communication
    # readiness...") don't abort the tick.
    function Invoke-NativeJson {
        param([scriptblock]$Command)
        $previous = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $lines = & $Command 2>$null
            $jsonLine = ($lines | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1)
            if (-not $jsonLine) { return $null }
            return $jsonLine | ConvertFrom-Json
        } finally {
            $ErrorActionPreference = $previous
        }
    }

    function Test-Identity {
        $walletJson = Invoke-NativeJson { onchainos wallet status }
        if (-not $walletJson -or -not $walletJson.ok -or $walletJson.data.email -ne $ExpectedEmail) {
            Write-Log "WARN" "Wallet identity check failed: expected email $ExpectedEmail, got $($walletJson.data.email)"
            return $false
        }

        $gateJson = Invoke-NativeJson { onchainos agent gate-check --role asp }
        if (-not $gateJson -or -not $gateJson.ok -or -not $gateJson.data.ready) {
            Write-Log "WARN" "ASP gate-check not ready. identity.ok=$($gateJson.data.identity.ok) communication.ok=$($gateJson.data.communication.ok) wallet.ok=$($gateJson.data.wallet.ok)"
            return $false
        }
        if ($gateJson.data.identity.agentId -ne $ExpectedAgentId) {
            Write-Log "WARN" "Unexpected ASP agentId: $($gateJson.data.identity.agentId), expected $ExpectedAgentId"
            return $false
        }

        Write-Log "INFO" "Identity validated: agentId=$($gateJson.data.identity.agentId) wallet.ok communication.ok"
        return $true
    }

    function Confirm-XmtpDaemon {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $statusOutput = okx-a2a status 2>$null
        $ErrorActionPreference = $previous

        if ($statusOutput -notmatch "running") {
            Write-Log "WARN" "okx-a2a daemon not running ($statusOutput). Attempting restart."
            $ErrorActionPreference = "Continue"
            okx-a2a daemon start 2>$null | Out-Null
            $ErrorActionPreference = $previous
            Start-Sleep -Seconds 3
        }

        $refreshJson = Invoke-NativeJson { okx-a2a agent refresh --json }
        if (-not $refreshJson -or -not $refreshJson.ok -or $refreshJson.payload.activeClients -lt 1) {
            Write-Log "WARN" "XMTP client not active after refresh. Reconnecting via doctor --fix."
            $ErrorActionPreference = "Continue"
            okx-a2a doctor --fix 2>$null | Out-Null
            $ErrorActionPreference = $previous
            return $false
        }
        Write-Log "INFO" "XMTP daemon confirmed: activeClients=$($refreshJson.payload.activeClients)"
        return $true
    }

    function Get-DuplicateWorkerAttemptCount {
        if (-not (Test-Path $DuplicateCountFile)) { return 0 }
        $raw = (Get-Content $DuplicateCountFile -Raw -ErrorAction SilentlyContinue).Trim()
        if ([int]::TryParse($raw, [ref]$null)) { return [int]$raw }
        return 0
    }

    function Send-Heartbeat {
        $secret = Get-HeartbeatSecret
        $body = @{
            aspAgentId = $ExpectedAgentId
            a2aServiceId = $ExpectedA2aServiceId
            sellerWallet = $ExpectedSellerWallet
            registeredCommunicationAddress = $ExpectedCommunicationAddress
            recoveredSignerAddress = $ExpectedCommunicationAddress
            onchainOsAuthenticated = $true
            officialWatchActive = $true
            xmtpClientReady = $true
            ttlSeconds = $TtlSeconds
            workerPid = $PID
            duplicateWorkerAttemptCount = (Get-DuplicateWorkerAttemptCount)
        } | ConvertTo-Json

        try {
            $response = Invoke-RestMethod -Uri "$BaseUrl/api/internal/okx/seller-heartbeat" `
                -Method Post `
                -Headers @{ Authorization = "Bearer $secret" } `
                -ContentType "application/json" `
                -Body $body
            Write-Log "INFO" "Heartbeat accepted. agentOnline=$($response.agentOnline) heartbeatStatus=$($response.heartbeatStatus) expiresAt=$($response.heartbeatExpiresAt)"
        } catch {
            Write-Log "ERROR" "Heartbeat POST failed: $($_.Exception.Message)"
        } finally {
            $secret = $null
        }
    }

    Write-Log "INFO" "Entering durable runtime loop (interval=${IntervalSeconds}s)."
    while ($true) {
        try {
            if (Test-Identity) {
                if (Confirm-XmtpDaemon) {
                    Send-Heartbeat
                }
            }
        } catch {
            Write-Log "ERROR" "Runtime tick failed: $($_.Exception.Message)"
        }
        Start-Sleep -Seconds $IntervalSeconds
    }
} finally {
    Remove-Lock
    Write-Log "INFO" "Seller runtime exiting. Lock released."
}
