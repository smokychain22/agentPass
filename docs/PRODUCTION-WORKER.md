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

## Staging access

For automated acceptance against Preview/staging without making private routes public:

1. Enable Vercel Deployment Protection Bypass for Automation
2. Send header `x-vercel-protection-bypass: <secret>` (secret from Vercel project settings)
3. Never put the bypass secret in URLs, logs, or customer responses

Public health remains redacted; internal worker routes still require `WORKER_API_KEY`.
