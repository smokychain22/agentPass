# OKX Reviewer Acceptance Evidence — Agent #9636 (RepoDiet)

Canonical production: https://skillswap-virid-kappa.vercel.app
Agent: **#9636** (RepoDiet, ASP) · A2MCP **37347** (Quick Triage, x402, 0.03 USDT) · A2A **37348** (Verified Cleanup, escrow, 1 USDT)

This document captures read-only, non-mutating evidence gathered directly through the installed
OKX skill's real entry points (never a manual CLI translation of a reviewer's sentence), plus real
production delivery already completed end-to-end by RepoDiet's own GitHub App. All timestamps below
are from the run that produced them; re-run the same commands to refresh before relying on this
document, since `approvalDisplayStatus` and marketplace routing can change independently of RepoDiet's
own code.

## Reviewer Request: Test RepoDiet as a User

**Exact User phrase:** `"I would like to use the service of agent 9636"`
**Buyer:** `abdullahlp114@gmail.com`, Agent **#10466**
**Provider:** RepoDiet **#9636**

**Reachability (fresh, 2026-08-15):**
- `#9636` — `onlineStatus:1` (online), `agentRuntime.agentOnline:true`, heartbeat `fresh`.
- Service `37347` (A2MCP) — reachable: `agent x402-check` against
  `https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage` returns a valid quote
  (`valid:true`, `0.03 USDT`, correct `payTo`/network `eip155:196`). No 404/5xx/timeout.
- Service `37348` (A2A) — registered and healthy via `agent service-list --agent-id 9636`
  (the authoritative source; `get-agents.serviceList` can read empty during review and is not used
  here): `id:37348`, `type:A2A`, `fee:1`.

**Real payment proof:** `0.03 USDT` paid successfully from #10466 to #9636 for service 37347.
Transaction: `0x106fef5c904a50bbfc77a13918b23bdbd7b1add8ab60c93f0b7f7f1f9de6ba75`, receipt
`receipt_avck9iJrUE6S`. RepoDiet returned a real signed analysis. (Not re-spent for this evidence
pass — reused as-is, per standing instruction not to spend another A2MCP payment merely to
demonstrate the same fact twice.)

**A2A product proof:** RepoDiet autonomously created cleanup **PR #12** on
`velz-cmd/repodiet-e2e-test`, authored and committed entirely by `repodiet-operator[bot]`.

