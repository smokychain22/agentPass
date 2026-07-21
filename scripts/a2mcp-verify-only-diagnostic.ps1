[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [switch]$ConfirmAuthorization,
  [string]$OnchainOs = "onchainos",
  [string]$PublicUri = "https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage",
  [string]$DiagnosticUri = "https://skillswap-virid-kappa.vercel.app/api/internal/a2mcp/verify-diagnostic"
)

$ErrorActionPreference = "Stop"
if (-not $ConfirmAuthorization) { throw "Explicit authorization confirmation is required." }
$diagnosticToken = [Environment]::GetEnvironmentVariable("REPODIET_A2MCP_DIAGNOSTIC_TOKEN")
if ([string]::IsNullOrWhiteSpace($diagnosticToken) -or $diagnosticToken.Length -lt 32) {
  throw "REPODIET_A2MCP_DIAGNOSTIC_TOKEN must contain the protected diagnostic token."
}

$expectedNetwork = "eip155:196"
$expectedAsset = "0x779ded0c9e1022225f8e0630b35a9b54be713736"
$expectedAmount = "30000"
$expectedPayTo = "0x1339724ada3adf04bb7a8ccc6498216214bbdf90"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("repodiet-verify-" + [Guid]::NewGuid().ToString("N"))
[System.IO.Directory]::CreateDirectory($tempRoot) | Out-Null
$originalFile = Join-Path $tempRoot "original-request.json"
$diagnosticFile = Join-Path $tempRoot "diagnostic-request.json"

function Write-ValidatedJsonFile([string]$Path, [object]$Value) {
  $json = $Value | ConvertTo-Json -Depth 24 -Compress
  [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    throw "UTF-8 BOM is not allowed in diagnostic request files."
  }
  [System.IO.File]::ReadAllText($Path, $utf8NoBom) | ConvertFrom-Json | Out-Null
}

function New-JsonContentFromFile([string]$Path) {
  $content = [System.Net.Http.ByteArrayContent]::new([System.IO.File]::ReadAllBytes($Path))
  $content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new("application/json")
  return $content
}

try {
  Add-Type -AssemblyName System.Net.Http
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $false
  $client = [System.Net.Http.HttpClient]::new($handler)

  $original = [ordered]@{
    operation = "analyze_repository"
    repositoryUrl = "https://github.com/velz-cmd/repodiet-e2e-test"
    branch = "main"
    maximumFindings = 3
  }
  Write-ValidatedJsonFile $originalFile $original
  $challengeResponse = $client.PostAsync($PublicUri, (New-JsonContentFromFile $originalFile)).GetAwaiter().GetResult()
  if ([int]$challengeResponse.StatusCode -ne 402) { throw "The protected endpoint did not return HTTP 402." }
  $challengeValues = $null
  if (-not $challengeResponse.Headers.TryGetValues("PAYMENT-REQUIRED", [ref]$challengeValues)) {
    throw "PAYMENT-REQUIRED is missing."
  }
  $challenge = @($challengeValues)[0]
  $normalized = $challenge.Replace("-", "+").Replace("_", "/")
  while ($normalized.Length % 4) { $normalized += "=" }
  $decoded = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($normalized)) | ConvertFrom-Json
  if ($decoded.x402Version -ne 2 -or -not $decoded.resource.url -or @($decoded.accepts).Count -lt 1) {
    throw "The x402 v2 challenge is malformed."
  }
  $accepted = @($decoded.accepts)[0]
  if ($accepted.scheme -ne "exact" -or $accepted.network -ne $expectedNetwork -or
      $accepted.asset.ToLowerInvariant() -ne $expectedAsset -or $accepted.amount -ne $expectedAmount -or
      $accepted.payTo.ToLowerInvariant() -ne $expectedPayTo -or $decoded.resource.url -ne $PublicUri) {
    throw "The production payment terms do not match the controlled diagnostic terms."
  }

  # Explicit sign-only compatibility surface. It returns a header but does not
  # replay the paid endpoint and cannot call facilitator settlement.
  $signedText = (& $OnchainOs payment pay --payload $challenge --selected-index 0 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "The official OKX sign-only command failed." }
  $signed = $signedText | ConvertFrom-Json
  $authorizationHeader = $signed.data.authorization_header
  if (-not $authorizationHeader) { $authorizationHeader = $signed.authorization_header }
  $headerName = $signed.data.header_name
  if (-not $headerName) { $headerName = $signed.header_name }
  if ($headerName -ne "PAYMENT-SIGNATURE" -or [string]::IsNullOrWhiteSpace($authorizationHeader)) {
    throw "The official client did not return a valid PAYMENT-SIGNATURE header."
  }
  $authorizationNormalized = $authorizationHeader.Replace("-", "+").Replace("_", "/")
  while ($authorizationNormalized.Length % 4) { $authorizationNormalized += "=" }
  $authorizationDecoded = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($authorizationNormalized)) | ConvertFrom-Json
  $validBefore = [long]$authorizationDecoded.payload.authorization.validBefore
  if ($authorizationDecoded.x402Version -ne 2 -or $authorizationDecoded.resource.url -ne $PublicUri -or
      $validBefore -le [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) {
    throw "The signed authorization is stale or bound to the wrong resource."
  }

  $attemptId = "diag_" + [Guid]::NewGuid().ToString("N")
  $diagnostic = [ordered]@{
    attemptId = $attemptId
    attemptCreatedAt = [DateTime]::UtcNow.ToString("o")
    originalRequest = $original
    originalResourceUrl = $PublicUri
    paymentRequirements = $accepted
  }
  Write-ValidatedJsonFile $diagnosticFile $diagnostic
  $diagnosticRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, $DiagnosticUri)
  $diagnosticRequest.Headers.Add("x-repodiet-diagnostic-token", $diagnosticToken)
  $diagnosticRequest.Headers.Add("PAYMENT-SIGNATURE", $authorizationHeader)
  $diagnosticRequest.Content = New-JsonContentFromFile $diagnosticFile
  $diagnosticResponse = $client.SendAsync($diagnosticRequest).GetAwaiter().GetResult()
  $safe = $diagnosticResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json

  [ordered]@{
    attemptId = $safe.attemptId
    correlationId = $safe.correlationId
    responseStatus = [int]$diagnosticResponse.StatusCode
    verification = $safe.verification
    settlementAttempted = $safe.settlementAttempted
    findingsReleased = $safe.findingsReleased
    receiptCreated = $safe.receiptCreated
  } | ConvertTo-Json -Depth 8
} finally {
  if ($client) { $client.Dispose() }
  if ($handler) { $handler.Dispose() }
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
  $diagnosticToken = $null
  $authorizationHeader = $null
  $authorizationNormalized = $null
  $signedText = $null
}
