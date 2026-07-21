# A2MCP Quick Triage API

**Endpoint:** `POST /api/a2mcp/quick-triage`  
**Service:** OKX A2MCP 32948 · ASP 5283  
**Price:** 0.03 USD₮0 (`30000` minimum units) via x402

RepoDiet finds repository bloat and returns a bounded, evidence-backed triage. Deep cleanup belongs to A2A.

## Request schema

```json
{
  "operation": "analyze_repository",
  "repositoryUrl": "https://github.com/owner/repo",
  "branch": "main",
  "maximumFindings": 3
}
```

| Field | Rules |
|-------|--------|
| `operation` | Must be `analyze_repository` |
| `repositoryUrl` | Public `https://github.com/owner/repo` only |
| `branch` | Optional; default `main`; validated ref format |
| `maximumFindings` | 1–10 hard cap (marketplace default 3 recommended) |

## Preflight (before payment)

Invalid JSON, SSRF/private hosts, non-GitHub URLs, inaccessible/private repos, and bad refs return **4xx** and **do not** issue a 402.

## Unpaid 402 behavior

Valid unpaid requests return HTTP **402** with:

- JSON body containing `x402Version`, `resource`, nonempty `accepts[]`
- `PAYMENT-REQUIRED` header = base64(canonical challenge JSON)
- `Cache-Control: no-store`

Decoded header shape:

```json
{
  "x402Version": 2,
  "resource": { "url": "...", "description": "...", "mimeType": "application/json" },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:196",
      "asset": "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      "amount": "30000",
      "payTo": "0x…",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USD₮0", "version": "1" }
    }
  ]
}
```

Preview/testnet deployments advertise testnet network/asset instead.

## Payment retry / success

After a verified payment (quote-bound entitlement):

- HTTP 200 with structured findings, pinned commit SHA, receipt
- Identical retry returns cached result — no second execution or charge
- Same payment proof with a different request hash is rejected

## Errors

| Code | Meaning |
|------|---------|
| `INVALID_INPUT` | Schema / bounds |
| `UNSUPPORTED_OPERATION` | Unknown operation |
| `UNSUPPORTED_REPOSITORY` | Not a supported public GitHub URL |
| `SSRF_BLOCKED` | Local/private/metadata host |
| `REPOSITORY_UNREACHABLE` | Missing, private, or GitHub error |
| `BRANCH_INVALID` | Bad ref format |

## Receipt verification

Use the public receipt / trust-root endpoints under `/api/okx/…`. Trust-root publishes public keys only.

## Rate limits

Public endpoints are abuse-controlled; treat unpaid probing as subject to rate limits. Prefer quote → pay → single paid retry.
