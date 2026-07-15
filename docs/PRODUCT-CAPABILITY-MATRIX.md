# RepoDiet Product Capability Matrix

**Branch audited:** `main` (merged `cursor/product-vision-pricing-39ce`)  
**Audit date:** 2026-07-10  
**Phase:** 4 — A2A Task Orchestration

This document classifies every product capability as **REAL**, **PARTIAL**, **DEMO**, **COSMETIC**, **BROKEN**, or **NOT IMPLEMENTED**.

---

## Shared execution engine boundary

**Canonical entry point:** `src/lib/execution/index.ts`

| Function | Implementation | Status |
|----------|----------------|--------|
| `scanRepository()` | `runFindingsEngine` + repository/snapshot persistence | **REAL** |
| `analyzeRepository()` | Pass-through of findings payload | **REAL** (identity) |
| `selectSafeFixes()` | `listAutoFixEligible` with limit | **REAL** |
| `generateChanges()` | `runFreeCleanupCore` one-fix loop | **REAL** |
| `verifyChanges()` | `runVerification` | **REAL** |
| `createCleanupPullRequest()` | `operator/create-cleanup-pr` | **REAL** |
| `createTaskQuote()` | `execution/task-quote` | **REAL** |
| `createExecutionReceipt()` | `operator/sign-receipt` | **PARTIAL** (signs when key set) |
| `executeFreeProof()` | generate + persist + receipt | **REAL** |
| `executeTaskQuote()` | quote + persist | **REAL** |

**Routes using engine (required):**

| Route | Engine function | Status |
|-------|-----------------|--------|
| `POST /api/findings/run` | `scanRepository` | **REAL** |
| `POST /api/cleanup/run` | `executeFreeProof` | **REAL** |
| `POST /api/tasks/quote` | `executeTaskQuote` | **REAL** |
| `POST /api/tools/create_cleanup_pr` | `createCleanupPullRequest` + `createExecutionReceipt` | **REAL** |

**Routes still bypassing engine (legacy — migrate in Phase 1+):**

| Route | Direct import | Status |
|-------|---------------|--------|
| `POST /api/jobs/scan` | `runBasicScan` | **PARTIAL** |
| `POST /api/jobs/findings` | `runFindingsEngine` | **PARTIAL** |
| `POST /api/jobs/patch` | `runPatchKitEngine` | **PARTIAL** |
| `POST /api/patch-kit/generate` | `runPatchKitEngine` | **PARTIAL** |
| `POST /api/verify/run` | `runVerification` | **PARTIAL** |
| A2MCP analysis tools | Various direct engines | **PARTIAL** |

---

## Capability matrix

### 1. Repository scan

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Frontend route | `/app` (Scan tab) |
| Frontend action | Paste URL → Run Scan |
| API route | `POST /api/jobs/scan`, `POST /api/scans/run` |
| Execution service | `runBasicScan` → `prepareRepoWorkspace` |
| Persistence | Job store (`jobs` collection) |
| Production test | `scripts/production-smoke-test.ts` scan step |
| Limitations | Public repos only; 25MB ZIP cap; no commit SHA on job scan path yet |

### 2. Commit SHA capture

| Field | Value |
|-------|-------|
| **Status** | **PARTIAL** |
| Frontend route | Findings payload after scan |
| API route | Via `scanRepository` / findings pipeline |
| Execution service | `fetchBranchCommitSha` in `fetch-repo-zip.ts` |
| Persistence | `repository_snapshots`, `findings.repo.commitSha` |
| Production test | Requires production deploy verification |
| Limitations | Demo local repo may lack SHA; scan job path not yet wired |

### 3. Findings analysis

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Frontend route | `/app?tab=findings` |
| Frontend action | Run Findings |
| API route | `POST /api/jobs/findings`, `POST /api/findings/run` |
| Execution service | `scanRepository` / `runFindingsEngine` |
| Persistence | `findings` collection (+ L1 process cache) |
| Production test | Smoke test findings step |
| Limitations | Fallback analyzers on serverless; cross-instance GET without Redis |

