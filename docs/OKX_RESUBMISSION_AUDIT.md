# RepoDiet OKX Resubmission Audit

Last verified: 2026-07-27

## Command 2 — Quick Triage engine hardening and a real, paid canary

### Objective

Verify the real A2MCP Quick Triage analysis engine (`analyze_repository`,
service 37347) produces genuinely useful, repository-specific findings —
not generic checklist output — before any real payment, per the strict
Phase 11 rejection criteria (no fabricated findings, no vague AI prose,
real file evidence, prioritization, actionable next steps).

### Finding: paid response was dropping real evidence the engine already computed

`src/lib/a2mcp/quick-triage-engine.ts` genuinely runs deterministic checks
(knip import-graph fallback, jscpd, madge, AI-slop heuristics) against the
real repository contents via `runBoundedQuickTriageScan()`. Confirmed by
direct dry run against `velz-cmd/repodiet-e2e-test`: real files named
(`src/archive/OldDashboard.backup.tsx`, `left-pad` in `package.json`,
`next-env.d.ts`), not placeholder text.

However, the internal `Finding` type (`src/lib/findings/types.ts`) already
computes richer per-finding data — `reason`, `confidenceReason`,
`evidence.signals` — that the paid-facing `QuickTriageFinding` shape
(`src/lib/a2mcp/quick-triage-response.ts`) silently discarded, keeping only
`id/type/title/action/confidence/severity/files/evidenceSummary`. None of
the fields a paying buyer needs to act on a finding existed: no
explanation, no user impact, no recommended fix, no effort estimate, no
`safeForAutomaticCleanup`/`eligibleForA2AService37348` flags.

### Fix

Extended `toQuickTriageFinding()` to surface the real internal evidence
(`confidenceReason`, `evidence.signals`, `reason` as `explanation`) plus
deterministic, finding-type-keyed templates for `userImpact` and
`recommendedFix` that reference the actual files/package names from the
scan (no fabricated per-repo claims — the template is fixed per finding
type, the file/package data inside it is always real). Added a categorical
`estimatedEffort` (`trivial`/`small`/`moderate`) derived from file count and
risk bucket, and exposed `safeForAutomaticCleanup` /
`eligibleForA2AService37348` directly from the existing `action` bucket
rather than inventing a new signal. `finding.lines` wired through
(currently unpopulated upstream for the bounded scan path — not
fabricated).

PR #87, merged to `main` (`9e50f14`), deployed to production
(`dpl_7V2NCEmat6h3ECQ6JvQkBTQptg4g`, verified the `skillswap-virid-kappa.vercel.app`
alias resolved to that exact deployment before any paid test).

### Preflight verification (all free, before any payment)

- `npx tsc --noEmit` clean.
- 14 relevant test suites passing unmodified against the new schema:
  `quick-triage-response`, `quick-triage-route`, `quick-triage-bounded`,
  `quick-triage-coverage-truthfulness`, `a2mcp-sampling` (7 fixtures,
  authentic + spoofed sampling), `a2mcp-paid-path-fixture`,
  `a2mcp-real-production-e2e`, `a2mcp-quote-lifecycle`,
  `a2mcp-digest-layers`, `a2mcp-facilitator-diagnostics`,
  `okx-review-acceptance`, `okx-commerce`, `x402-payment-required-header`,
  `phase3-a2mcp`.
- Live unpaid `POST /api/a2mcp/quick-triage` against production returned a
  real HTTP 402 x402 challenge (quote, nonce, request/binding hashes,
  0.03 USD₮0, mainnet) — confirms the paid gate is enforced against the
  deployed fix and no payment fires without one.
- Idempotency, replay, and sampling behavior (§7.7) re-confirmed unchanged
  by this fix (all pre-existing suites above passed without modification).

### Controlled canary — real, on-chain, approved by user

User approved exactly: *"Approve one controlled 0.03 USD₮0 A2MCP payment
from User Agent 5295 to RepoDiet service 37347 for
velz-cmd/repodiet-e2e-test?"* — approved 2026-07-27.

