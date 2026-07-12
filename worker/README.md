# RepoDiet Worker (deprecated)

The external Docker worker on Render is **no longer required** for production.

RepoDiet now uses **Vercel Workflows + Vercel Sandbox** for Git validation and repository verification.

This directory remains for local development reference only.

## Production path

1. Quick Cleanup generates ChangeOperations on Vercel
2. `repositoryCleanupWorkflow` starts via Vercel Workflow SDK
3. Verification runs in an isolated Vercel Sandbox microVM
4. Results persist to Upstash; UI polls `/api/sandbox-runs/:id`

## Local development

When not on Vercel, the app falls back to local Git verification if `git` is available.

```bash
npm run worker:start   # optional legacy poller — not used in production
```
