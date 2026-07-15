# A2MCP timeout + quote lifecycle remediation

**Status:** Internal proof complete. Historical paid attempt remains a **delivery failure**.  
**Do not rewrite** `a2mcp-payment-result.json` as an end-to-end pass.  
**Never reuse** `quote_oQs2zW2cmt7o` or treat tx `0x351daeb986fc656fd611aaf01226e297efe42cfc91be1082222b94702d5fa73f` as full A2MCP success.

## A. Exact root cause

Two interacting defects caused `PAYMENT_SUCCEEDED_BUT_A2MCP_EXECUTION_TIMED_OUT_AND_QUOTE_CONSUMED`:

1. **Hard tool timeout too short for the old Quick Triage path**  
   `TOOL_TIMEOUT_MS = 60_000` gated `analyze_repository` / Quick Triage even though Vercel `maxDuration` was 300s. The live scan for `smokychain22/agentPass` exceeded 60s (full knip/jscpd/madge-style analysis), so the route returned **HTTP 504 `SCAN_TIMEOUT`** before a result/receipt existed.

2. **Quote marked consumed at execution lock (before delivery)**  
   `lockQuoteForExecution` set `status: "consumed"` when work *started*. After the 504, the funded entitlement was already gone. Retry returned **HTTP 402** (“already consumed”) with **no receipt**, forcing a new payment for an already-settled buy.

Secondary contributors:

- Receipt signing only after `completed` → timeout meant **no receipt**.
- No durable idempotency cache keyed by `quoteId + requestHash`.
- No `FAILED_RETRYABLE` reclaim path after platform timeout.

### Lifecycle for failed quote `quote_oQs2zW2cmt7o` (trace)

| Stage | Outcome |
|-------|---------|
| Payment on X Layer | SUCCESS — `0x351dae…f5fa73f` (0.03 USD₮0) |
| `/api/tasks/pay` | HTTP 200 funded |
| Protected `/api/a2mcp/quick-triage` | Gate passed → execution started → **quote consumed** → scan timed out at **60s** |
| Result / receipt | **none** |
| Retry same quote | HTTP 402 replayed / already consumed |
| Duplicate on-chain payment | **none** |

Timeout stage classification for the failed run: **application tool timeout** (`withTimeout` / `TOOL_TIMEOUT_MS`), not Vercel platform maxDuration, not receipt generation, and not a second payment. Dominant work inside the 60s window was **repository fetch + full analysis** (not a bounded Quick Triage budget).

## B. Affected / changed code

- `src/lib/a2mcp/constants.ts` — `QUICK_TRIAGE_TIMEOUT_MS = 90_000`
- `src/lib/a2mcp/quick-triage-bounded.ts` — ZIP-only bounded scanner, stage budgets
- `src/lib/a2mcp/quick-triage-engine.ts` — bounded path (no native knip/jscpd/madge CLI)
- `src/lib/a2mcp/phase3-route.ts` — timeout budgets, retryable failure, receipt-after-success, idempotent replay
- `src/lib/a2mcp/a2mcp-execution-store.ts` — durable `quoteId + requestHash` completion cache
- `src/lib/payment/types.ts` — `QuoteExecutionState`
- `src/lib/payment/payment-store.ts` — lock without consume; succeed / retryable release
- `src/lib/payment/settlement.ts` — `markQuoteRetryableFailure` / completed via succeed
- `src/lib/okx/payment-provider.ts` / `types.ts` / `receipt-verifier.ts` — receipt binds commerce fields + verifiable signed payload
- `src/app/api/a2mcp/quick-triage/route.ts` — forwards `quoteId` / payment fields
- `src/app/api/internal/a2mcp/quick-triage-diagnostic/route.ts` — non-billable diagnostic
- `src/lib/github/fetch-repo-zip.ts` — fetch abort timeout
- `vercel.json` — maxDuration for a2mcp / internal diagnostic
- Tests: `test/a2mcp-quote-lifecycle.test.ts`, `test/quick-triage-bounded.test.ts`, `test/a2mcp-paid-path-fixture.test.ts`
- Script: `scripts/a2mcp-diagnostic-quick-triage.ts`

## C. Timeout fix

