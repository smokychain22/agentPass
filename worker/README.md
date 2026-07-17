# RepoDiet production worker

Always-on Linux worker that claims durable **deep-scan** and **cleanup** jobs from the RepoDiet API.

This is required for production. Vercel request handlers and Next.js `after()` must not be the complete executor.

See also: [`docs/PRODUCTION-WORKER.md`](../docs/PRODUCTION-WORKER.md)

## Run locally (against a shared durable store)

```bash
export REPODIET_API_BASE_URL=https://skillswap-virid-kappa.vercel.app
export WORKER_API_KEY=...
export WORKER_CALLBACK_SECRET=...
export WORKER_ID=local-dev-1
export WORKER_VERSION=2.0.0-deep-scan
export UPSTASH_REDIS_REST_URL=...
export UPSTASH_REDIS_REST_TOKEN=...

npm run worker:start
```

## Docker / Render

```bash
docker build -f worker/Dockerfile -t repodiet-worker .
docker run --env-file worker.env repodiet-worker
```

Configure a Render Background Worker (or equivalent) with the same image and environment. The process must stay running and send heartbeats so `/api/okx/health` reports `workerReady: true`.

## Job types

1. Deep scan — `POST /api/internal/worker/deep-scans/claim-next` (`execute: false`) then analysis in this process
2. Cleanup — `POST /api/internal/worker/jobs/claim-next` then repository verification / patch preparation

Customer install/build/test environments must use the secret firewall (`buildUntrustedSandboxEnv`). Trusted GitHub delivery and signing stay outside the untrusted sandbox.