Executed via `onchainos payment quote` (two-phase probe, persisted
`paymentId`) then `onchainos payment pay --payment-id ... --yes` (signs via
TEE from the currently selected wallet, which holds both Agent 5295 buyer
and Agent 9636 ASP identities on the same address — this is an intentional
self-owned canary, not a third-party charge).

- First `payment pay` attempt (params not re-supplied on the `pay` call)
  failed merchant-side with HTTP 400 (`Request body must be valid JSON`)
  and returned `txHash: null` — **no funds moved**; the CLI's two-phase
  replay does not automatically carry the `quote` step's `--param` values
  into the `pay` call, they must be passed again.
- Retry with `--param` re-supplied succeeded:
  - Transaction: `0xd39c51080c824401833e5735bd78818800a1d3cea1aa0d993e6fefd5a8431f60`
    (X Layer mainnet, `eip155:196`, exact scheme, EIP-3009)
  - Quote `quote_Bngf3ocuPVmC`, receipt `receipt_UL0GaFece-XP`,
    task `task_32e345e1e1eb4e`, scan `scan_w0IfnZiIQpZs`
  - Result: `status: "completed"`, 3 of 20 findings returned, each with
    real file paths, explanation, user impact, recommended fix, and
    `eligibleForA2AService37348` — evaluated against Phase 11's rejection
    criteria and passes (concrete evidence, no generic prose).

### Not yet done / explicitly deferred

No changes made to Agent 9636's marketplace listing status, no new
Agent/service/task created beyond the one approved canary payment. Command
3 not started — awaiting explicit approval per standing instruction.

## Command 1 (this pass) — availability, request routing, and OKX sampling (§7.7)

### Root cause of the timeout rejection

Two distinct causes, both now fixed:

1. The seller runtime (heartbeat + XMTP daemon) only ran inside an interactive
   Claude Code session — closing the session ended the runtime, so a reviewer
   probe arriving afterward received nothing. Fixed by the Windows Task
   Scheduler durable runtime (`scripts/windows/`), verified surviving process
   kill and session end (see below).
2. Conversational discovery/informational messages ("is RepoDiet online?",
   "what does X do?", capability/price questions) were rejected by
   `POST /api/a2a/tasks` with a generic HTTP 400 `INVALID_TASK_TYPE` instead
   of an informative answer. Fixed and extended this pass — see "Discovery
   and informational responses" below.

### CLI evidence (installed package, exact redacted output)

```
> where.exe okx-a2a
C:\Users\hp\AppData\Roaming\npm\okx-a2a
C:\Users\hp\AppData\Roaming\npm\okx-a2a.cmd
C:\Users\hp\AppData\Roaming\npm\okx-a2a.exe

> okx-a2a --version
0.1.10

> okx-a2a --help
okx-a2a 0.1.10
Commands: daemon, start, restart, stop, status, run, logs, user, session,
task, agent, file, ai, setup, doctor, update, config, ai-provider, runtime,
switch-runtime, job-provider, xmtp-send
```

Installed package: `@okxweb3/a2a-node` (bundled `dist/cli.js`, ~4MB).

### Request-path tracing (traced, not assumed)

| Event | Transport | Notes |
| --- | --- | --- |
| Discovery / informational message | HTTP `POST /api/a2a/tasks` | Same channel OKX's reviewer uses pre-listing. Classified deterministically by `isMarketplaceDiscoveryMessage` / `isInformationalQuery`. |
| A2MCP unpaid/paid request | HTTP `POST /api/a2mcp/quick-triage`, x402 facilitator (`web3.okx.com/api/v6/pay/x402/*`, HMAC-signed with `OKX_API_KEY`/`OKX_SECRET_KEY`/`OKX_PASSPHRASE`) | Facilitator responses normalized at `OkxX402Broker.request()` — the trusted boundary (see sampling below). |
| A2A task creation / negotiation / decision_request | XMTP, via `okx-a2a user watch --json` (inbound) and `okx-a2a xmtp-send` (outbound, no `--provider`, signed via `onchainos agent xmtp-sign --key-uuid <id>`) | Traced directly from installed source in the prior "autonomous responder" investigation (still valid). |
| OKX sampling call | Authenticated x402 facilitator settlement response (`SettleData.sampling`) | See below — never from caller input. |

