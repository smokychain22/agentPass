# RepoDiet Product Capability Matrix

**Branch audited:** `cursor/product-vision-pricing-39ce`  
**Audit date:** 2026-07-10  
**Phase:** 0 — Foundation Audit and Branch Integration

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
| Production test | Manual + `/api/cleanup/run` after deploy |
| Limitations | Zero safe candidates → review plan only (honest) |

### 6. Deterministic fix-plugin system

| Field | Value |
|-------|-------|
| **Status** | **PARTIAL** |
| Execution service | `execution/fix-plugins.ts` |
| Supported | File delete (unused/temp), dependency remove (typed only) |
| Not supported | Import cleanup, config merge, hook refactor |
| Limitations | Plugins classify; actual changes are delete-patch only today |

### 7. Baseline verification

| Field | Value |
|-------|-------|
| **Status** | **PARTIAL** |
| Execution service | `execution/baseline-verification.ts` |
| Frontend | Cleanup tab baseline summary |
| Checks | typecheck, build, lint when package.json scripts exist |
| Limitations | No full `npm install` in free proof loop; timeout 45s per check |

### 8. One-fix-at-a-time loop

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Execution service | `execution/one-fix-at-a-time.ts` |
| Behavior | Select → patch → validate → baseline → retain or rollback |
| Limitations | Free proof max 1; Quick Cleanup still uses patch-kit batch path |

### 9. Quick Cleanup (0.25 USDT)

| Field | Value |
|-------|-------|
| **Status** | **PARTIAL** |
| Frontend route | `/app?tab=patch` |
| API route | `POST /api/jobs/patch` |
| Execution service | `runPatchKitEngine` (not yet unified one-fix loop) |
| Payment | x402 when `REQUIRE_REAL_X402=1`; beta bypass otherwise |
| Limitations | Up to 5 fixes via patch kit, not per-finding loop yet |

### 10. Verified Cleanup PR (1–3 USDT)

| Field | Value |
|-------|-------|
| **Status** | **REAL** |
| Frontend route | Patch tab → RepoDiet Operator section |
| API route | `POST /api/tools/create_cleanup_pr` |
| Execution service | `createCleanupPullRequest` |
| Persistence | GitHub branch + PR; `execution_receipts` |
| Payment | **NOT IMPLEMENTED** on PR route (beta open) |
| Limitations | Requires GitHub App install or demo token |

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
| **Status** | **DEMO** |
| Service | `lib/payment/x402.ts` |
| Enforced on | patch job, patches/generate, verify/run |
| Not enforced on | A2MCP tools, cleanup run, create_cleanup_pr |
| Limitations | Beta bypass unless `REQUIRE_REAL_X402=1`; no crypto verify of signatures |

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
| **Status** | **NOT IMPLEMENTED** |
| Present | Quotes, receipts, marketing copy |
| Missing | Task create/poll/complete APIs, task store, payment binding |

### 17. Repo Guard

| Field | Value |
|-------|-------|
| **Status** | **NOT IMPLEMENTED** |
| Pricing CTA | Marked "Coming Soon" |
| Prepared | `guard_runs` collection, quote type |

### 18. Repository memory / policies

| Field | Value |
|-------|-------|
| **Status** | **NOT IMPLEMENTED** |
| Prepared | `repository_policies` collection |

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
| CTAs | Free Proof, Quick Cleanup, Verified PR → real app tabs; Repo Guard → Coming Soon |

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
| `payments` | Payment settlement | Redis/local | **PREPARED** |
| `execution_receipts` | Signed receipts | Redis/local | **REAL** |
| `github_installations` | Install metadata | Redis/local | **PREPARED** |
| `repository_policies` | Protected paths / policies | Redis/local | **PREPARED** |
| `guard_runs` | Repo Guard scheduled runs | Redis/local | **PREPARED** |

**Workspace rule:** Ephemeral repo clones use `os.tmpdir()/repodiet` on serverless — never `/var/task/data`.

**L1 cache:** `findings-store` and `patch-kit-store` use process-global `Map` as read-through cache only; durable store is written first.

---

## Security checklist

| Check | Status |
|-------|--------|
| Operator private key in client | **PASS** — server env only |
| Runtime writes under `/var/task` | **PASS** — redirected to tmpdir |
| Fake success on cleanup | **PASS** — real workspace + git apply |
| x402 bypass documented | **PASS** — beta mode explicit |
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

## Next phases (do not start until Phase 0 gate passes)

1. **Phase 1** — Wire all job/API routes through execution engine; unify Quick Cleanup with one-fix loop
2. **Phase 2** — End-to-end GitHub PR from cleanup tab; capture commitSha on scan jobs
3. **Phase 3** — x402 settlement bound to task quotes; A2A task create/poll APIs
4. **Phase 4** — Repo Guard scheduling and alerts
