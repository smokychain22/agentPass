# RepoDiet production-readiness — continuation state

Last updated: 2026-08-10 ~10:20 UTC (autonomous session, low context remaining)

## LATEST: #191 shipped, decisive Row 8 proof IN FLIGHT

- main = `dd388df02ef2a63a735a10440e13826aa497646d` (PR #191 merged, CI green,
  Fly deployed and confirmed live: `BUILD_COMMIT` on the box = this SHA)
- PR #190 (restart policy `always`) already live before this — confirmed via
  `flyctl status`.
- **A proof is running right now** at
  `/persistent/repodiet-final-row8-dd388df/` on `repodiet-agent-9636`,
  launched 2026-08-10T09:22:46Z, with bounds sized to the measured cost:
  `REPODIET_VERIFY_COMMAND_TIMEOUT_MS=1500000`,
  `REPODIET_VERIFY_TOTAL_TIMEOUT_MS=4200000`,
  `REPODIET_HEAVY_JOB_TIMEOUT_MS=5400000`. As of 10:19Z (~57 min in) it is
  still `"state":"running"`. The overnight measurement run took 64.7 min and
  PASSED verification, dying only on the now-fixed expired token — so this run
  is expected to either produce the real PR or fail with a genuinely new,
  fully diagnosable reason (phase timings + `err.details` from #188/#189/#191
  are all live).

**NEXT ACTION for whoever continues this:** check
`/persistent/repodiet-final-row8-dd388df/status.json` and
`stdout.log`/`stderr.log`. If `state:"finished"` with `exitCode:0`, read
`stdout.log` for the `step:"engine_reported_pull_request"` line containing the
real PR URL on `velz-cmd/repodiet-e2e-test`, then independently verify it via
`gh pr view` (open, not merged, correct base/branch, only
`src/repodiet-verification-unused.js` changed, `src/config/runtime-hook.ts`
untouched) — that closes Row 8. If it failed, read the full `stderr.log`
(small file, safe to cat in full) for the exact phase timings and error.

**Do NOT launch another Row 8 proof until this one's outcome is read.** Do not
re-run the 64.7-minute measurement — that fact is already established.

## UPDATE: the dd388df proof FAILED — #191 had a bug in itself, now fixed as PR #192

Result: `exitCode:1`, ran 09:22:46Z→10:39:35Z (76.8 min), same `Bad credentials`
401, but the stack trace now points at **line 458 of my own #191 fix**
(`create-cleanup-pr.ts`), not the original pre-#191 call site.

Root cause: `resolveCleanupGitHubToken` returns an explicitly-supplied
`githubToken` **verbatim** rather than minting fresh
(`resolve-cleanup-token.ts:199-200`). The CLI proof script
(`verify-production-cleanup-pr.ts`) mints one token at the top and passes it
as `githubToken` into `createCleanupPullRequest`'s input. #191's refresh call
forwarded `input.githubToken` — the SAME stale value — so the refresh was a
no-op for exactly this caller.

**Fix pushed as PR #192**
(`fix/incident-37-followup-do-not-forward-stale-token`,
https://github.com/smokychain22/agentPass/pull/192): the refresh call no
longer forwards `githubToken`, forcing the GitHub App installation-token path
every time. Typecheck clean, lint clean, two directly-relevant tests pass
(`cleanup-pr-client`, `verification-diagnostics-details`).

**NOT YET DONE for #192** (stopped here — session context exhausted):
- Full `npm test` / `test:okx-runtime` / build were NOT re-run this cycle —
  only typecheck + lint + 2 targeted test files. CI's `typecheck-test-build`
  will catch regressions before merge, but the full local matrix should still
  be run before treating this as fully validated.
- PR #192 has not been merged. Wait for required checks green, merge,
  confirm Fly `BUILD_COMMIT` matches, THEN launch one more Row 8 proof.
- Do NOT skip re-reading `resolve-cleanup-token.ts` in a fresh session before
  assuming this is the only place `githubToken` is forwarded stale — grep for
  `githubToken: input.githubToken` and `githubToken:.*token` across
  `create-cleanup-pr.ts` once more before the next proof, in case there's a
  third call site.

## STILL NOT DONE if this run succeeds

1. Patched-first verification ordering (the remaining ~27min/job optimization)
   — not yet implemented. See "BREAKTHROUGH" section below for the exact
   design and safety constraints. This is a product-quality improvement, not
   a Row 8 blocker if the proof above already produced a real PR — do it after
   Row 8 is confirmed CLEAR, not as a precondition.
2. Row 10 final qualification window on `dd388df` (or whatever SHA is final
   after patched-first ships) — not yet run.
3. Row 9 final read-back on the final SHA — partially done (deploy confirmed
   live above), needs the formal Vercel/GitHub-checks read-back.
4. One controlled Fly restart-recovery proof for the `always` policy — not yet
   done. Do this only when no heavy job is active.
5. `agentpass-unknown-merger` — PR #190 merged itself again (2026-08-09
   23:51:35Z, `mergedBy: smokychain22`, checks were green, `flyctl-deploy`
   succeeded). Worth a concise `gh api` check of
   `repos/smokychain22/agentPass/branches/main/protection` and any webhook/App
   installations before spending real time — not yet investigated this
   session.