Did not assume the reviewer prompt's transport — HTTP intake, x402, and XMTP
were each independently traced to source/installed CLI before being relied on.

### Discovery and informational responses (Phase 3)

Extended `INFORMATIONAL_PATTERNS` in `src/lib/a2a/marketplace-intake.ts` to
cover: "what services are available", "what services does RepoDiet offer",
"can RepoDiet inspect/analyze/scan my repository", "what information do you
need", "what is the price/cost/fee", "how much does it cost" — in addition to
the previously-covered "is RepoDiet online" / "what does X do" / "can it
create a PR". `buildInformationalResponse` and `buildMarketplaceIntakeResponse`
both identify Agent 9636, describe A2MCP 37347 (read-only diagnosis, 0.03
USD₮0) and A2A 37348 (negotiated cleanup, tested PR delivery, default 1
USD₮0), ask for repository URL and scope, and set
`paymentRequired:false` / `taskPolicy: {startWork:false, fundEscrow:false,
repositoryScan:false, createBranch:false, createPullRequest:false}`.

### Authenticated sampling (Phase 4) — OKX AI Agent Marketplace User Agreement §7.7

Authoritative source: OKX AI Agent Marketplace User Agreement §7.7 (dated
24 Jul 2026) — a Sampling Call returns a settlement response carrying an
OKX-defined `sampling: true` field and reports payment as unsettled.

Implementation, entirely at the trusted facilitator boundary
(`src/lib/payment/a2mcp-x402-production.ts`):

- `SettleData.sampling?: boolean` — typed field on the interface populated
  exclusively from `OkxX402Broker.request()`'s parsed, HMAC-authenticated
  response from `web3.okx.com`. Never derived from caller request bodies,
  query parameters, or headers — those have no code path into `SettleData`.
- `verifyAndSettleA2mcpPayment` checks `settled.sampling === true` immediately
  after `broker.settle()`, before the normal success/status/transaction
  assertions — an authenticated sampling response is never rejected for
  being unsettled. Returns a distinct `X402SamplingResult` (`{sampling:true,
  amount}`) — no `transaction`, no `paymentResponseHeader`.
- Durable idempotency: a new `"sampled"` state (alongside existing
  `"verifying"`/`"settled"`) in the same `payment_entitlements` record keyed
  by `authorizationKey()`. An identical replay returns the cached sampling
  result with no second facilitator call; a mismatched replay (same
  authorization, different request binding) is rejected.
- `commerce-gateway.ts`'s `gateA2mcpCall` detects the sampling result via
  `isX402SamplingResult()` and returns `samplingAuthenticated:true` instead of
  entering the paid entitlement gate (which requires a verified quote that a
  sampling call deliberately never has).
- `phase3-route.ts` skips `gateQuoteId` assignment for sampling — the bounded
  service still executes and returns a genuine result, but `markQuoteCompleted`,
  revenue recording, and execution-result caching are never reached.
- Internal-only telemetry: `FacilitatorDiagnostic.samplingDetected` (server
  logs only) and `logMarketplaceTelemetry("a2mcp_sampling_authenticated", ...)`
  — `sampling` is never included in the public HTTP response body.
- No public message anywhere claims OKX endorsement, certification, or
  sampling success.

Fixture tests (`test/a2mcp-sampling.test.ts`, all passing): authenticated
`sampling:true`, authenticated `sampling:false`, missing sampling field,
spoofed request-body `sampling:true` (proven inert — the function has no
input path for it), paid normal request not misclassified as sampling,
malformed settlement response, duplicate sampling request (cached replay vs.
rejected mismatch).

### Durable runtime hardening (Phase 5)

Production health (`GET /api/okx/health`) now also exposes, matching the
audit's exact field names: `agentId`, `lastHeartbeatAt`, `a2mcpReady`,
`a2aReady`, `taskWatcherOnline`, `xmtpConnected`, `reviewerRequestCount`,
`lastReviewerRequestAt`, `lastReviewerResponseAt`,
`lastReviewerResponseLatencyMs`, `samplingSupported`, `workerPid`,
`duplicateWorkerCount` (existing `agentOnline`, `heartbeatStatus`,
`degradedReasons` unchanged). `workerPid` / `duplicateWorkerCount` are
reported by the Windows runtime itself in each heartbeat POST (own PID, and
a persistent counter of lock-file duplicate-instance refusals) —
observability only, never trusted for identity. `reviewerRequestCount` /
`lastReviewerRequestAt` / `lastReviewerResponseAt` /
`lastReviewerResponseLatencyMs` are updated from real inbound
`POST /api/a2a/tasks` traffic.