- Quick Triage uses a **bounded** path only:
  - shallow GitHub ZIP fetch (no git clone, no `npm install`, no build/tests)
  - knip **fallback** + AI-slop heuristics only
  - skip native knip/jscpd/madge CLI
  - `maximumFindings` capped (production Quick Triage 1–10; activation uses 5)
  - per-stage budgets: fetch 15s, analysis 25s, overall ~45s
  - route timeout for `analyze_repository`: **90s** (still under Vercel 300s)
- On timeout / 5xx after payment: return recoverable `FAILED_RETRYABLE` JSON and **preserve funded entitlement**

### Timing

| Stage | Before (failed live run) | After (internal bounded proof) |
|-------|--------------------------|--------------------------------|
| Overall Quick Triage | >60_000 ms → 504 | ~1.3–28 s complete (HTTP 200 equivalent) |
| Tool timeout budget | 60_000 ms hard | 90_000 ms for Quick Triage |
| Analysis tools | full knip/jscpd/madge path | fallback-only, budgeted |
| Receipt | never created | created only after success |

Measured (this remediation workspace):

- `test/quick-triage-bounded.test.ts`: **1284 ms** total, 247 findings detected, **5** returned
- `scripts/a2mcp-diagnostic-quick-triage.ts` (non-billable): **HTTP 200** in **1163 ms**
  - fetch_and_extract: 968 ms
  - bounded_analysis: 158 ms
  - normalize: 4 ms
  - summary: `totalFindingsDetected=247`, `findingsReturned=5`
- `test/a2mcp-paid-path-fixture.test.ts`: execution completed, receipt cryptographically verified

## D. Quote lifecycle fix

Required order now:

`payment verified` → `FUNDED` → `EXECUTING` → **HTTP 200 result** → **receipt** → `SUCCEEDED` (`status: consumed` only here)

On timeout / internal failure before delivery:

- `FAILED_RETRYABLE`
- quote remains **`funded`**
- buyer can retry the **same quoteId** without a new payment

States: `FUNDED | EXECUTING | SUCCEEDED | FAILED_RETRYABLE | FAILED_FINAL`  
`consumed` is no longer used as a stand-in for “execution started.”

**Note:** The historical quote `quote_oQs2zW2cmt7o` must **not** be reused/recovered in production tests — treat it as burned evidence. Recovery semantics apply to **new** funded quotes after deploy.

## E. Idempotency behavior

Key: **`quoteId + requestHash`** (`a2mcp-execution-store`)

- Completions cached with HTTP body, `taskId`, `receiptId`, `resultDigest`
- Replay returns the same completed result / receipt (`idempotentReplay: true`)
- Concurrent EXECUTING lease → 409 pending (no second execution)
- SUCCEEDED without re-run even if cache missing (409 already processed)
- No second payment from retry after timeout (`FAILED_RETRYABLE` keeps funded)

## F–H. Internal test results (non-billable)

| Check | Result |
|-------|--------|
| Protected execution (fixture / diagnostic path) | **HTTP 200** |
| Quick Triage summary | `totalFindingsDetected=247`, `findingsReturned=5`, `reviewFirst=5` |
| Receipt exists | yes (`receiptId` + signed payload) |
| Cryptographic verify | **PASS** (`verifyExecutionReceiptV1` + `verifyReceipt`) |
| Idempotent replay | same `receiptId` / `resultDigest`; no second payment |
| Old quote reuse | fixture asserts ≠ `quote_oQs2zW2cmt7o` |

## I. Production build / tests

- `npm run typecheck` — pass
- `npm run build` — pass
- `npx tsx test/a2mcp-quote-lifecycle.test.ts` — pass
- `npx tsx test/quick-triage-bounded.test.ts` — pass
- `npx tsx test/a2mcp-paid-path-fixture.test.ts` — pass
- `npx tsx test/quick-triage-response.test.ts` — pass
- `npx tsx test/quick-triage-route.test.ts` — pass
- `npm run test:green-pr` — pass

## J. Is a new real 0.03 USD₮0 test safe?

**Yes — after this branch is deployed to production**, one **new** quote (≠ `quote_oQs2zW2cmt7o`) for the same operation/repo may be authorized and paid **once**.

Prerequisites before paying:

