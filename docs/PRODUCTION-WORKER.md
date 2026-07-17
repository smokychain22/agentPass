# Production worker (always-on)

RepoDiet requires an always-on Linux worker that claims durable deep-scan and cleanup jobs.

The worker must **not** run inside Cursor, Codex, Claude, a developer laptop, a temporary cloud-agent session, a Vercel request, or Next.js `after()` as the complete executor.

## Deploy target

Recommended: **Render Background Worker** (or equivalent always-on Linux host) using `worker/Dockerfile`.

Required environment:

| Variable | Purpose |
| --- | --- |
| `REPODIET_API_BASE_URL` | Production API base (`https://skillswap-virid-kappa.vercel.app`) |
| `WORKER_API_KEY` | Shared secret for `/api/internal/worker/*` |
| `WORKER_CALLBACK_SECRET` | Optional extra callback signing header |
| `WORKER_ID` | Stable worker id (e.g. `render-prod-1`) |
| `WORKER_VERSION` | Semver string reported in heartbeats |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Same durable store as the API |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Optional alternate durable store |

Do **not** put GitHub App private keys, receipt/attestation signers, or OKX API secrets into untrusted sandbox child environments. The worker process may hold Redis credentials for durable job progress; customer `npm`/`build`/`test` must use `buildUntrustedSandboxEnv()`.

## Lifecycle

1. Start automatically with the host
2. Register + signed heartbeat
3. Poll deep-scan claim, then cleanup claim
4. Atomically claim one eligible job
5. Isolated workspace per job
6. Lease heartbeat during execution
7. Persist stage progress / checkpoints
8. Complete or classify failure
9. Destroy workspace
10. Continue polling

## Readiness

`workerReady` is true only when a fresh signed heartbeat exists (not from env alone). Controlled test: stop worker → `workerReady` false within 90s → restart → true → queued jobs resume.

## Required environment variable names (values are secrets — do not commit)

| Name | Required | Notes |
| --- | --- | --- |
| `REPODIET_API_BASE_URL` | yes | Preview or production API origin |
| `WORKER_API_KEY` | yes | Must match Vercel `WORKER_API_KEY` |
| `WORKER_CALLBACK_SECRET` | recommended | Matches Vercel callback secret |
| `WORKER_ID` | yes | Stable id e.g. `staging-render-1` |
| `WORKER_VERSION` | yes | Semver reported in heartbeats |
| `WORKER_HOST` / `HOSTNAME` | yes | Host label stored on claims |
| `WORKER_POLL_MS` | optional | Default 5000 |
| `WORKER_HEARTBEAT_MS` | optional | Default 10000 |
| `UPSTASH_REDIS_REST_URL` | yes* | Same durable store as API |
| `UPSTASH_REDIS_REST_TOKEN` | yes* | Same durable store as API |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | alt* | Alternate durable store |
| `REPODIET_UNTRUSTED_SANDBOX` | yes for package scripts | Set `docker` when Docker isolation is available |

\* One durable-store pair is required.

## Sandbox classification

Secret filtering alone is **SANDBOX INCOMPLETE**.

Customer `npm`/`pnpm`/`yarn`/`bun` package scripts run only when Docker isolation is active (`REPODIET_UNTRUSTED_SANDBOX=docker` and `docker` available on the worker host). Read-only deep scans must not execute package scripts until then.