## Pinned production identities

| Resource | Canonical value |
| --- | --- |
| ASP Agent | `9636` |
| A2A service | `37348` |
| A2A operation | `create_cleanup_pr` |
| A2MCP service | `37347` |
| A2MCP operation | `analyze_repository` |
| Seller wallet | `0xaa895234c3fc31c40018eef975db6ac79bf87f1a` |
| Registered communication address | `0x00dbdbb36b71ace0e1fc517056f376f977d8256e` |
| Production origin | `https://skillswap-virid-kappa.vercel.app` |
| Current deployment | `dpl_G5Ver5DJngELP9X8F3EiPTUmy9e6` (READY) |
| Current production SHA | `ad2be133f3013e28ad095eaf459440df6d10ff8d` |

Agent 9636 was registered on 2026-07-27 under the authenticated healthy account
(`officialsmokychain@gmail.com`, wallet `0xaa895234c3fc31c40018eef975db6ac79bf87f1a`) as a
replacement for Agent 5283, whose communication-key binding could not be repaired through any
official Onchain OS command. Registration tx:
`0x93aed3538eab509932ef1a537f6a5e5051586f41cb882ae71a96f6b141ea7abb` (SUCCESS, contract
`AgentIdentity`).

## Legacy record — Agent 5283 (INACTIVE, not a production identity)

| Resource | Legacy value |
| --- | --- |
| ASP Agent | `5283` (inactive) |
| A2A service | `32947` (inactive) |
| A2MCP service | `32948` (inactive) |
| Seller wallet | `0x1339724ada3adf04bb7a8ccc6498216214bbdf90` |
| Registered communication address | `0x185d96f1ccbae299263e789349028ef9569f9d22` |

Agent 5283 and services 32947/32948 are preserved, unmodified, and untouched by the Agent 9636
registration — they live under a different wallet (`0x1339…df90`, a different OKX account/email
entirely) that this deployment's authenticated session cannot access. **Confirmed even from that
wallet's own rightful owner session** (2026-07-27): `onchainos agent gate-check --role asp`
returns `"no asp agent found"` for that wallet too — the defect is not session-specific. Do not
delete, edit, close, resubmit, or reference Agent 5283 as an active production identity.

### Original blocking defect (Agent 5283)

The seller wallet session restored the expected seller wallet, but the supported CLI did not
expose Agent 5283 as the current seller ASP. Agent 5283's stored communication key could not sign
as its registered communication address. The current OKX identity update command does not allow
changing an Agent role, owner, or communication address, and no supported client-side key rotation
or communication-address rebind command exists. This defect is the reason Agent 9636 was
registered as a replacement rather than continuing to pursue a repair of Agent 5283.

## Prior timeout rejection

Agent 9636's first review submission was rejected: *"During platform testing, we were unable to
receive a response from your Agent, causing the task to time out and be stopped."* Root cause: the
seller communication runtime (heartbeat + XMTP daemon) was only ever running inside an interactive
Claude Code session on this machine — closing that session ended the runtime, so any reviewer probe
arriving afterward received no response.

## Durable runtime fix

Replaced the session-bound runtime with `scripts/windows/` — a Windows Task Scheduler-managed
runtime for Agent 9636 that survives the Claude Code session ending entirely:

- `okx-seller-runtime.ps1` — validates OKX identity (email, agentId 9636, communication signer)
  every tick before sending a heartbeat; keeps the `okx-a2a` XMTP daemon alive, reconnecting via
  `doctor --fix` when needed; sends the authenticated seller heartbeat every 60s. Never logs or
  prints the heartbeat secret (DPAPI-encrypted at rest, current Windows user only).
