# RepoDiet End-to-End Audit

**Audit date:** 2026-07-21  
**Starting main SHA:** `64d034605b4a26eebc0cafcdda901f68db8ff1f4`  
**Branch:** `fix/repodiet-end-to-end-readiness`  
**Production:** https://skillswap-virid-kappa.vercel.app  
**Identities:** ASP 5283 · A2A 32947 · A2MCP 32948

This document maps the **real current code paths** on main before fixes. It is not a plan-only document; implementation follows in priority order starting with Phase 1.

---

## 1. Agent Card

| Item | Path |
|------|------|
| Route | `src/app/.well-known/agent-card.json/route.ts` → `GET()` |
| Builder | `src/lib/a2a/agent-card.ts` → `buildAgentCard()` |
| Behavior | Advertises A2MCP + A2A services, submit/status/fund/approve endpoints, schemas, price hints |

---

## 2. A2A request intake

| Item | Path |
|------|------|
| Marketplace POST | `src/app/api/a2a/tasks/route.ts` → `POST()` → `submitA2ATask()` |
| Workflow POST | `src/app/api/workflow/a2a/route.ts` → scoped `repository.cleanup_pr` |
| Orchestrator | `src/lib/a2a/orchestrator.ts` → `submitA2ATask()` |

**Behavior:** Creates task, immediately creates + dispatches a durable deep-scan job, then optionally continues via Next.js `after()`.

---

## 3. A2A task persistence

| Item | Path |
|------|------|
| Store | `src/lib/a2a/task-store.ts` → `saveA2ATask` / `getA2ATask` / `updateA2ATask` |
| Collection | durable `a2a_tasks` |
| State machine | `src/lib/a2a/task-state-machine.ts` — append-only emits, **no transition validation** |
| Status types | `src/lib/a2a/types.ts` → `A2ATaskStatus` |

---

## 4. Deep-scan dispatch

| Item | Path |
|------|------|
| Create | `src/lib/deep-scan/job-store.ts` → `createDeepScanJob()` |
| Dispatch | `src/lib/deep-scan/dispatch-queued-job.ts` → `dispatchQueuedDeepScanJob()` |
| Trigger | GitHub `repository_dispatch` via `src/lib/github-actions/dispatch-analysis.ts` |

**Behavior:** `QUEUED` → `DISPATCHING` → `DISPATCHED` → `WAITING_FOR_RUNNER`. Dispatch metadata (including raw `dispatchToken`) stored on `job.resultSummary.dispatch`.

---

## 5. Deep-scan completion

| Item | Path |
|------|------|
| Ingest | `src/app/api/internal/actions/deep-scans/[id]/ingest/route.ts` → `POST()` |
| Stage update | `updateDeepScanStage(jobId, "READY", ...)` |
| Findings | `storeFindings()` |

**Defect:** Completion updates only `deep_scan_jobs`. **No parent A2A task update.**

---

## 6. Parent task state advancement — ROOT CAUSE

| Intended | Actual |
|----------|--------|
| Child READY → parent advances | **Missing bridge** |

**Observed historical bug pattern** (`task_b212ee3b042b4f` / `deep_scan_mBRWlwmRcQAM`):

1. Parent stuck at `fetching_repository` / `DISPATCHED` / `POLL_TASK_STATUS`
2. Child already `READY` with findings persisted
3. `continueA2ATaskExecution()` only resumes if status is `submitted` or `queued` — a parent already at `fetching_repository` is returned unchanged
4. `runAnalysisPhase()` does **not** wait on / consume the linked deep-scan job’s `findingsId`
5. Status poll (`GET /api/a2a/tasks/[taskId]`) formats stale `dispatchState` from `task.result` without reading live deep-scan state
6. **No** `reconcileParentTaskFromScan` (or equivalent) exists on main

**Root cause:** lifecycle break between durable child completion and parent A2A state machine — not a UI-only display bug.

---

## 7. Quote generation

| Item | Path |
|------|------|
| A2A path | `orchestrator.ensurePayment()` → `createQuoteForOperation()` |
| HTTP | `src/app/api/tasks/quote/route.ts` |
| Bound quote | `src/lib/payment/quote-service.ts` → `createBoundQuote()` / `quoteTo402Response()` |