6. A2A/A2MCP/payment-config final read-backs — not yet done this session
   (should be quick, read-only).

## Original state below (2026-08-09 ~20:40 UTC)

## Current SHAs

| Thing | Value |
|---|---|
| main SHA | `4288078553c87e684c9a8426267ea3e023576774` |
| Fly BUILD_COMMIT (verified live) | `4288078553c87e684c9a8426267ea3e023576774` |
| Fly app / machine | `repodiet-agent-9636` / `7845320c476008` (never replaced) |
| Branch | `main` (clean, no local work in progress) |

## PRs merged this session (all required checks green before merge)

| PR | What |
|---|---|
| #185 | verification npm cache reuse between baseline and patched phases (`lockfilePatched === false` → shared content-addressed cache) |
| #186 | `repository-verification.ts` wires `describeProcessTermination` + `REPODIET_VERIFY_COMMAND_TIMEOUT_MS` (Incident #35 part 2) |
| #187 | `PRODUCTION_COMMAND_TIMEOUT_MS` 180s → 300s, matching `run-verification.ts`'s incident-justified bound |
| #188 | `ToolExecutionError.details` + `summarizeVerificationForDiagnostics` + proof script prints phase timings |

## Row 8 status: NOT CLEAR

Four production proof runs, each failing further along than the last (progress, not stagnation):