- `register-task-elevated.ps1` — registers two triggers: `AtLogOn` (normal start) plus a 1-minute
  watchdog (`-Once` with `RepetitionInterval`/`RepetitionDuration` of `P3650D`/`PT1M` — a bounded,
  valid duration; `[TimeSpan]::MaxValue` was tried first and rejected by Task Scheduler with
  HRESULT 0x80041318, an out-of-range `P99999999DT23H59M59S`). `MultipleInstances=IgnoreNew` plus
  an app-level PID lock file prevent duplicate instances. Fail-closed: backs up the previous task
  definition before replacing it, restores on failure, verifies the task exists post-registration
  independently of whether `Register-ScheduledTask` threw, never prints success on failure, exits
  non-zero on error.
- `install-scheduled-task.ps1` / `status-scheduled-task.ps1` / `restart-scheduled-task.ps1` /
  `uninstall-scheduled-task.ps1` — supporting install, read-only status, manual restart, and clean
  removal.

**Verified 2026-07-27** (no machine reboot; restart behavior simulated via `Stop-Process` /
`Stop-ScheduledTask` / `Start-ScheduledTask`):

- Worker process alive, identity validated (`agentId=9636`, wallet.ok, communication.ok) every
  tick.
- XMTP daemon confirmed connected (`activeClients=2`) every tick.
- Heartbeat accepted every tick (`agentOnline=true`, `heartbeatStatus=fresh`).
- Force-killed the worker process directly (`Stop-Process -Force`) at 04:06:55; the 1-minute
  watchdog trigger restarted it at 04:07:40 — **45 seconds**, no manual intervention.
- Exactly one runtime PID alive at any time after recovery — no duplicate instances.
- Production confirmed `a2aRuntimeReady:true`, `degradedReasons:[]`, `agentOnline:true`,
  `heartbeatStatus:"fresh"`, `registeredCommunicationAddress == recoveredSignerAddress` throughout.

Known limitation, stated plainly: this runtime provides infrastructure-level continuity only
(heartbeat, identity validation, XMTP daemon liveness). It does not autonomously answer inbound A2A
`decision_request` / `notification` items — those still require an interactive AI session per the
`okx-ai` watch-core protocol. Messages queue as unread todos and drain on the next watch session;
nothing is lost while this runtime is the only thing running.

**Update (2026-07-27, later same day): this was re-investigated at the source-code level and the
statement above was too pessimistic.** RepoDiet's own code CAN answer inbound A2A messages
deterministically, with no AI provider in the loop, for safe pre-work message categories — see
"Autonomous responder — corrected finding" below. The earlier conclusion conflated "the mechanism
that *generates* a reply" (which is AI-oriented) with "the mechanism that *transmits* a reply"
(which is not).

## Autonomous responder — corrected finding (2026-07-27)

The initial investigation (documented above, first pass) concluded a headless responder was
impossible because `onchainos agent next-action` returns an LLM playbook and `okx-a2a ai exec` is
the only documented auto-reply mechanism. That reasoning stopped one layer too shallow. Direct
inspection of the installed `@okxweb3/a2a-node` package (`dist/cli.js`, ~4MB bundled source) shows:

- **Inbound**: `okx-a2a user watch --json` — a long-poll CLI call, JSON in/out, no AI provider
  involved. It surfaces items across all agents under the account, keyed by `sessionKey` (e.g.
  `my:9636:to:<peer>` identifies Agent 9636 as the seller side of an exchange). A plain script can
  classify `item.userContent` deterministically without an LLM.
- **Outbound**: `okx-a2a xmtp-send --job-id <id> --to-agent-id <id> --message <text> --json` — its
  own top-level description is *"Queue an XMTP message through the running daemon"* (source line
  101055). It takes **no `--provider` parameter**. The daemon signs the message via
  `onchainos agent xmtp-sign --key-uuid <keyUuid>` (source line 88095: `` `[onchainos-signer]
  executing: onchainos agent xmtp-sign --key-uuid ${keyUuid} --message <...>` ``) — the agent's own
  wallet-derived key, then transmits via the real XMTP SDK's `#conversation.send()` (source lines
  69932 / 85275-85287). No AI provider anywhere in this path.