**Current marketplace limitation:** A2A service 37348 is not currently escrow-routable — a fresh
`asp-match` (task description: *"Analyze this GitHub repository, identify unnecessary files safely,
and prepare a cleanup Pull Request only for changes that pass RepoDiet's validation. Repository:
velz-cmd/repodiet-e2e-test"*) and `prepare-create` both resolve to `route: "x402"` / service `37347`,
not A2A/escrow, because Agent #9636 remains under OKX listing review (`approvalDisplayStatus: 2`).
This is a marketplace-routing gate external to RepoDiet, not a reachability defect — RepoDiet itself,
both services, and the backend are all confirmed healthy and reachable end-to-end.

## 0. Production versions & health (2026-08-15, fresh)

- **Git**: `main` @ `e52727a` ("fix: a stale in-process cache blocked delivery of an already-verified
  patch kit", #211), working tree clean.
- **Vercel production**: team `skillswap7`, project `skillswap` (`prj_C2kqR6ITvFA3eoyvZZh75RuDpEQi`).
  Latest production deployment `dpl_DMJpYXz9dU9hyfq5Zj365dEnMorj`, state `READY`, built from `e52727a`
  — matches `main` exactly. (`workspace` Vercel project is a non-production leftover — not used.)
- **Fly runtime health** (`GET /api/okx/health`): `overallReady:true`, `a2mcpQuickTriageReady:true`,
  `a2aRuntimeReady:true`, `workerReady:true`, `dispatcherReady:true`, `githubAppReady:true`,
  `agentRuntime.agentOnline:true`, `heartbeatStatus:"fresh"`, `xmtpClientReady:true`,
  `officialWatchActive:true`, `queueDepth:0`, `degradedReasons:[]`. Machine `7845320c476008`
  (app `repodiet-agent-9636`), state `started`, deploy version 106.
- **`/api/okx/production-readiness`**: verdict `NOT_READY`, but only on 3 evidence-based probes
  (`last_paid_a2mcp`, `last_real_pr`, `last_escrow_release` — no recent event recorded because no live
  paid A2A transaction has happened yet). All 8 infra probes (durable store, a2mcp paid mode, a2a
  marketplace intake, github app, receipt signer, attestation signer, worker/dispatcher, agent-alert)
  = `ready:true`. This is expected state, not a regression.
- **Regression suite** (typecheck, `test:a2a`, sandbox-worker-model, worker-claim, evidence/classifier,
  isolation/idempotency — including the exact regression tests for PR #210's duplicate-dispatch fix and
  PR #211's stale-cache fix): all green, 0 failures.
- **GitHub Actions**: all `main`-branch runs after the #211 merge are green. Historical red runs
  (pre-#210 duplicate-dispatch artifacts) remain visible but are explained and not fresh signal.

## 1. Reviewer natural-language acceptance test — mechanism detail

Conclusions and current numbers are in **§Reviewer Request** above; this section documents *how* the
phrase reaches that result, for anyone auditing the routing path itself.

**Routing (via the installed `okx-ai` skill, not a hand-picked CLI command):**
`task-user-playbook.md` routing table → row *"指定服务商 / use the service of Agent X ... "* →
`task-user-actions-publish.md` §5 "Designated-Provider A2A flow". Since the trigger phrase names no
specific `ServiceTitle`, the skill's own logic selects **Path A** (service discovery first):

1. `agent service-list --agent-id 9636` — service discovery (per skill's Path A).
2. `agent asp-match --task-desc "<candidate task>" --provider-agent-id 9636 --agent-id 10466 --format json` — Flow step 1. With a real cleanup task description, this returns only the A2MCP
   recommendation (37347) — 37348 is withheld while `approvalDisplayStatus` is `2`. Per the skill's
   own §5 Flow, an x402-supported match routes to §6 (A2MCP), so a genuine buyer following this exact
   phrase today would be offered the paid x402 triage call, not the A2A escrow service.
3. `agent prepare-create` resolves the same way: `{"route":"x402","endpoint":".../api/a2mcp/quick-triage","feeAmount":"0.03"}`.

This is the skill's own routing logic reaching a real, unmodified external gate — not a bug in
RepoDiet, and not something worked around.

## 2. OKX approval state (read-only, freshly re-confirmed 2026-08-15)

```json
{"agentId":"9636","approvalDisplayStatus":2,"approvalLabel":"Listing under review",
 "approvalRemark":"改资料触发重新审批","status":2,"statusLabel":"not listed"}
```

`approvalRemark` ("profile change triggered re-approval") confirms the compliant 440×440 avatar
update was accepted by OKX's own system and triggered the current review — not a rejection signal.
No profile, service, or pricing fields were modified this session to obtain or influence this result.

**37347 authoritative status** (via `agent service-list --agent-id 9636`, not the `serviceList` field
on `get-agents`, which is a known display quirk during review): `id:37347`, `serviceType:A2MCP`,
`fee:0.03`, `endpoint:https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage` — healthy,
unchanged.

**37348 authoritative status**: `id:37348`, `serviceType:A2A`, `fee:1`, `endpoint:null` (expected for
an escrow service) — healthy, unchanged.

## 3. Real production delivery (A2MCP + full autonomous A2A-shaped delivery pipeline)

- **A2MCP, real spend, already proven (do not repeat):** tx
  `0x106fef5c904a50bbfc77a13918b23bdbd7b1add8ab60c93f0b7f7f1f9de6ba75`, 0.03 USDT, receipt
  `receipt_avck9iJrUE6S`.
- **End-to-end autonomous delivery, real customer repo (`velz-cmd/repodiet-e2e-test`):** latest is
  **PR #12** ("RepoDiet: repair 1 verified repository issue"), opened 2026-08-14T20:29:22Z, authored
  and committed entirely by `repodiet-operator[bot]` (GitHub App, type `Bot`) — zero Claude/Codex/
  local-git involvement in the delivery commit itself. Prior PR #9 (2026-08-11) and #11 (2026-08-14)
  are earlier instances of the same autonomous path — the pipeline has now produced multiple
  independent real PRs, not a single one-off.
- This proves the full pipeline OKX's A2A escrow flow would drive (analysis → sandbox verification →
  branch → commit → PR, RepoDiet-owned throughout) already works end-to-end in production. The only
  blocking piece is the OKX-side approval gate in §2, which is external to RepoDiet and cannot be
  satisfied by code changes.

## 4. GitHub App delivery-capability preflight (fresh matrix, 2026-08-15)

`POST /api/github/capability` against three repos:

| Repo | installationFound | canCreateBranch/PushChanges/CreatePR | permissions | latency |
|---|---|---|---|---|
| `velz-cmd/repodiet-e2e-test` (installed) | `true` | all `true` | `contents:write`, `pull_requests:write` | 2.70s |
| `velz-cmd/Meridian` (not installed) | `false` | all `false` (`failureCode:"installation_required"`) | `{}` | 2.54s |
| nonexistent repo (deterministic negative control) | `false` | all `false` (same `failureCode`) | `{}` | 1.85s |

Fail-closed in both the missing-installation and nonexistent-repo cases — a real customer repo cannot
be silently treated as writable. Not redesigned; it is already performing correctly.

**Meridian install path (confirmed, not performed):** repo owner (`velz-cmd`) must install
`repodiet-operator` (https://github.com/apps/repodiet-operator) on `velz-cmd/Meridian`. Required
permissions, confirmed both from production route source (`src/app/api/github/capability/route.ts`)
and the live public App manifest (`GET https://api.github.com/apps/repodiet-operator`):
`contents: write`, `pull_requests: write` (plus read-only `actions`, `checks`, `metadata`, `statuses`).
Must be installed by the repo owner through GitHub's own App-install flow — never with Claude's
personal GitHub credentials.

## 5. Fly.io housekeeping

Orphan volume `vol_re1d97ynz1onw014` (name `repodiet_persistent`, duplicate of the active volume's
name, created 2026-08-11): confirmed **unattached** (no Machine reference), not referenced anywhere in
`fly.toml`, repo, or docs, and not a backup/rollback artifact (the active volume `vol_4qld9gg6y2x567wr`
is the sole volume `fly.toml`'s single Machine mounts). Deleted 2026-08-15. Active volume
`vol_4qld9gg6y2x567wr` was not touched.

## 6. What remains gated

Real A2A payment (service 37348) stays blocked until **all** of the following are independently true
(not just one):

1. `approvalDisplayStatus` reaches `4` ("listed"/eligible) — currently `2`.
2. `asp-match` for a genuine buyer surfaces service 37348 as a recommendation (currently only 37347
   x402 surfaces).
3. `prepare-create` for 37348 resolves to the A2A/escrow route rather than falling back to x402.

None of these are within RepoDiet's control; no profile edit, blind re-approval submission, or
workaround was attempted, per standing instruction. When approval flips to `4`, re-run §1 with the
same trigger phrase — a routable A2A recommendation for 37348 there is the signal to proceed to a
real, capped (≤1.00 USDT) end-to-end A2A payment test, on `velz-cmd/repodiet-e2e-test` first (GitHub
App installed, write capability proven, sandbox proven, PR delivery proven, isolation proven) —
**not** Meridian, until its App install is separately completed by its owner.

## 7. Independence guarantees (confirmed by design, re-verified this session)

- **Laptop/Claude/Codex independence**: every PR in §3 is authored and committed by
  `repodiet-operator[bot]`, a GitHub App identity distinct from any human or AI-assistant git identity.
  No customer branch/commit/PR has ever been created manually by Claude, Codex, or this laptop's own
  git identity.
- **Delivery idempotency**: an immediate replay of the same delivery call against an already-delivered
  branch returns the same PR with `filesDeleted: 0` and an explicit "already applied on reused branch"
  warning, rather than creating a duplicate or mutating further (verified in a prior session; regression
  test `cleanup-pr-idempotent-redelivery` passing in the current suite confirms this still holds).
- **Duplicate-dispatch fix (PR #210)**: live claim lease + suppress redispatch; `CLAIMED_BY_OTHER`/
  `TERMINAL` duplicates are a clean no-op, not a false red service failure. Regression test
  `sandbox-duplicate-dispatch` passing in the current suite.
- **Buyer deletion approval / unsafe-candidate refusal**: RepoDiet only applies buyer-approved cleanup
  scope, and its classification engine refuses unsafe candidates rather than silently downgrading scope
  (see `docs/CLASSIFICATION-ENGINE.md`).

No secrets are included in this document.
