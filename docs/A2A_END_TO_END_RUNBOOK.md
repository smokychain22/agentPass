# A2A End-to-End Runbook

Operational guide for resuming, funding, and delivering a real `repository.cleanup_pr` A2A task.

## 1. Resolve current task status before acting

`GET /api/a2a/tasks/{taskId}` (or `POST .../continue`) returns the authoritative state — never
assume a durable task/scan/quote ID from a prior session is still valid. Check:

- `status` and `terminal` — if `terminal: true` with `nextAction: DONE`, nothing further is needed
- `nextAction: RETRY_CONTINUE` — the task is recoverable; call `/continue` before anything else
- `result.reconciledFromScanAt` / `result.childScanStage` — whether the linked deep-scan child has
  actually reported back since the task was last touched

## 2. Resume analysis

`POST /api/a2a/tasks/{taskId}/continue`:

- reconciles the parent from its linked deep-scan child if the child is `READY`/`FAILED` and the
  parent hasn't advanced yet (idempotent — see `A2A_SERVICE_DESCRIPTION.md`)
- if the repository's default branch has moved since the scan was taken, the prior scan is marked
  stale and exactly one new scan is created at the new commit — commits are never mixed
- generates a bound quote only when one is missing or the prior one is `payment_failed` /
  `quote_required` / expired — never a second live quote for an already-funded task

## 3. Select findings and generate the patch

Only evidence-backed, supported, safe-candidate findings (`Safe to fix` in the Results view) are
eligible. The patch is generated and validated (baseline → apply → patched validation, fail-closed
if patched validation is worse) before funding is requested.

## 4. Fund

`POST /api/a2a/tasks/{taskId}/fund` requires a verified on-chain payment matching the quote's payer,
recipient, network, asset, and amount exactly. A quote already `funded` is never re-funded — a
second `/fund` call on an already-verified quote is idempotent, not a second charge.

## 5. Deliver

Branch → draft PR (via the GitHub App) → delivery evidence submitted → buyer review → escrow
release. RepoDiet never auto-merges the customer's PR — the repository owner accepts it.

## 6. Isolation checks before declaring success

- repository ID (immutable GitHub numeric ID, not just owner/name), branch, and exact commit all
  match what's in the task record
- no fixture or RepoDiet-source-repository data appears in the result
- no duplicate scan, quote, escrow, or PR was created during the run