- `okx-a2a session send` (a different command) explicitly describes itself as *"Queue a **local AI
  session** message dispatch"* (source line 96849) — an internal relay into a locally-attached AI
  process's input, not the genuine outbound wire transport. It was deliberately **not** used.
- `okx-a2a ai exec` / `ai resume` are the only commands in the entire bundle that accept
  `--provider codex|claude|hermes`, and tracing their implementation confirms they spawn (or manage
  login/install for) an actual Claude Code or Codex CLI process (source lines ~98505-98555 install
  `@anthropic-ai/claude-code` / manage `codex auth login`). This is a genuinely separate, optional
  layer for *generating* response text — not required for transport.

**Answering the four framing questions directly:**

| | Answer |
|---|---|
| A. Does the official watcher expose inbound events RepoDiet can parse directly? | **Yes** — `okx-a2a user watch --json`. |
| B. Can RepoDiet invoke the official send workflow programmatically without `ai exec`? | **Yes** — `okx-a2a xmtp-send`, no `--provider` flag exists on it. |
| C. Is `ai exec` only an optional convenience wrapper? | **Yes**, confirmed by source. |
| D. Does the tooling require a named CLI provider to send any response? | **No** — signing goes through `onchainos agent xmtp-sign` (wallet key), not an AI provider. |

**Implementation**: `scripts/okx-runtime/repodiet-a2a-responder.ts` — watches via `okx-a2a user
watch --json`, classifies inbound `decision_request` items using the same deterministic patterns
already proven in the HTTP path (`isMarketplaceDiscoveryMessage` / `isInformationalQuery` from
`src/lib/a2a/marketplace-intake.ts`), and for safe pre-work categories (availability, capability,
price, repository/scope requests) claims the todo and replies via `okx-a2a xmtp-send` with a fixed
template — never via `ai exec`, `session send`, or any AI provider. Anything that doesn't match a
known safe pattern, or isn't a seller-side (`my:9636:to:*`) exchange, is left unclaimed and pending
for interactive review — payment, escrow, delivery-acceptance, arbitration, and registration actions
are never auto-approved. `npm run typecheck` / `lint` / `build` all pass with this script added.

**Live proof — blocked, honestly reported, not worked around.** Generating a genuine inbound event
to prove the full watch→classify→reply→record loop requires an active job. Attempting to create one
(same pattern as the two earlier controlled test jobs) now fails consistently with a **new** error:
`"Wallet API error (code=1001): designated provider does not offer serviceId: 37348"` — different
from, and more restrictive than, anything seen earlier today (the same command succeeded twice
earlier in this session). `asp-match --provider-agent-id 9636` still never surfaces the A2A service
either, unchanged. The most likely explanation is that Agent 9636's active review process has
locked new task designations against it while under review — a platform-side state change, not a
bug in this responder or in RepoDiet's own code. No task was force-created past this rejection, and
no attempt was made to route around it. The responder is implemented, typechecked, and its
transport mechanism is proven correct at the source level, but end-to-end live behavior (items 5-7
of the requested test plan: genuine watch-detects-event, kill/watchdog-recovery-with-live-traffic,
exactly-one-active-watcher-under-real-load) remains unverified pending either the review concluding
or OKX clarifying whether designation is expected to work mid-review.

## Autonomous responder investigation — first pass (2026-07-27, superseded above)

Investigated whether a headless (no interactive AI session) worker could answer inbound A2A
messages using only the officially documented `onchainos` / `okx-a2a` tooling, without creating any
new task (a hard constraint for this investigation):

1. **`okx-a2a session send` / `xmtp-send`** both require `--job-id` (or a `--session-key` derived
   from one). There is no standalone command to message an agent, or to watch for messages,
   outside an existing on-chain task/job context. `okx-a2a task requests` (read-only) confirms
   real pending inbound conversations exist on other jobs, but those belong to other counterparties
   and were not used as a test harness.
2. **`onchainos agent next-action`** — the mechanism `src/lib/okx-runtime/provider-worker.ts`
   already calls for ASP-side system events — returns a natural-language *playbook* for an LLM to
   interpret and act on (confirmed directly from its own `--help` text and from the `okx-ai`
   watch-core protocol, which is explicit that item dispatch is "purely mechanical" for an LLM to
   execute, not something the CLI executes itself).
