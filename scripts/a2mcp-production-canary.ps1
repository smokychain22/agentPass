[CmdletBinding()]
param(
  [ValidateSet("Quote", "Pay")]
  [string]$Stage = "Quote",
  [string]$PaymentId,
  [switch]$ConfirmPayment,
  [string]$OnchainOs = "onchainos",
  [string]$RequestBodyPath = ".repodiet-canary-request.json"
)

$ErrorActionPreference = "Stop"
$uri = "https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage"
$request = [ordered]@{
  repositoryUrl = "https://github.com/velz-cmd/repodiet-e2e-test"
  branch = "main"
  maximumFindings = 10
}

# Write UTF-8 without a BOM, then parse the exact file before any network request.
$json = $request | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText(
  (Join-Path (Get-Location) $RequestBodyPath),
  $json,
  [System.Text.UTF8Encoding]::new($false)
)
$validated = Get-Content -Raw -LiteralPath $RequestBodyPath -Encoding UTF8 | ConvertFrom-Json
if (-not $validated.repositoryUrl -or -not $validated.branch -or $validated.maximumFindings -ne 10) {
  throw "The canary request file failed local JSON validation."
}

$requestArgs = @(
  "--param", "repositoryUrl=$($validated.repositoryUrl)",
  "--param", "branch=$($validated.branch)",
  "--param", "maximumFindings=$($validated.maximumFindings)"
)

if ($Stage -eq "Quote") {
  Write-Host "Validated request body: $RequestBodyPath"
  Write-Host "Request: $json"
  Write-Host "The official client will fetch and interpret the HTTP 402 challenge."
  & $OnchainOs payment quote $uri --method POST @requestArgs
  if ($LASTEXITCODE -ne 0) { throw "The official OKX payment quote command failed." }
  Write-Host "Stop here. Review the quote, then run Stage Pay only after explicit human confirmation."
  exit 0
}

if (-not $ConfirmPayment) {
  throw "Payment is blocked. Re-run with -ConfirmPayment only after a human approves the displayed quote."
}
if ([string]::IsNullOrWhiteSpace($PaymentId)) {
  throw "-PaymentId is required for Stage Pay. Use the ID returned by Stage Quote."
}

# The official client signs and replays the original request. This script never
# reconstructs, edits, prints, or persists the cryptographic authorization.
& $OnchainOs payment pay --payment-id $PaymentId --selected-index 0 --yes @requestArgs
if ($LASTEXITCODE -ne 0) { throw "The official OKX payment command failed." }