### 4. Risk classification (Safe / Review / Protected)

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Frontend route | Findings tab, summary cards |
| Execution service | `normalize-findings`, `confidence-path-rules` |
| Persistence | Embedded in findings payload |
| Limitations | Fallback unused-file estimates are review-first by policy |

### 5. Free proof — Fix One Safe Issue Free

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Frontend route | `/app?tab=cleanup` |
| Frontend action | Fix One Safe Issue Free |
| API route | `POST /api/cleanup/run` |
| Execution service | `executeFreeProof` → one-fix loop + baseline verification |
| Persistence | `cleanup_runs`, `execution_receipts` |
| Production test | `scripts/phase1-integration-test.mjs` + `/api/cleanup/run` |
| State machine | Backend `CleanupRunStateMachine` — created → preparing_workspace → running_baseline → selecting_finding → generating_change → validating_patch → running_verification → retained/skipped/rejected → completed/failed |
| Limitations | Zero safe candidates → review plan only (honest); no GitHub mutation in free proof |

### 6. Deterministic fix-plugin system (Phase 1)

| Field | Value |
|-------|-------|
| **Status** | **REAL** (Phase 1 narrow set) |
| Execution service | `execution/fix-plugins/phase1-plugins.ts`, `apply-phase1-fix.ts` |
| Supported | Remove unused import, remove unused dependency (native knip), remove obvious temp/backup file |
| Eligibility | `safe_candidate` + confidence threshold + `sourceMode !== untrusted` + `supports(finding)` + non-protected path |
| Not supported | Duplicates, business logic, APIs, routes, auth, DB, middleware, shared hooks |
| Limitations | Dependency remove requires supported package manager + lockfile update |

### 7. Baseline verification

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Execution service | `execution/baseline-verification.ts` |
| Frontend | Cleanup tab — baseline, post-change, comparison table |
| Checks | typecheck, lint, test, build, import validation, package integrity |
| Comparison | PASSED_BEFORE_AND_AFTER, FAILED_BEFORE_AND_AFTER, NEW_FAILURE_INTRODUCED, PRE_EXISTING_FAILURE_RESOLVED, NOT_AVAILABLE, SKIPPED, TIMED_OUT |
| Limitations | Timeout 45s per check; install validation best-effort on serverless |

### 8. One-fix-at-a-time loop

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Execution service | `execution/one-fix-at-a-time.ts` |
| Behavior | Select → patch → validate → baseline → retain or rollback |
| Limitations | Free proof max 1; Quick Cleanup still uses patch-kit batch path |

### 9. A2MCP Quick Triage (0.03 USD₮0)

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Protocol | A2MCP · service **32948** |
| Operation | `analyze_repository` |
| API route | `POST /api/a2mcp/quick-triage` |
| Price | **0.03 USD₮0** per call |
| Settlement | Live x402 on X Layer |
| Description | Bounded repository triage returning up to five prioritized findings |
| Note | This is the public A2MCP listing — not negotiated cleanup PR delivery |

### 10. A2A Verified Cleanup PR (negotiated · default 1 USD₮0)

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Protocol | A2A · service **32947** |
| Operation | `create_cleanup_pr` |
| Frontend route | Patch tab → RepoDiet Operator section |
| API route | `POST /api/a2a/tasks` / ASP job APIs |
| Execution service | `createCleanupPullRequest` |
| Persistence | GitHub branch + PR; `execution_receipts` |
| Price | Negotiated; default reference **1 USD₮0** |
| Settlement | Task agreement → escrow → delivery → buyer acceptance → release |
| Limitations | Requires GitHub App install; never auto-merges main |

### 11. GitHub App integration

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Routes | `/api/github/install`, `callback`, `status`, `disconnect` |
| Execution service | `GitHubClient`, `resolve-cleanup-token` |
| Persistence | Session cookie; `github_installations` collection prepared |
| Limitations | No webhooks; no auto-merge (by design) |

### 12. Operator-signed execution receipt

| Field | Value |
|-------|-------|
| **Status** | **PARTIAL** |
| API | Returned from cleanup run + create_cleanup_pr |
| Execution service | `createExecutionReceipt` |
| Persistence | `execution_receipts` collection |
| Limitations | Signature null without `REPODIET_OPERATOR_PRIVATE_KEY`; no public verify endpoint yet |

