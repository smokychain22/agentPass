# Free ephemeral GitHub Actions analysis workers

RepoDiet runs read-only findings on **standard GitHub-hosted `ubuntu-latest` runners** for the public `smokychain22/agentPass` repository.

- **$0/month** hosting
- **$0** when idle
- No Render / Railway / Fly / always-on daemon required

## Flow

1. Browser `POST /api/findings/analyze` → durable deep-scan job (HTTP 202)
2. Vercel creates a one-use `dispatchNonce` and calls GitHub **`repository_dispatch`**
3. Endpoint: `POST /repos/smokychain22/agentPass/dispatches` with `event_type: repodiet_analysis`
4. Response: **HTTP 204** (no workflow run id yet)
5. Workflow `.github/workflows/repodiet-analysis-worker.yml` runs three jobs:
   - **claim** (trusted) — Worker API key; claim + archive artifact; persists real `github.run_id`
   - **analyze** (untrusted) — no Worker/OKX/Redis/signing/dispatch secrets; read-only static analysis
   - **complete** (trusted) — ingest findings; mark READY
6. Runner terminates automatically

## Required secrets

### Vercel Production only

| Name | Purpose |
| --- | --- |
| `REPODIET_ACTIONS_DISPATCH_TOKEN` | Fine-grained PAT with **Contents: Read and write** on `smokychain22/agentPass` only |
| `WORKER_API_KEY` | Must match Actions `REPODIET_WORKER_API_KEY` |
| `WORKER_CALLBACK_SECRET` | Must match Actions callback secret |

`REPODIET_ACTIONS_DISPATCH_TOKEN` must **never** be added to GitHub Actions secrets or workflow env.

### GitHub Actions repository secrets

| Name | Purpose |
| --- | --- |
| `REPODIET_WORKER_API_KEY` | Same value as Vercel `WORKER_API_KEY` |
| `REPODIET_WORKER_CALLBACK_SECRET` | Same value as Vercel `WORKER_CALLBACK_SECRET` |

## Health

`dispatcherReady` is probed (token + repo access + workflow file on main with `repository_dispatch` / `repodiet_analysis`), not just env presence.

```json
{
  "workerMode": "github_actions_on_demand",
  "dispatcherReady": true,
  "queueReady": true,
  "activeWorkers": 0,
  "activeWorkflowRuns": 0
}
```

## Limits

See `src/lib/github-actions/limits.ts` (100MB archive, 20k files, read-only, <6h).