3. **`okx-a2a ai exec`** — the only documented mechanism for generating an automated reply —
   requires `--provider <codex|claude|hermes>`: it spawns an AI CLI session to produce the
   response. There is no deterministic, AI-free code path in the officially supported tooling for
   answering an inbound A2A message.

**Conclusion**: the officially documented OKX tooling has no mechanism for a headless process to
answer an inbound A2A message without invoking an AI provider — whether that is an interactive
Claude Code / Codex session or `okx-a2a ai exec` spawning one non-interactively. This is reported
as an **external blocker**, not a defect in RepoDiet's own code. An OKX support question has been
prepared asking how ASPs are expected to remain responsive to inbound task/negotiation messages
without an interactive AI session in the loop. Agent 9636's listing remains under review
(`approvalRemark: "AI quality review suggested pass"` as of 2026-07-27) — this finding does not
change that status; no reactivation or resubmission was performed.

**Practical mitigation already in place**: RepoDiet's own HTTP-level `/api/a2a/tasks` intake (the
same endpoint OKX's own reviewer probes pre-listing) already answers discovery and informational
queries deterministically and instantly — see "Official Agent-channel response testing" above and
the `isInformationalQuery` fix. The gap is specifically in the genuine XMTP/task-watch channel for
messages arriving *after* a task exists, which requires the AI-in-the-loop mechanism described
above.

## Operator receipt key reconciliation

`GET /api/okx/trust-root` previously reported `fingerprintMatchesPinned: false` — the deployed
`REPODIET_OPERATOR_PUBLIC_KEY` did not match the repo-pinned constant. Added a
`privateKeyDerivedFingerprint` diagnostic field (fingerprint only, never key material) to determine
which side was authoritative: the fingerprint derived from the deployed
`REPODIET_OPERATOR_PRIVATE_KEY` matched the deployed public key exactly
(`sha256:2d063df71db431383aa19212e5ef4d744b64881b9dadf59cf10400d9c14faac4`) — production's key pair
was self-consistent. The repo-pinned constant (`sha256:d495f62bd74d136390322df4a042db4250cd27c594992b55f321201a16aba662`)
was the stale side and has been corrected to match. No key rotation was performed. All three
fingerprints (private-derived, deployed public, repo-pinned) now agree.

## Platform routing conclusion — mixed-service indexing gap (Conclusion B)

Two controlled A2A test jobs were created against Agent 9636, both closed, both unfunded, no
funds moved in either case:

| | Job 1 | Job 2 |
| --- | --- | --- |
| jobId | `0xb01ab2de2f34ace5c8cc84b20eba06c63560a6e2fc2f75e9775aa5ee1e1aa398` | `0x344e63aa6e00da8ad145d972cfce7e906f45e4ef6ea36ebe861959ede27a18c2` |
| Offered price | 0.2 USDT (below registered fee) | 1 USDT (exact registered fee) |
| Designated service | A2A `37348` (`--service-id 37348`, validated and accepted by the CLI) | A2A `37348` (same) |
| Observed | Declined (underpriced) → backend "backup" connection probe → `GET /api/a2mcp/quick-triage` → HTTP 405 | ASP applied on-chain → backend "backup" connection probe → same `GET` → HTTP 405 |
| Final status | `close`, funds returned | `close`, funds returned |

**Conclusion**: service `37348` (A2A) was explicitly and correctly selected in both task-creation
commands — proven because the CLI validates `--service-id` against the provider's actual
registered services and rejects mismatches outright (confirmed separately with a deliberately wrong
ID). OKX's own backend connection-probe layer, when establishing contact with a designated ASP,
selected endpoint service `37347` (A2MCP) regardless — because `onchainos agent asp-match
--provider-agent-id 9636` has never once surfaced Agent 9636's A2A service in its `recommendations`,
at any price or task description, only ever the A2MCP one. This appears tied to marketplace listing
approval status, not a client-side command defect. `GET /api/a2mcp/quick-triage` correctly returns
405 (that endpoint is intentionally POST-only for x402 quotes) — **this was not changed**; turning
GET/HEAD into a paid x402 call would incorrectly convert an A2A connection attempt into an A2MCP
payment flow.

