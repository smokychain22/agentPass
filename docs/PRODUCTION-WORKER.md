# Production worker (always-on)

RepoDiet requires an always-on Linux worker that claims durable deep-scan and cleanup jobs.

The worker must **not** run inside Cursor, Codex, Claude, a developer laptop, a temporary cloud-agent session, a Vercel request, or Next.js `after()` as the complete executor.

## Deploy target

Recommended: **Render Background Worker** (not a Web Service, not a Cron Job) using `render.yaml` + `worker/Dockerfile`.

### Exact Render Dashboard steps

1. Open [Render Dashboard](https://dashboard.render.com) → **New** → **Background Worker**.
2. **Connect GitHub repository:** `smokychain22/agentPass` (authorize the Render GitHub app if prompted).
3. **Branch:** `main` (after the follow-up UX merge is on production).
4. **Service type:** Background Worker (persistent process; not Web Service; not One-off Job).
5. **Runtime:** Docker.
6. **Dockerfile path:** `worker/Dockerfile`
7. **Docker build context:** repository root `.` (required — Dockerfile copies root `package.json` / lockfile and builds the worker bundle).
8. **Start command:** leave default from Dockerfile (`node worker/dist/index.js`). Do not override to `npm start` on the web app.
9. **Instance / plan:** Starter (or higher). Keep the service always on.
10. **Environment variables** — add in the Render Environment UI (paste values only in Render / Vercel dashboards; never in Cursor chat):

#### Must match Vercel Production exactly

| Name | Where | Notes |
| --- | --- | --- |
| `WORKER_API_KEY` | Render **and** Vercel | Same value both sides |
| `WORKER_CALLBACK_SECRET` | Render **and** Vercel | Same value both sides |
| `UPSTASH_REDIS_REST_URL` | Render **and** Vercel | Same Upstash DB as production API |
| `UPSTASH_REDIS_REST_TOKEN` | Render **and** Vercel | Same token as production API |

#### Render-only / worker identity

| Name | Value guidance |
| --- | --- |
| `REPODIET_API_BASE_URL` | `https://skillswap-virid-kappa.vercel.app` |
| `WORKER_ID` | `render-prod-1` |
| `WORKER_VERSION` | `2.1.0-readonly-findings` |
| `WORKER_HOST` | `render-production-worker` |
| `WORKER_POLL_MS` | `5000` |
| `WORKER_HEARTBEAT_MS` | `10000` |
| `REPODIET_UNTRUSTED_SANDBOX` | `off` for first Meridian findings proof |

11. Click **Deploy Background Worker**.
12. Open **Logs**. Expect: worker version, worker ID, API base URL, `Untrusted sandbox: off`, `Worker polling active`, periodic heartbeats.
13. On Vercel Production, confirm `GET /api/okx/health` shows `workerReady: true` and `workerReadySource: "authenticated_heartbeat"` within ~90s.

### After first successful heartbeat

Do **not** treat the worker as operational until health derives from the live heartbeat (not from configuration alone).

## Required environment variable names (values are secrets — do not commit)

| Name | Required | Notes |
| --- | --- | --- |
| `REPODIET_API_BASE_URL` | yes | Production API origin |
| `WORKER_API_KEY` | yes | Must match Vercel `WORKER_API_KEY` |
| `WORKER_CALLBACK_SECRET` | recommended | Matches Vercel callback secret |
| `WORKER_ID` | yes | Stable id e.g. `render-prod-1` |
| `WORKER_VERSION` | yes | Semver reported in heartbeats |
| `WORKER_HOST` / `HOSTNAME` | yes | Host label stored on claims |
| `WORKER_POLL_MS` | optional | Default 5000 |
| `WORKER_HEARTBEAT_MS` | optional | Default 10000 |
| `UPSTASH_REDIS_REST_URL` | yes* | Same durable store as API |
| `UPSTASH_REDIS_REST_TOKEN` | yes* | Same durable store as API |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | alt* | Alternate durable store |
| `REPODIET_UNTRUSTED_SANDBOX` | yes | `off` until Docker isolation is COMPLETE |

\* One durable-store pair is required.

## Lifecycle

1. Start automatically with the host
2. Register + signed heartbeat
3. Poll deep-scan claim, then cleanup claim
4. Atomically claim one eligible job (`claimToken` issued once)
5. Isolated workspace per job
6. Lease heartbeat during execution
7. Persist stage progress / checkpoints
8. Complete or classify failure
9. Destroy workspace
10. Continue polling

## Read-only findings safety (first Meridian proof)

With `REPODIET_UNTRUSTED_SANDBOX=off` (fail closed):

| Allowed | Prohibited |
| --- | --- |
| Repository archive acquisition | `npm install` / `pnpm install` / `yarn` / `bun install` |
| Static inventory | npm lifecycle scripts |
| Repository graph construction | build / test / lint |
| Knip / jscpd / Madge when they do not execute customer package scripts | Arbitrary `package.json` commands |
| Persist findings + coverage | Customer shell commands in the trusted controller |

Baseline verification must report `NOT_RUN` / `SANDBOX_REQUIRED` — never a false “build verified” claim.

Secret filtering alone is **SANDBOX INCOMPLETE**. Customer package scripts run only when Docker isolation is active (`REPODIET_UNTRUSTED_SANDBOX=docker` **and** Docker verified).

## Readiness

`workerReady` is true only when a fresh authenticated heartbeat exists (not from env alone). Controlled test: stop worker → `workerReady` false within 90s → restart → true → queued jobs resume.
