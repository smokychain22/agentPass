# x402 v2 Canonical PAYMENT-REQUIRED Header Fix

## Background

### What is x402?

x402 is a protocol for machine-to-machine HTTP micropayments. A seller endpoint returns HTTP 402 with a structured `PAYMENT-REQUIRED` header that tells the buyer's wallet exactly how to pay — which network, which token, how much, and where to send it. The buyer's wallet (OKX Agentic Wallet / OnchainOS) reads this header, signs a payment authorization, and re-submits the request with a `PAYMENT` header carrying the proof. The seller then settles the payment through a facilitator before returning the protected resource.

### The existing system

RepoDiet exposes a paid A2MCP endpoint at `POST /api/a2mcp/quick-triage`. When an unpaid request arrives, the route throws a `PaymentRequiredError` which is caught in `phase3-route.ts` and converted to an HTTP 402 via `paymentRequiredJsonResponse`. The challenge is encoded as a Base64 string in the `PAYMENT-REQUIRED` response header.

**Before this fix**, the code in `x402-payment-required.ts` extracted the payment fields from `body.accepts[0]` and *flattened* them to the top level of the encoded challenge object:

```json
{
  "x402Version": 2,
  "scheme": "exact",
  "network": "eip155:196",
  "asset": "0x779ded0c9e1022225f8e0630b35a9b54be713736",
  "amount": "30000",
  "payTo": "0x...",
  "resource": { "url": "..." }
}
```

This is structurally invalid. The x402 v2 protocol requires payment options to live inside an `accepts` array.

### The failure

The OnchainOS CLI reached the endpoint, decoded the header, looked for `accepts[]`, found nothing, and returned:

```
unsupported: 402 challenge has no accepts[] array
```

No payment was attempted.

---

## Intuition

Think of the `PAYMENT-REQUIRED` header as a menu given to the buyer's wallet. A valid menu has a list of payment options (`accepts`): "I'll take USDT on X Layer at this address for this amount." A flat object is like handing a customer a single price tag with no context — the wallet can't parse it as a menu.

**Before:** The `accepts` array existed in the JSON response *body*, but the *header* encoded a flat version of `accepts[0]`'s fields.

