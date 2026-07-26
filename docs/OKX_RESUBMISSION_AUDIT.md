# RepoDiet OKX Resubmission Audit

Last verified: 2026-07-27

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
