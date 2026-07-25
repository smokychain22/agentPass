# RepoDiet End-to-End Audit

Branch: `fix/repodiet-final-audit-followup`, cut from `origin/main` at `719006f` after confirming
`grok/repodiet-final-end-to-end` (PRs #61–#65) was already fully merged, and that PR #52 was
functionally superseded except for its (never-merged) documentation.

## 1. Removed: Meridian-specific production repair code

Deleted `POST /api/github/repository-repair`, `src/lib/github/repository-repair.ts`
(`applyMeridianBaselineRepair`, `MERIDIAN_BASELINE_REPAIR_ID`), the `meridian-repair/` bundle
directory, and the two manual repair shell scripts. The general scanner → findings → patch →
validation → GitHub App PR flow is untouched and repository-agnostic — nothing in it ever branched
on `velz-cmd/Meridian` specifically (confirmed via `src/lib/product/bypass-audit.ts`, which
classifies all remaining `Meridian`/`repodiet-e2e-test` references as `validation_target` or
`docs_only`, never a production authorization path).

## 2. Removed: incident-specific internal diagnostic routes

Deleted `/api/internal/a2mcp/quick-triage-diagnostic`, `/api/internal/a2mcp/verify-diagnostic`,
`/api/internal/a2mcp/recover-incident-payment` (and the `INCIDENT_QUOTE_ID` /
`INCIDENT_PAYMENT_REFERENCE` / `INCIDENT_REQUEST_DIGEST` constants it depended on), plus the scripts
and tests that only existed to exercise them. `scripts/a2mcp-production-validation.ts` and
`scripts/okx-preview-acceptance.ts` were rewritten to exercise only public production endpoints and
to assert the removed routes now 404.

## 3. Fixed: Quick Triage coverage truthfulness

`filesInspected` previously came from `Math.min(findings.summary.totalFindings, cap)` — a
zero-finding scan always reported zero files inspected, regardless of how much of the repository
was actually read. It is now computed from a real inventory walk
(`buildFullRepositoryInventory`), independent of finding count, and includes discovered/inspected/
skipped counts with per-kind reasons and an honest `complete`/`partial`/`unavailable` state.
7 regression tests in `test/quick-triage-coverage-truthfulness.test.ts`.

## 4. Reworked: Review Findings UI

`UserDirectedWorkbench`'s internal Review/Plan/Pay/Delivery stage switcher and its
Automatic-Cleanup/Guided-Review/Advanced three-way mode switcher (both nested inside the outer
Connect → Review → Create PR → Review & Accept workflow) have been removed. The Findings review
stage now exposes exactly two views — **Results** (default: truthful summary, search/filter/sort,
per-finding evidence and one of four honest statuses, selection controls, "Create cleanup plan") and
**Technical details** (coverage, repository explorer, scan activity/analyzer sources, repository
map, project roots, scan/commit identifiers). 6 regression tests in
`test/findings-results-technical-views.test.ts`.

## 5. Fixed: dishonest task/API states

The public A2A task response derived `terminal` from a hand-maintained list that had drifted out of
sync with the actual state machine — it marked `payment_failed`, `analysis_failed`,
`verification_failed`, `delivery_failed`, and `checks_failed` as terminal even though all of them
have real recovery edges in `task-state-machine.ts` (and `/continue` actively resumes
`payment_failed` tasks by regenerating a quote). `terminal` is now derived directly from the state
machine's transition graph via `isTerminalA2AStatus`, with a new `RETRY_CONTINUE` nextAction making
the recovery path explicit. 7 regression tests in `test/a2a-honest-terminal-state.test.ts`. Escrow
release was independently confirmed to already require `buyer_accepted` status plus an explicit
on-chain reference — settlement can't complete without on-chain evidence.

## 6. Verified: parent/child A2A reconciliation idempotency

`reconcileParentTaskFromScan` already had optimistic-concurrency and already-past-analysis guards;
added regression coverage for the two properties that weren't yet directly tested: a scan correlated
to a different task is rejected (`task_scan_correlation_mismatch`) rather than cross-applied, and
reconciling the same READY scan three times from three different callers never emits more than one
`analyzing` transition. `test/a2a-reconcile-idempotency.test.ts`.

## 7. Verified: repository isolation

Repository identity binds to GitHub's immutable numeric ID (`refresh-repo-identity.ts`), not just
owner/name — a rename is recognized as the same repository, and a different repository that later
reuses a freed name gets a different ID and is never merged with the original. Findings are keyed by
random per-scan ID, so two repositories with identical file paths never collide in durable storage.
`test/repository-isolation.test.ts`, alongside existing tenant-mismatch and cross-repository
coverage in `test/public-multitenant.test.ts`, `test/findings-tenant-binding.test.ts`, and
`test/production-worker-tenant-sandbox.test.ts`.

## Not yet executed in this audit

Production deployment verification, the real Meridian A2MCP/A2A acceptance run (including the OKX
Agentic Wallet payment), and OKX resubmission all require live external systems and, in the payment
case, explicit user authentication/confirmation — they are the next steps after this branch merges,
not something this document can certify in advance.