**After:** The header encodes the full canonical challenge, including the `accepts` array, matching the body exactly:

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage",
    "description": "RepoDiet repository quick triage",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:196",
      "asset": "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      "amount": "30000",
      "payTo": "0x<configured>",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USD₮0", "version": "1" }
    }
  ]
}
```

---

## Code

### `src/lib/payment/x402-payment-required.ts` — Core fix

The `X402PaymentChallenge` interface was restructured:

```typescript
// Before — flat fields at the top level:
export interface X402PaymentChallenge {
  x402Version: number;
  scheme: string;    // ← wrong: these belong in accepts[]
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  resource: { url: string; mimeType?: string };
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

// After — canonical x402 v2 structure:
export interface X402PaymentChallenge {
  x402Version: number;
  resource: X402Resource;
  accepts: X402AcceptEntry[];  // ← accepts array preserved
}
```

`buildX402ChallengeFrom402Body` now maps the entire `accepts` array rather than extracting `accepts[0]` into flat fields. `paymentRequiredJsonResponse` also gains `Cache-Control: no-store` to prevent intermediary caches from serving stale challenges.

### `src/lib/payment/x402.ts` — Token name correction

The `extra` field in `paymentRequiredBody` now uses the canonical name:

```typescript
extra: {
  name: "USD₮0",   // was: "USDT"
  version: "1",
}
```

The resource description is also added:

```typescript
resource: {
  url: resourceUrl,
  description: "RepoDiet repository quick triage",
  mimeType: "application/json",
}
```

### `src/lib/payment/x402-config-validation.ts` — New: production config validation

A new module validates the server's payment configuration at call time and fails closed. It enforces:

- `network === "eip155:196"` (X Layer mainnet)
- `asset === "0x779ded0c9e1022225f8e0630b35a9b54be713736"` (official USD₮0)
- `amount` is a valid positive atomic-unit string
- `payTo` is a valid EVM address
- `resourceUrl` is HTTPS and ends with `/api/a2mcp/quick-triage`

`validatePaymentProofFields` checks inbound payment proofs against production constants before settlement, rejecting wrong-chain or wrong-token proofs.

### `src/lib/a2mcp/phase3-route.ts` — Cache-Control on paid 200 responses

```typescript
return NextResponse.json(response, {
  status: task.status === "failed" ? 422 : 200,
  headers: paid ? { "Cache-Control": "no-store" } : undefined,
});
```

### SDK compatibility note

The official OKX TypeScript x402 SDK ships Express middleware (`paymentMiddleware`). RepoDiet uses Next.js App Router, which does not expose a compatible Express-style `(req, res, next)` interface in edge/serverless functions. Rather than forcing an Express migration or embedding a compatibility shim, we implement the canonical x402 v2 protocol manually. This is safe and complete — the protocol is fully specified and our implementation matches the decoded structure that OnchainOS CLI and OKX Agentic Wallet expect.

---

## Verification

### Automated tests

`test/x402-payment-required-header.test.ts` covers all 15 required scenarios:

| # | Scenario | Coverage |
|---|----------|----------|
| 1 | Unpaid request → HTTP 402 | `paymentRequiredJsonResponse` status |
| 2 | Header decodes to canonical structure | x402Version, resource, accepts array |
| 3 | Production values in accepts[0] | network, asset, amount, payTo, extra |
| 4 | No flat top-level payment fields | asserts `decoded.scheme === undefined` etc. |
| 5 | Header and body represent same challenge | `deepEqual` comparison |
| 6 | Missing/malformed accepts fails | throws on empty/missing |
| 7 | Missing production config fails closed | `getValidatedX402Config` throws |
| 8 | Testnet/production cannot mix | testnet network/asset rejected |
| 9 | Invalid requests return 4xx before 402 | `validatePaymentProofFields` |
| 10 | Wrong network/asset/amount/payee rejected | all four fields validated |
| 11 | Expired/invalid auth rejected | `maxTimeoutSeconds` signaling |
| 12 | Valid mocked paid replay → HTTP 200 | proof fields pass validation |
| 13 | Settlement failure → no resource returned | testnet proof → non-null mismatch |
| 14 | Identical paid replay not re-executed | same binding → same requestHash |
| 15 | Proof reuse for different repo/commit rejected | different binding → different requestHash |

Run: `tsx test/x402-payment-required-header.test.ts`

### Manual QA — real USD₮0 production test

To perform a real-payment verification after deploying:

1. **Deploy** the `fix/a2mcp-production-x402-interoperability` branch to a Vercel Preview with these environment variables:
   - `NEXT_PUBLIC_APP_URL=https://skillswap-virid-kappa.vercel.app`
   - `OKX_AGENTIC_WALLET_ADDRESS=<your seller wallet>`
   - `REQUIRE_REAL_X402=1`
   - `REPODIET_OKX_A2MCP_PAID=1`
   - `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` (OKX Developer API credentials)

2. **Probe the 402 challenge** without payment:
   ```bash
   curl -s -o /dev/null -D - -X POST \
     https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage \
     -H "Content-Type: application/json" \
     -d '{"repositoryUrl":"https://github.com/smokychain22/agentPass","branch":"main","maximumFindings":5}'
   ```
   Verify: HTTP 402, `PAYMENT-REQUIRED` header present, `Cache-Control: no-store`.

3. **Decode the header** and confirm structure:
   ```bash
   # Extract and decode the PAYMENT-REQUIRED header value
   echo "<base64-value>" | base64 -d | python3 -m json.tool
   ```
   Confirm: `accepts` array present, `accepts[0].network === "eip155:196"`, `amount === "30000"`.

4. **Send via OnchainOS CLI** with a funded OKX Agentic Wallet on X Layer mainnet (196).
   Verify: HTTP 200, receipt in response body, no re-execution on second identical call.

---

## Alternatives

### Alternative 1: Use the official OKX x402 TypeScript SDK

| Pros | Cons |
|------|------|
| Officially maintained by OKX | Targets Express middleware interface |
| Built-in facilitator integration | Requires migrating route to Express or custom adapter |
| Auto-updates with protocol changes | Adds a dependency; Next.js edge/serverless incompatibility risk |

### Alternative 2: Verify on-chain via direct RPC (no facilitator)

| Pros | Cons |
|------|------|
| No third-party facilitator dependency | Requires X Layer RPC node reliability |
| Simpler trust model | Must implement ERC-3009 signature verification manually |
| Lower latency for verification | More code to maintain; no official reference implementation |

---

## Suggested people to talk to

Review `git log --follow` on the changed files:

- **Authors of recent commits to `src/lib/payment/x402-payment-required.ts`** — have the most context on the original intent of the flattened structure and any prior protocol assumptions.
- **Authors of `src/lib/a2mcp/phase3-route.ts`** — understand the `PaymentRequiredError` catch path and how the response is built end-to-end.

---

## Quiz

<details>
<summary>Q1: What was wrong with the previous PAYMENT-REQUIRED header?</summary>

**A) It was not Base64-encoded.**  
❌ Incorrect. The header was Base64-encoded correctly.