---

## 8. Scope approval

| Item | Path |
|------|------|
| Checkpoint | `orchestrator.executeChanges()` → `awaiting_approval` |
| Approve | `approveA2ATask()` → `createCleanupPullRequest()` |
| Route | `src/app/api/a2a/tasks/[taskId]/approve/route.ts` |

---

## 9. GitHub write delivery

| Item | Path |
|------|------|
| Engine | `src/lib/execution/cleanup-engine.ts` → `createCleanupPullRequest()` |
| Operator | `src/lib/operator/create-cleanup-pr.ts` |
| Monitor | `src/lib/github/monitor-pr-delivery.ts` |

Uses GitHub App installation token when available; never merges; branch under cleanup naming.

---

## 10. A2MCP request validation

| Item | Path |
|------|------|
| Route | `src/app/api/a2mcp/quick-triage/route.ts` |
| Paid gate | `src/lib/a2mcp/phase3-route.ts` → `runPhase3ToolRoute()` |
| Engine | `src/lib/a2mcp/quick-triage-engine.ts` |

**Current preflight (partial):** JSON parse, public GitHub URL host check, `maximumFindings` 1–10.  
**Gaps:** limited SSRF/private-network checks, no mandatory commit SHA pin before 402, soft/language limits incomplete at route layer.

---

## 11. x402 challenge creation

| Item | Path |
|------|------|
| Body builder | `src/lib/payment/x402.ts` → `paymentRequiredBody()` |
| Shape | `{ x402Version: 2, resource, quoteId, accepts: [{ scheme, network, amount, payTo, asset, ... }] }` |

Body is largely canonical. Price: `30000` micro = 0.03 USD₮0 via `analyze-repository-price.ts`.

---

## 12. PAYMENT-REQUIRED header creation — KNOWN PRODUCTION FAILURE

| Item | Path |
|------|------|
| Builder | `src/lib/payment/x402-payment-required.ts` → `buildX402ChallengeFrom402Body()` |
| Encoder | `encodePaymentRequiredHeader()` |
| Response | `paymentRequiredJsonResponse()` |

**Defect (confirmed):**

```ts
// Reads accepts[0], then flattens fields to TOP LEVEL:
{ x402Version, scheme, network, asset, amount, payTo, resource, maxTimeoutSeconds, extra }
```

OKX/OnchainOS expects:

```json
{
  "x402Version": 2,
  "resource": { "url": "...", "description": "...", "mimeType": "application/json" },
  "accepts": [ { "scheme": "exact", "network": "...", "asset": "...", "amount": "...", "payTo": "...", "maxTimeoutSeconds": 300, "extra": {} } ]
}
```

**Production symptom:** `onchainos payment quote` → `unsupported: 402 challenge has no accepts[] array` (no payment occurred).

**Test lock-in:** `test/x402-payment-required-header.test.ts` asserts the **malformed flat** shape.

---

## 13. Payment verification

| Item | Path |
|------|------|
| Pay route | `src/app/api/tasks/pay/route.ts` |
| Core | `src/lib/payment/settlement.ts` → `verifyAndFundQuote()` |
| Gate | `src/lib/okx/commerce-gateway.ts` → `gateA2mcpCall()` / `requireEntitlement()` |

Validates quote binding, nonce, amount, currency, network, recipient, reused payment reference. Facilitator or on-chain verification depending on mode.

---

## 14. Settlement

| Item | Path |
|------|------|
| After paid execution | `phase3-route.ts` → `markQuoteCompleted()`, `saveCompletedA2mcpExecution()`, `signOkxReceipt()` |
| A2A escrow | `src/lib/a2a/settlement-lifecycle.ts`, `okx-escrow-fund.ts` |

---

## 15. Replay protection

| Layer | Path |
|-------|------|
| Idempotency lock | `commerce-gateway.claimIdempotencyLock()` |
| Completed execution cache | `a2mcp-execution-store.ts` |
| Quote execution state | `payment-store.ts` SUCCEEDED guard |

**Gap:** some locks are read-then-write rather than uniquely constrained atomic claims; concurrent races possible under multi-instance Vercel.

---

## 16. Result persistence