### 13. Context-bound task quotes

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| API route | `POST /api/tasks/quote` |
| Execution service | `executeTaskQuote` |
| Persistence | `task_quotes` collection |
| Limitations | `validateTaskQuote` not yet called at payment/settlement |

### 14. x402 payment

| Field | Value |
|-------|-------|
| **Status** | **REAL** (test mode) / **STRICT** when `REQUIRE_REAL_X402=1` |
| Services | `lib/payment/*` — quote binding, settlement, lifecycle |
| Quote | `POST /api/tasks/quote` → HTTP 402 with bound quote |
| Pay | `POST /api/tasks/pay` → verify signature, fund quote |
| Enforced on | A2A orchestrator paid tasks, quote-bound execution |
| Legacy demo | `x-repodiet-demo-pay` header on patch/verify when not strict |
| Receipt | `SignedReceiptV1` RSA-SHA256 via `REPODIET_OPERATOR_PRIVATE_KEY` |
| Verification | `npm run verify:x402` |
| Limitations | Facilitator URL optional; on-chain verify when strict + facilitator configured |

### 15. A2MCP tools

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Routes | `/api/tools/*` |
| Manifest | `GET /api/tools/manifest` |
| Limitations | Most tools bypass execution engine facade |

### 16. A2A task lifecycle

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Agent card | `GET /.well-known/agent-card.json` |
| Submit | `POST /api/a2a/tasks` |
| Poll | `GET /api/a2a/tasks/{taskId}` |
| Approve | `POST /api/a2a/tasks/{taskId}/approve` |
| Fund | `POST /api/a2a/tasks/{taskId}/fund` |
| Orchestrator | `src/lib/a2a/orchestrator.ts` — deterministic roles, no agent theater |
| State machine | submitted → validating → … → completed / failure states |
| Approval | `awaiting_approval` before GitHub PR creation |
| Callbacks | Optional `callbackUrl` on submit (best-effort) |
| Verification | `npm run verify:a2a` |
| Limitations | x402 quote binding on paid A2A tasks |

### 17. Repo Guard

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Activate | `POST /api/guard/run` (action=activate), A2A `repository.guard_activation`, A2MCP `activate_repo_guard` |
| Webhook | `POST /api/github/webhook` — push, pull_request merged |
| Manual scan | `POST /api/guard/run` (repository) |
| Status | `GET /api/guard/{owner/repo}` |
| Delta analysis | `src/lib/guard/delta-analysis.ts` — new/resolved/recurring/ignored |
| Triggers | PR merged, default branch push, manifest change, file-count spike, manual, weekly |
| Pricing | Not part of the public OKX two-service model |
| Verification | `npm run verify:guard` |

### 18. Repository memory / policies

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Store | `repository_policies` collection via `src/lib/guard/repository-memory.ts` |
| Configure | `POST /api/tools/configure_repository_policy` |
| Fields | protectedPaths, allowAutomaticFixes, rejectedFindings, approval prefs, notification settings |
| Enforcement | Policy applied during guard delta scans and safe-candidate selection |

### 19. Landing / marketing animations

| Field | Value |
|-------|-------|
| **Status** | **COSMETIC** |
| Files | `hero-terminal.tsx`, `workflow-pipeline.tsx`, static `DEMO_SCAN_STATS` |
| Note | App workflow uses real engine; landing widgets use cached demo stats |

### 20. Pricing page

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Route | `/pricing` |
| CTAs | A2MCP Quick Triage (0.03 USD₮0 x402) · A2A Verified Cleanup PR (negotiated / default 1 USD₮0 escrow) |

---

## Persistence model