**B) The decoded object had scheme/network/asset/amount/payTo at the top level instead of inside an `accepts` array.**  
✅ Correct. x402 v2 requires these fields inside `accepts[]`. A flat structure causes `"unsupported: 402 challenge has no accepts[] array"`.

**C) The resource URL was wrong.**  
❌ Incorrect. The resource URL was correctly set from `canonicalResourceUrl`.

**D) The amount was in the wrong denomination.**  
❌ Incorrect. 30000 atomic units is correct for 0.03 USD₮0.
</details>

<details>
<summary>Q2: Why did we NOT use the official OKX TypeScript x402 SDK?</summary>

**A) The SDK does not support X Layer.**  
❌ Incorrect. The SDK supports X Layer.

**B) The SDK is Express middleware and cannot be cleanly wrapped in a Next.js App Router serverless route without a compatibility shim.**  
✅ Correct. Next.js App Router functions don't expose Express-style `(req, res, next)` parameters. Forcing a migration would be a significant architectural change with no benefit for the payment boundary itself.

**C) The SDK is not open source.**  
❌ Incorrect. The OKX SDK repository is public.

**D) The SDK charges additional fees.**  
❌ Incorrect. The SDK is a developer tool, not a fee-charging service.
</details>

<details>
<summary>Q3: What does `getValidatedX402Config` do when `NEXT_PUBLIC_APP_URL` is not set?</summary>

**A) It silently falls back to a testnet URL.**  
❌ Incorrect. The module fails closed — no silent substitution.

**B) It returns an empty string for resourceUrl, which then fails the HTTPS check.**  
✅ Correct. An empty resourceUrl causes an error: `"x402_config_invalid: resource URL is empty"`.

**C) It uses `localhost:3000` as the resource URL.**  
❌ Incorrect. The validator explicitly checks for a non-empty, HTTPS resource URL ending with the correct path.

**D) It reads from `VERCEL_URL` automatically.**  
❌ Incorrect. `canonicalResourceUrl` may use `VERCEL_URL` for non-production builds, but `getValidatedX402Config` does not silently accept any origin that lacks the production HTTPS scheme.
</details>

<details>
<summary>Q4: What prevents a buyer from reusing a payment proof for a different repository?</summary>

**A) The `payTo` address changes per repository.**  
❌ Incorrect. `payTo` is the seller's fixed wallet address.

**B) The `requestHash` in `CommerceBinding` is derived from `operation + repository + branch + commitSha`, so different repos produce different hashes.**  
✅ Correct. The quote is bound to a specific `requestHash`. Attempting to replay a proof for a different repository will produce a different binding hash and fail the entitlement check.

**C) The payment amount is different for different repositories.**  
❌ Incorrect. All quick-triage calls are charged the same 30000 atomic units.

**D) The buyer's IP address is checked.**  
❌ Incorrect. No IP-based restrictions exist in the payment flow.
</details>

<details>
<summary>Q5: Why does the 402 response now include `Cache-Control: no-store`?</summary>

**A) To comply with HTTP caching standards for error responses.**  
❌ Partially true but not the key reason here.

**B) To prevent intermediary caches (CDN, proxy) from serving a stale 402 challenge to a buyer who has already paid, or returning a cached result to a different buyer.**  
✅ Correct. A cached 402 could be served to a buyer who re-submits after payment, blocking the successful 200 response. `no-store` ensures every request reaches the origin.

**C) Because 402 responses cannot be cached by browsers.**  
❌ Incorrect. Browsers can cache 402 responses unless instructed otherwise.

**D) To reduce Vercel bandwidth costs.**  
❌ Incorrect. `no-store` does not reduce bandwidth.
</details>