| Item | Path |
|------|------|
| A2MCP tasks | `src/lib/a2mcp/task-store.ts` |
| Paid executions | `src/lib/a2mcp/a2mcp-execution-store.ts` |
| Quotes | `src/lib/payment/payment-store.ts` |

---

## 17. Receipt signing and verification

| Item | Path |
|------|------|
| Sign | `src/lib/okx/payment-provider.ts` → `signOkxReceipt()` (V1 + V2) |
| V2 schema | `src/lib/operator/signed-receipt-v2.ts` |
| Verify route | `src/app/api/okx/receipts/[receiptId]/route.ts` |
| Verifier | `src/lib/okx/receipt-verifier.ts` — primarily V1 |

**Gap:** V2 stored but not fully independently verified by public verifier.

---

## 18. Health checks

| Item | Path |
|------|------|
| OKX health | `src/app/api/okx/health` → `buildOkxHealthResponse()` |
| Agent runtime | `src/lib/a2a/agent-runtime-health.ts` |

**Defect:** `a2mcpEndpointHealthy` / production readiness can treat “no successful paid call yet” as unhealthy. Fields are not cleanly separated into configuration vs last-paid evidence.

---

## 19. Trust-root publication

| Item | Path |
|------|------|
| Route | `src/app/api/okx/trust-root/route.ts` |
| Publisher | `src/lib/operator/trust-root.ts` → `publishOperatorTrustRoot()` |

Publishes public SPKI / fingerprint; production must not derive verifier key from private key.

---

## 20. Environment validation

| Item | Path |
|------|------|
| Payment env | `src/lib/payment/payment-environment.ts` |
| Identity | `src/lib/okx/identity.ts` |
| Modes | `REPODIET_PAYMENT_MODE=testnet|mainnet` (+ network/asset overrides) |

Testnet: `eip155:1952` / `0x9e29…fb0c`  
Mainnet: `eip155:196` / `0x779d…3736`  

**Gaps:** `REPODIET_PAYMENT_ENV` alias not wired; unset mode defaults toward mainnet material; production fail-closed incomplete for missing payee.

---

## 21. Secret redaction

| Item | Path |
|------|------|
| Telemetry | `src/lib/okx/marketplace-telemetry.ts` |
| Logs | `src/lib/github/log-redaction.ts` |

**Critical public leak:** `GET /api/deep-scans/[id]` returns `dispatch` via `readDispatchMeta()` which includes raw `dispatchToken` / `job.dispatchNonce`. A2A progress URLs are intentionally anonymous-accessible → **dispatch token exposure**. Assume compromised; invalidate persisted tokens; never return in public DTOs.

---

## SDK decision (Phase 1)

Official packages (`@okxweb3/x402-next`, `@okxweb3/x402-express`, `@okxweb3/x402-core`) provide Express/Hono/Fastify/Next middleware that owns verify+settle via OKX facilitator.

**Not adopted for the A2MCP HTTP boundary in this change** because:

1. RepoDiet already has a quote-bound entitlement + settlement store (`verifyAndFundQuote`, `gateA2mcpCall`, execution cache) that would collide with middleware-owned settlement.
2. `@okxweb3/x402-*` is not a current dependency; introducing facilitator-only middleware would rewrite paid-path semantics and risk double-settlement.
3. The production failure is specifically the malformed `PAYMENT-REQUIRED` header shape — fixing the canonical challenge encoding restores OnchainOS quote interoperability without unsafe framework workarounds.

Business logic remains independent of payment header encoding. Manual implementation follows the official v2 canonical JSON documented by OKX seller SDK / SELLER.md.

---

## Priority fix order (this branch)

1. Canonical `PAYMENT-REQUIRED` / accepts[] (Phase 1)
2. Payment env separation + preflight hardening (Phase 1)
3. Idempotency / receipts / replay (Phase 2)
4. Parent↔child reconciliation state machine (Phase 3)
5. Public DTO secret stripping + token invalidation (Phase 4)
6. A2A marketplace gates / quotes (Phase 5)
7. GitHub delivery safeguards (Phase 6)
8. Finding quality bounds (Phase 7)
9. Truthful health / observability (Phase 8)
10. Customer docs + runbooks (Phases 9–11)
11. Tests and acceptance gates (Phase 10)
