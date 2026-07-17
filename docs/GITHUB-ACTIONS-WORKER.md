# Free ephemeral GitHub Actions analysis workers

RepoDiet runs read-only findings on **standard GitHub-hosted `ubuntu-latest` runners** for the public `smokychain22/agentPass` repository.

- **$0/month** hosting
- **$0** when idle
- No Render / Railway / Fly / always-on daemon required

## Flow

1. Browser `POST /api/findings/analyze` → durable deep-scan job (HTTP 202)
2. Vercel creates a one-use `dispatchNonce` and calls GitHub `workflow_dispatch`
3. Workflow `.github/workflows/repodiet-analysis-worker.yml` runs three jobs:
   - **claim** (trusted) — Worker API key; claim + archive artifact
   - **analyze** (untrusted) — no Worker/OKX/Redis/signing secrets; static analysis only
   - **complete** (trusted) — ingest findings; mark READY
4. Runner terminates automatically

## Required secrets

### Vercel Production

| Name | Purpose |
| --- | --- |
| `REPODIET_ACTIONS_DISPATCH_TOKEN` | Fine-grained PAT or GitHub App installation token with Actions: write on `smokychain22/agentPass` only |
| `WORKER_API_KEY` | Must match Actions `REPODIET_WORKER_API_KEY` |
| `WORKER_CALLBACK_SECRET` | Must match Actions callback secret |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Server-side only — never in the analyze job |

Optional: `REPODIET_ACTIONS_REPO` (default `smokychain22/agentPass`), `REPODIET_ACTIONS_WORKFLOW_REF`, `REPODIET_PUBLIC_API_BASE_URL`.

### GitHub Actions repository secrets

| Name | Purpose |
| --- | --- |
| `REPODIET_WORKER_API_KEY` | Same value as Vercel `WORKER_API_KEY` |
| `REPODIET_WORKER_CALLBACK_SECRET` | Same value as Vercel `WORKER_CALLBACK_SECRET` |

Do **not** put Redis, OKX, GitHub App private keys, or signing keys into the untrusted analyze job.

## Health

```json
{
  "workerMode": "github_actions_on_demand",
  "dispatcherReady": true,
  "queueReady": true,
  "activeWorkers": 0,
  "activeWorkflowRuns": 0
}
```

Idle `workerReady` means the dispatcher can start a run — not a permanent daemon heartbeat.

## Limits

See `src/lib/github-actions/limits.ts` (100MB archive, 20k files, read-only, <6h).