| Collection | Purpose | Backend | Status |
|------------|---------|---------|--------|
| `jobs` | Async scan/findings/patch jobs | Redis or `.repodiet-runtime` | **REAL** |
| `findings` | Findings payloads | Redis/local + L1 cache | **REAL** |
| `patchKits` | Patch kit artifacts | Redis/local + L1 cache | **REAL** |
| `verifications` | Verify run results | Redis/local | **REAL** |
| `repositories` | Connected repo metadata | Redis/local | **REAL** |
| `repository_snapshots` | commitSha per capture | Redis/local | **REAL** |
| `scans` | Scan records | Redis/local | **PREPARED** |
| `cleanup_runs` | Free proof / cleanup runs | Redis/local | **REAL** |
| `cleanup_changes` | Per-change records | Redis/local | **PREPARED** |
| `verification_runs` | Verification history | Redis/local | **PREPARED** |
| `task_quotes` | Context-bound quotes | Redis/local | **REAL** |
| `payments` | Payment settlement + replay locks | Redis/local | **REAL** |
| `execution_receipts` | Signed receipts | Redis/local | **REAL** |
| `github_installations` | Install metadata | Redis/local | **PREPARED** |
| `repository_policies` | Protected paths / policies | Redis/local | **PREPARED** |
| `guard_runs` | Guard subscriptions + delta runs | Redis/local | **REAL** |

**Workspace rule:** Ephemeral repo clones use `os.tmpdir()/repodiet` on serverless — never `/var/task/data`.

**L1 cache:** `findings-store` and `patch-kit-store` use process-global `Map` as read-through cache only; durable store is written first.

---

## Security checklist

| Check | Status |
|-------|--------|
| Operator private key in client | **PASS** — server env only |
| Runtime writes under `/var/task` | **PASS** — redirected to tmpdir |
| Fake success on cleanup | **PASS** — real workspace + git apply |
| x402 quote binding + replay protection | **PASS** — bound quotes, nonce, idempotency |
| Repo Guard false CTA | **PASS** — marked Coming Soon |

---

## Phase 0 acceptance gate

| Gate | Status |
|------|--------|
| typecheck | Run in CI / local |
| lint | Run in CI / local |
| tests | Run in CI / local |
| production build | Run in CI / local |
| No `/var/task` writes | Verified in `workspace.test.ts` |
| No operator key in client | Verified — no `NEXT_PUBLIC_*` key |
| No fake cleanup success | Verified — real patch validation |
| Pricing CTAs honest | Repo Guard marked unavailable |
| Production scan | Run `npm run test:production` after deploy |

---

## Phase 3 — A2MCP agent tools

| Tool | Endpoint | Engine | Status |
|------|----------|--------|--------|
| `scan_repository` | `POST /api/tools/scan_repository` | `scanRepository` | **REAL** |
| `analyze_repository` | `POST /api/tools/analyze_repository` | `analyzeRepository` | **REAL** |
| `get_findings` | `POST /api/tools/get_findings` | findings store | **REAL** |
| `list_safe_fixes` | `POST /api/tools/list_safe_fixes` | `selectSafeFixes` | **REAL** |
| `get_repository_health` | `POST /api/tools/get_repository_health` | findings + analyzers | **REAL** |
| `get_task_status` | `GET /api/tools/tasks/{taskId}` | task store | **REAL** |
| `run_free_safe_fix` | `POST /api/tools/run_free_safe_fix` | `executeFreeProof` | **REAL** |
| `run_quick_cleanup` | `POST /api/tools/run_quick_cleanup` | `runQuickCleanup` | **REAL** |
| `run_cleanup` | `POST /api/tools/run_cleanup` | unified runner | **REAL** |
| `verify_cleanup` | `POST /api/tools/verify_cleanup` | `verifyChanges` | **REAL** |
| `create_cleanup_pr` | `POST /api/tools/create_cleanup_pr` | `createCleanupPullRequest` | **REAL** |
| `configure_repository_policy` | `POST /api/tools/configure_repository_policy` | policy store | **REAL** |
| `activate_repo_guard` | `POST /api/tools/activate_repo_guard` | — | **NOT IMPLEMENTED** (honest failure) |

**ASP manifest:** `GET /api/tools/manifest` v2.0.0 — production URL, pricing, privacy, agent flow, tool schemas.

**Verification:** `npm run verify:asp` — 46-check production gate script.

**Legacy tools** (`scan_repo_bloat`, etc.) remain for compatibility; `scan_repo_bloat` now calls `scanRepository`.

---

## Next phases

1. **Phase 6** — Repo Guard + repository memory — **DONE**
2. **Phase 7** — Production demo hardening + `npm run smoke:full`
