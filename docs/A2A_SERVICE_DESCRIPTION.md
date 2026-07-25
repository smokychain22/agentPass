# RepoDiet A2A Service Description

## What it does

Deep repository analysis and approved code remediation delivered as a validated draft GitHub pull
request for the repository owner to review and accept.

## Public identity

- OKX ASP Agent ID: `5283`
- OKX A2A Service ID: `32947`
- Commercial operation: `create_cleanup_pr`
- Network: X Layer mainnet (`eip155:196`)
- Settlement asset: USD₮0 `0x779ded0c9e1022225f8e0630b35a9b54be713736`

## Lifecycle

A2A task status is an explicit state machine (`src/lib/a2a/task-state-machine.ts`) — every status
has a defined set of valid next states, and `terminal` in the public task response
(`formatA2ATaskResponse`, `src/lib/a2a/orchestrator.ts`) is derived directly from that machine, not
a hand-maintained list. A status is only ever reported `terminal: true` when it genuinely has no
further transitions:

`completed`, `rejected`, `unsupported`, `cancelled`, `expired` (plus `escrow_released`, which is
treated as done for callers even though the record still auto-advances to `completed` as
bookkeeping).

Everything else — including `payment_failed`, `analysis_failed`, `verification_failed`,
`delivery_failed`, and `checks_failed` — is recoverable. `nextAction` in the task response tells the
caller which:

- `DONE` — completed or escrow released, nothing left to do
- `RETRY_CONTINUE` — call `POST /api/a2a/tasks/{taskId}/continue`; it regenerates a bound quote when
  the previous one expired or payment failed, and never creates a second scan or a duplicate quote
- `INSPECT_FAILURE` — a genuine dead end (rejected / unsupported / cancelled / expired)
- `POLL_TASK_STATUS` — still in progress

## Parent/child reconciliation

Deep repository analysis runs as a durable child job (`deep_scan_jobs`), separate from the A2A
parent task. `reconcileParentTaskFromScan` (`src/lib/a2a/reconcile-parent-from-scan.ts`) is the sole
bridge between them and is safe to call repeatedly from three independent triggers (ingest
callback, status poll, scheduled recovery job) without side effects beyond the first:

- optimistic concurrency via a monotonic `stateVersion` — a second caller racing the first sees
  `concurrent_state_version_conflict` and does not double-apply
- a scan whose `request.a2aTaskId` belongs to a different task is rejected
  (`task_scan_correlation_mismatch`), never silently applied to the wrong task
- a task already past analysis, or already terminal, is refreshed for dispatch metadata only — no
  duplicate `analyzing` transition is ever emitted

## Delivery and settlement

`delivery_ready → delivery_submitted → buyer_accepted → escrow_released → completed` is the only
path to a released escrow. Escrow release requires `status === buyer_accepted` and an explicit
on-chain `escrowReleaseReference` — there is no route that marks settlement complete without that
reference.