1. Deploy this remediation to `skillswap-virid-kappa.vercel.app` (or the live host).
2. Confirm unpaid probe still returns 402 with correct challenge.
3. Create a **fresh** quote; pay 0.03 USD₮0 once; call Quick Triage with that quoteId.
4. Expect HTTP 200 + findings + verifying receipt; retry identical request → same receipt, no second charge.

**Still do not** re-open or re-pay `quote_oQs2zW2cmt7o`.

## Remaining risks

- Production durable store consistency (Vercel KV / blob) must persist `task_quotes` + execution cache across retries.
- Operator signing keys (`REPODIET_OPERATOR_PRIVATE_KEY` / `PUBLIC_KEY`) must be configured in production for cryptographic receipt verify.
- Extremely large GitHub ZIPs can still hit the 15s fetch budget → partial/fallback findings (by design) rather than platform timeout.
- Historical burned quote remains unrecoverable by policy (even if store still shows consumed).

## Historical evidence preserved

- `docs/hackathon/okx-activation/a2mcp-payment-result.json` — payment PASS / delivery FAIL (unchanged semantics)
- Tx `0x351daeb986fc656fd611aaf01226e297efe42cfc91be1082222b94702d5fa73f` — successful settlement with failed service delivery

---

## Production deployment validation (2026-07-15)

PR [#16](https://github.com/smokychain22/agentPass/pull/16) merged to `main` and deployed to production.

| Field | Value |
|-------|-------|
| Merged commit SHA | `8c26ba30c9c3705db6c1e506815b228991e9f3d9` |
| Deployed commit SHA | `8c26ba30c9c3705db6c1e506815b228991e9f3d9` |
| Vercel production deployment ID | `5463553606` |
| Production URL | https://skillswap-virid-kappa.vercel.app |
| Deployment status | **success** |
| Commits match | **yes** |

### Durable state storage (production)

Quote lifecycle (`task_quotes`) and idempotency cache (`payment_entitlements`) use **`persistent-store.ts` → Upstash Redis REST** when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are configured (required for production; live payment quotes persist across instances). Keys: `repodiet:task_quotes:{quoteId}`, `repodiet:payment_entitlements:a2mcp_exec_{quoteId}_{requestHash}`. Not in-memory, not module Map, not ephemeral `/tmp` for entitlement state.

### Diagnostic route security (production)

`/api/internal/a2mcp/quick-triage-diagnostic` returns **403** without `x-repodiet-diagnostic-secret` matching `REPODIET_INTERNAL_DIAGNOSTIC_SECRET`. Production never enables free public Quick Triage via allow-flag alone.

### Timeout configuration (deployed)

| Layer | Budget |
|-------|--------|
| Vercel `maxDuration` (quick-triage + internal/a2mcp) | **300s** |
| Application `QUICK_TRIAGE_TIMEOUT_MS` | **90s** |
| Stage fetch | 15s |
| Stage analysis | 25s |
| Overall bounded scan | 45s |
| Worst-case expected | <90s (well under 300s platform limit) |

### Production test results (no payment, no new authorized quote)

| Check | Result |
|-------|--------|
| Health | PASS — `/api/tools/health` 200, `/api/okx/health` 200 `live_x402` |
| Unpaid Quick Triage | PASS — HTTP **402**, PAYMENT-REQUIRED present |
| PAYMENT-REQUIRED decode | PASS — x402 v2, `eip155:196`, asset `0x779d…3736`, amount `30000`, payTo seller |
| Bounded triage on production URL | **Not invoked** — diagnostic locked (403); deploy-parity at merged commit: HTTP 200 in **~1.2s**, 5 findings |
| Old quote `quote_oQs2zW2cmt7o` | Still blocked — HTTP 402 `replayed` / already consumed |
| Receipt / idempotency / timeout recovery | PASS at deployed commit via unit fixtures |
| Production logs | Not accessible to validator; no 5xx on probes |

Full JSON: `docs/hackathon/okx-activation/a2mcp-production-validation-result.json`

### Verdict

**PRODUCTION_READY_FOR_FINAL_PAID_TEST** — deploy complete, commerce gate correct, lifecycle/idempotency/receipt fixes live, bounded path proven at deployed commit. One **new** quote (≠ `quote_oQs2zW2cmt7o`) may be authorized for the final 0.03 USD₮0 acceptance test.