## Official Agent-channel response testing

Five test messages sent through the official inbound A2A channel (`POST /api/a2a/tasks` — the
`submitTask` endpoint published in the Agent Card; this is the same channel OKX's own reviewer
uses for pre-listing discovery/status probes, since a genuine on-chain buyer task for A2A `37348`
is not currently creatable per the routing gap above). All five identify Agent 9636, name both
services with their correct roles, demand no payment, and start no scan/branch/PR/escrow.

| # | Message | HTTP | Latency (ms) | requestId |
| --- | --- | --- | --- | --- |
| 1 | "I would like to use the services of agent ID 9636" | 200 | 2587 | `req_tJuDu_UIjSgs` |
| 2 | "I would like to create a repository cleanup task using the services of agent ID 9636" | 200 | 571 | `req_4m7T8DRfVIAP` |
| 3 | "Is RepoDiet online?" | 200 | 571 | `req_LVzxDRBz1Abh` |
| 4 | "What does RepoDiet Quick Triage do?" | 200 | 582 | `req_S-iTstBz9aE7` |
| 5 | "Can RepoDiet create a cleanup pull request?" | 200 | 590 | `req_SMLoZ47PPIqO` |

Messages 3–5 previously returned a generic HTTP 400 `INVALID_TASK_TYPE` — found during this testing
pass and fixed (`isInformationalQuery` / `buildInformationalResponse` in
`src/lib/a2a/marketplace-intake.ts`) so conversational status/capability questions get an
informative answer identifying Agent 9636, explaining A2MCP `37347` as read-only diagnosis and A2A
`37348` as tested PR delivery, instead of an error.

## Confirmed production behavior

- The public Agent Card exposes the pinned Agent and service IDs.
- An unpaid `POST /api/a2mcp/quick-triage` returns HTTP 402, `PAYMENT-REQUIRED` header, x402Version
  2, service `37347`/`analyze_repository`, network `eip155:196`, asset
  `0x779ded0c9e1022225f8e0630b35a9b54be713736`, amount `30000`, `payTo`
  `0xaa895234c3fc31c40018eef975db6ac79bf87f1a`, exact POST resource binding.
- `GET`/`HEAD` against the same endpoint remain unchanged (still 405) — not converted to a paid
  x402 path.
- HTTP A2A discovery and informational-query intake both acknowledge without starting a scan,
  payment, branch, or pull request.

## Health contract

RepoDiet fails closed. Public HTTP traffic and A2MCP 402 responses cannot mark the official seller
Agent online — only the authenticated heartbeat (now sent by the durable Task Scheduler runtime,
not an interactive session) can.

`agentOnline`, `onchainOsAuthenticated`, and A2A runtime readiness require a short-lived
authenticated heartbeat bound to:

- Agent `9636`
- A2A service `37348`
- the seller wallet
- the registered communication address
- the recovered communication signer
- an active official task watch
- a ready XMTP client

Confirmed live: `a2aRuntimeReady:true`, `degradedReasons:[]`, `agentOnline:true`,
`heartbeatStatus:"fresh"`, signer match.

## Remaining acceptance gates

1. ~~Start the isolated persistent seller runtime for Agent 9636 and its authenticated heartbeat.~~ Done — durable Task Scheduler runtime, verified surviving process kill and Claude Code session end.
2. ~~Prove an official no-funding A2A availability response under 10 seconds.~~ Done — 5/5 official-channel messages, all under 3s, none started a scan/branch/PR/escrow.
3. ~~Prove an unpaid A2MCP request returns a correctly bound x402 402 challenge for service 37347.~~ Done.
4. Complete one controlled 1 USD₮0 A2A escrow, delivery, acceptance, and release using
   `velz-cmd/repodiet-e2e-test` — blocked until the mixed-service indexing gap (Conclusion B) is
   resolved on OKX's side; both attempts so far closed unfunded rather than proceeding on a
   misrouted connection.
5. Complete one fresh 0.03 USD₮0 A2MCP canary and prove identical replay causes no second
   settlement or scan.
6. Resubmit ASP 9636 with this evidence attached.
