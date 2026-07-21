# A2A End-to-End Runbook

## Service model

RepoDiet A2A is a **custom cleanup service**, not a second x402 API.

Flow:

```
create task → negotiation → versioned quote → marketplace escrow confirmed
→ repository analysis → cleanup plan → write approval → GitHub changes
→ tests/build/lint → PR delivery → acceptance/revision → escrow release
```

## Controlled repository only

Write-action integration tests must use:

https://github.com/velz-cmd/repodiet-e2e-test (`main`)

Never create or merge a cleanup PR against a third-party repository from this agent.

## Automated coverage

Unit / integration tests cover:

- Parent reconciliation when child deep-scan becomes READY while parent is still DISPATCHED
- Repeated callback/poll does not double-advance
- Child failure moves parent out of DISPATCHED
- Public serializers omit dispatch/claim/lease tokens
- Quote approval binds quote version + commit SHA (existing quote tests)

## Manual marketplace path (owner)

Requires explicit owner-controlled buyer identity:

1. Create / assign real marketplace task to ASP 5283 / A2A service 32947
2. Complete negotiation; record quote ID + pinned commit SHA
3. Confirm marketplace escrow (not a custom x402 invention)
4. Wait for deep-scan READY → parent must auto-advance (ingest reconcile)
5. Approve cleanup scope
6. Verify branch `repodiet/<task-id>-cleanup` (or equivalent), CI, PR metadata
7. Submit delivery → accept → terminal `accepted` / `completed`
8. Leave a genuine review only after real completion

## Recovery

Protected recovery helpers:

- `reconcileParentTaskFromScan(taskId, scanId)` — primary repair
- `recoverStrandedA2AParentTasks({ taskIds })` — batch repair for stranded DISPATCHED parents

Do not “fix” stranded UI by rewriting status in the client.