| SHA | Duration | Failure |
|---|---|---|
| `92b267f` | 48m | baseline "fails verification" — actually a killed process, misdiagnosed (Incident #35) |
| `44a4a39` | 38.6m | `Dependency install exceeded its time limit` — honest report, install phase |
| `1f0f9f0` | 30.3m | baseline build "fails verification" — killed process again, in `repository-verification.ts` (a *different* file from the one #184 fixed) |
| `7003d0f` | 31.6m | `Verification command "build" exceeded its time limit` — honest, but no per-phase timings yet |
| `4288078` | running (started 20:31:56Z) | first run with phase-timing diagnostics |

Evidence directory on the machine: `/persistent/repodiet-final-row8-<short-sha>/`
(`status.json`, `stdout.log`, `stderr.log`, `run.sh`). Launched detached via
`nohup`, survives SSH/Claude/local-PC disconnect.

### Measured root-cause evidence (live, during a running proof)

```
loadavg   6.35   (on a 1 vCPU box → ~6x oversubscription)
MemTotal  2015836 kB (~2 GB)
MemFree    158160 kB
SwapTotal       0 kB   ← no swap at all
top RSS: openclaw-gateway 305MB, node 205/202/178/131/73/60/59MB (~1.2GB total)
```

Eliminated with evidence (NOT the cause):
- Next.js build-worker CPU oversubscription — `os.cpus()` correctly reports `1`,
  `nproc` = 1. No container CPU misdetection.

Remaining hypothesis: genuine memory/IO pressure + `nice 19` (Incident #22) +
`--maxsockets 3` (Incident #23) make an unconstrained-<60s `next build`
exceed the 300s bound. PR #184 measured the same commit building in <60s
unconstrained, so the code is fine; the box is starved.

### Known duplicate work in the pipeline

- `resolveFindings` → `runFindingsEngine` = clone + analyze (workspace 1)
- `resolvePatchKit` → `runPatchKitEngine` = **second** clone (workspace 2) + patch gen + verification
- `runPatchKitEngine` DOES reuse inline findings (no second findings-engine run)
- The **real A2A customer path** (`orchestrator.ts:1414`) passes BOTH `findings`
  and `patchKit`, so `createCleanupPullRequest` re-derives nothing. Only the CLI
  proof passes neither. The two clones are inherent to findings-engine +
  patch-kit-engine, not a proof artifact.

### Candidate fix (not yet implemented) — patched-first verification ordering

`resolveOutcome` requires `baselineOk && patchedOk` for `"verified"`, so today
both phases always run: 2 installs + 2 typechecks + 2 builds.

A fully-green **patched** tree cannot be a regression, so baseline could be
skipped whenever patched passes everything — halving the happy-path cost.
Baseline would still run when patched fails, to classify pre-existing vs
regression. This preserves the safety model exactly. Needs care: it changes a
load-bearing safety path (`repository-verification.ts` `resolveOutcome`).

## Rows

| Row | State | Evidence |
|---|---|---|
| 1–7 | CLEAR (previously) | not re-investigated this session; no contradictory evidence seen |
| 8 | **NOT CLEAR** | no real PR yet on `velz-cmd/repodiet-e2e-test`; verified via `gh pr list` that no stray PR was created |
| 9 | effectively clear per-SHA | CI + Fly deploy green for every merged SHA above; needs final read-back on final SHA |
| 10 | needs final window | `44a4a39`: 89 accepted/1 withheld (observer interference suspected). `7003d0f`: 51 accepted/2 withheld, both during real Row 8 heavy work — genuine contention, not observer effect |

## Vercel

- Canonical production project: `skillswap` (`prj_C2kqR6ITvFA3eoyvZZh75RuDpEQi`)
- Non-production: `workspace` (`prj_KU0DpcHdWPp2fnAdOsyPjJ1tzmCh`), team `team_JWKXBovC2arZaKYgQnrA2Ajy`
- `workspace` was blocking `skillswap` by occupying the build-concurrency slot
  (PR #187: workspace `Building` 35min doing nothing while skillswap sat `Queued`).
  Fixed at source: workspace's `commandForIgnoringBuildStep` set to `exit 0`.
  Confirmed working on PR #188 — "Canceled by Ignored Build Step", skillswap
  built immediately.

## Standing constraints

- Do NOT resubmit / reactivate / change avatar / change services for OKX Agent 9636 (under review).
- Do NOT settle, acknowledge, deliver or mutate funded job `0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6`.
- Do NOT hand-write `/persistent/data/okx-runtimes/heavy-job.lock`.
- Do NOT raise `PRODUCTION_INSTALL_TIMEOUT_MS` (600s) or `PRODUCTION_HEAVY_JOB_TIMEOUT_MS` (3000s) without measured evidence.
- Two GitHub accounts are authenticated; `gh auth switch --user smokychain22` is
  required before push/merge (`velz-cmd` lacks permission and the active account
  resets between calls).
- `sed -i` on Windows can rewrite a file to CRLF — always `file <path>` and
  `git diff --check` after.

## BREAKTHROUGH (2026-08-09 ~23:21 UTC) — verification CAN pass on this box

A measurement run with only the bounds relaxed
(`REPODIET_VERIFY_COMMAND_TIMEOUT_MS=1200000`, `TOTAL=3600000`, `HEAVY=4200000`),
using the real production path, at `/persistent/repodiet-measure-build/`:

- ran 22:16:18Z → 23:21:02Z (**64.7 minutes**)
- **verification PASSED** — no build timeout; it got all the way past the
  `verifiedChanges` gate into the delivery phase
- then failed at the FIRST delivery call:
  `Bad credentials` 401 on `GET /repos/velz-cmd/repodiet-e2e-test/git/ref/heads/...`

### Two conclusions

1. **The 300s command bound is simply too small for this box, not wrong in
   principle.** Derived from the run: non-build checks total ~906s
   (installs 277s + 258s, typechecks ~176s each, tests ~20s), so the two
   `next build`s consumed roughly **~1000–1200s each (17–20 min)**. They
   complete; they were being killed. PR #184 measured the same commit
   building in <60s unconstrained, so this is ~20x starvation from
   `nice 19` + agent + 1 vCPU + 2 GB + zero swap.

2. **Incident #37 — the GitHub App token expires mid-job.** The token is
   minted ONCE at the top of `createCleanupPullRequestUnlocked` and the same
   client is reused for delivery an hour later. Installation tokens live ~1
   hour. Everything in between (clone, analyze, 2 installs, 2 typechecks,
   2 tests, 2 builds) is legitimately tens of minutes. **The bigger the
   customer repo, the more certain this failure — the most valuable jobs are
   the ones guaranteed to hit it.** Fixed by re-resolving the token
   immediately before delivery (`client` is now reassigned, so branch create,
   file upsert/delete, PR create and repair lookup all use it).

### The remaining decision (NOT yet done)

Even fixed, a ~65 min job is a poor customer experience and sits right on the
token/heavy-job limits. The highest-value remaining optimization is
**patched-first verification ordering**:

`resolveOutcome` currently needs `baselineOk && patchedOk` for `"verified"`,
so both phases always run. But **a fully-green patched tree cannot be a
regression** — if patched passes every check, there is nothing baseline can
reveal that would change the delivery decision. Running patched FIRST and
skipping baseline when it is fully green would drop one install (~270s), one
typecheck (~176s), one test, and **one build (~1200s)** ≈ 27 minutes, taking a
run from ~65 min to ~38 min. Baseline would still run whenever patched fails,
to classify pre-existing vs regression. This preserves the safety model
exactly and helps every real customer.

Pair that with a measured command bound (~1200s). Note this inverts the
`command < install` assertion I added in
`test/repository-verification-termination.test.ts` — that invariant was my own
and is not load-bearing; the meaningful one is
`max(command, install) < total verify (2400s) < heavy job (3000s)`. Update the
assertion deliberately, with this measurement as justification.

## Outstanding after Row 8

1. `fly.toml` restart policy is still the temporary `on-failure` / `retries = 3`.
   `docs/SELLER_RUNTIME_DEPLOYMENT.md` says revert to `policy = "always"` once the
   bootstrap proved stable. `test/seller-runtime-portability.test.ts` currently
   ASSERTS the bounded policy — that test must be updated in the same PR.
   Incident #10 (stale PID lock exhausting the 3-attempt budget) appears fixed by
   PR #181 (pid-start-time disambiguation).
2. One controlled restart-recovery proof after that change.
3. Final Row 10 window on the final SHA, overlapping real heavy work.
4. Final Row 9 read-back on the final SHA.
