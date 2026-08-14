# A2A sandbox patch validation — implementation continuation note

Written 2026-08-14. Repo state at time of writing: `main` = `1b7069a`, working tree clean,
no partial implementation left behind.

## Why this exists

A2A delivery is blocked at exactly one place. The pipeline runs autonomously through:

```
A2A intake -> persisted task -> GitHub Actions analysis -> reconciliation -> patch kit
```

and then stops. `POST /api/github/create-cleanup-pr` returns
`422 {"ok":false,"error":"No verified source changes in cleanup run."}` because
`createCleanupPullRequest` (`src/lib/operator/create-cleanup-pr.ts:368,391`) requires in
`safe_only` mode:

- `patchKit.summary.verifiedChanges > 0`
- `patchKit.patchValidation.status === "passed"`

The patch kit instead carries:

```
patchValidation = { status: "pending_sandbox",
  error: "Git CLI is unavailable; content integrity passed but git apply --check did not run." }
```

**The gate is correct and must not be weakened.** `canonical-patch.ts` only emits `passed`
when `gitCliAvailable === true`. Vercel's serverless runtime has no git binary, and
`dispatchSandboxExecution` currently routes sandbox work *back to the same Vercel app*
(`/api/internal/sandbox-runs/execute`), so validation can never succeed there.

Decision (made by the operator): run sandbox validation on **GitHub Actions**. Not Vercel.
Not the persistent Fly.io #9636 machine — that runtime holds OKX/wallet secrets and must not
process untrusted customer repositories.

## The security model to copy

`.github/workflows/repodiet-analysis-worker.yml` already solves this, and its three-job split
is the pattern to mirror exactly:

| Job | Secrets | Touches untrusted repo |
|---|---|---|
| `claim` | `REPODIET_WORKER_API_KEY`, `REPODIET_WORKER_CALLBACK_SECRET` | No |
| `analyze` | **none** — header: "NO RepoDiet/OKX/Redis/signing/dispatch secrets; static analysis only" | **Yes** |
| `complete` (`needs: [claim, analyze]`) | callback secret | No |

So the git work belongs in a **secretless middle job**. No new long-lived secret is required;
reuse the existing worker auth mechanism. Do not collapse these into one secret-bearing job.

## Implementation steps

1. **`.github/workflows/repodiet-sandbox-validation-worker.yml`** — three-job split as above,
   `repository_dispatch` type `repodiet_sandbox_validation`.
2. **`src/lib/execution/dispatch-sandbox-execution.ts`** — when `isServerlessRuntime()`, fire the
   `repository_dispatch` instead of POSTing to `/api/internal/sandbox-runs/execute`. Keep the
   local/Docker path intact for development and tests.
3. **Worker endpoints** mirroring the deep-scan pattern
   (`/api/internal/worker/deep-scans/claim-next`, `.../progress`) for sandbox runs, with atomic
   claim so two dispatched workflows cannot both become authoritative.
4. **Reuse `src/lib/execution/repository-executor.ts:224-270` verbatim** — it already runs
   `git update-index --refresh && git apply --check --index --verbose cleanup.patch &&
   git apply --index cleanup.patch && git diff --cached --check`. Do not write a second,
   weaker validator.
5. **Server-side completion verification** — on callback, reload the stored sandbox run, task and
   patch kit and require `patchKitId`, `baseCommitSha`, `patchHash` and `decisionFingerprint` all
   to match before setting `passed`. A worker must never be able to assert `passed` for arbitrary
   data; exit code 0 is not sufficient.
6. **Delivery-time rebinding** in `create-cleanup-pr.ts` — immediately before PR creation, require
   the current patch hash and base commit to still equal the sandbox-approved values, else fail
   closed and demand fresh validation. This blocks validate-patch-A / deliver-patch-B.

Constraints that must hold: the validate job must not run `npm install`, tests, or any
repository-provided script — `git apply --check` needs none of that. Pass the patch as a file or
artifact, never through unescaped shell interpolation of customer-controlled content. A timeout
means "not verified", never `passed`.

## Tests to add

Valid patch passes; patch that does not apply fails; wrong pinned commit fails; tampered patch
hash fails; unexpected changed path fails; duplicate dispatch yields one authoritative result;
duplicate completion is idempotent; worker timeout never passes; lost callback is recovered by
`reconcile-sandbox-run`; patch changed after validation is refused at delivery.

## Live state to resume against

- Task `task_b331ba058e5342`, scan `scan_jXINymZhB6af`, base commit `5df7c518`
- Patch kit `patchkit_gWUGcY4hpDcl` — 4 delete operations, `transformerCompatible: 4`,
  `dryRunPassed: 4`, expected `verifiedChanges = 4`
- Target `velz-cmd/repodiet-e2e-test` — GitHub App installed, installation `…4323`,
  `contents: write`, `pullRequests: write`, branch/push/PR all true
- Expected result after this work: `patchValidation.status = "passed"`, then
  `/api/github/create-cleanup-pr` produces branch + commit + PR and the A2A task reaches its
  delivered state.

A fresh patch kit may be needed if the stored one cannot be safely resumed.
