# RepoDiet Docker Worker

Execution plane for Git validation, repository verification, and (future) PR delivery.
The Vercel app is the control plane; this worker is the execution plane.

## Requirements

- Docker host with Git, Node 20, 2GB+ RAM for Next.js builds
- `WORKER_API_KEY` matching the Vercel deployment
- `REPODIET_API_BASE_URL` pointing at production (e.g. `https://skillswap-skillswap7.vercel.app`)
- `GITHUB_INSTALLATION_TOKEN` or GitHub App credentials for private clone (future)

## Run locally

```bash
export WORKER_API_KEY=your-secret
export REPODIET_API_BASE_URL=http://localhost:3000
npm run worker:start
```

## Docker

```bash
docker build -f worker/Dockerfile -t repodiet-worker .
docker run --rm \
  -e WORKER_API_KEY=... \
  -e REPODIET_API_BASE_URL=... \
  -e GITHUB_INSTALLATION_TOKEN=... \
  repodiet-worker
```

## Job flow

1. Vercel queues `repository_jobs` when Git CLI is unavailable on serverless
2. Worker claims job via `POST /api/internal/worker/jobs/claim-next`
3. Worker clones exact commit, applies changes, runs `git apply --check`
4. Worker runs baseline + patched verification
5. Worker callbacks `POST /api/internal/worker/jobs/:id/complete`

## Vercel environment variables

```
WORKER_API_KEY=
WORKER_CALLBACK_SECRET=
```

Set the same `WORKER_API_KEY` on the worker container.
