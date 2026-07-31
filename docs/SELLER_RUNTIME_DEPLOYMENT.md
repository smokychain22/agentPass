# RepoDiet seller runtime — deployment runbook

Always-online production runtime for **Agent 9636**, provider-neutral.

## Why this exists

The seller runtime previously ran only on a Windows workstation. The
heartbeat carries a 90-second TTL, so within 90 seconds of that machine
sleeping, disconnecting, or shutting down, Agent 9636 stops answering A2A
traffic: the official watcher stops, XMTP drops, tasks cannot be
acknowledged, and PR delivery cannot complete. The public website stays up
because it is separate — which is precisely what makes the failure easy to
miss.

`scripts/okx-runtime-manager.ts` remains the developer-workstation launcher.
It spawns detached children and exits, which cannot be a container
entrypoint. `scripts/repodiet-seller-runtime.ts` is the production
foreground process.

## What it guarantees

- Verifies canonical identity before claiming anything, and exits non-zero
  on mismatch.
- Refuses to start a second instance against the same data root.
- Recovers automatically from a stale lock left by an unclean shutdown.
- Publishes a heartbeat **only** when the official `gate-check` and the XMTP
  client both genuinely pass — process liveness alone never counts.
- Handles SIGTERM/SIGINT, releasing its lock so a replacement starts at once.
- Never logs secrets, tokens, or key material.

## Requirements

| Item | Requirement |
|---|---|
| Compute | Any always-on Linux host that can run Docker |
| Persistence | One volume mounted at `/persistent`, holding both runtime state (`/persistent/data`) and CLI credential home (`/persistent/home`) |
| Network | Outbound HTTPS + XMTP. **No inbound ports** — it is a client, not a server |
| Restart | `unless-stopped`, so it survives container crash and host reboot |

The runtime is not a web server. Do not publish a port.

### Railway (prior deployment target)

Agent 9636's seller runtime was previously deployed on Railway: project
`agile-patience`, service `repodiet-production-worker`, deploying `main` via
`Dockerfile.seller` (`RAILWAY_DOCKERFILE_PATH=Dockerfile.seller`), with a
Railway Volume mounted at `/persistent`. Railway rejects a Docker `VOLUME`
instruction at Dockerfile parse time, so persistence is attached by the
platform rather than declared in the image — see `scripts/seller-entrypoint.sh`,
which `chown`s the volume to the runtime user after Railway mounts it, since a
build-time `chown` at that path is masked by the later mount. The same
entrypoint behavior is reused unchanged on both deployment targets below.

### Fly.io (current deployment target)

`fly.toml` at the repo root targets the Fly app `repodiet-agent-9636`
(organisation `personal`), region `sin`, with one persistent volume
`vol_4qld9gg6y2x567wr` (name `repodiet_persistent`) mounted at
`/persistent`. The Fly account behind this app is on a **limited free
trial**; do not treat it as a claim of permanent 24/7 hosting — see
"Permanent Linux VM deployment" below for the long-term host. The container
image is identical on Fly and everywhere else: `Dockerfile.seller`,
unchanged.

Seven secrets are already staged in Fly
(`REPODIET_OKX_RUNTIME_HEARTBEAT_SECRET`, `OPENCLAW_GATEWAY_TOKEN`,
`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_BASE64`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_WEBHOOK_SECRET`) — this PR does not
read, print, or run `fly secrets deploy` against them.

**Operator commands after this PR is merged** (none of these are run by
this PR — see "Recovering the existing Fly volume" below for the full
sequence, which supersedes the bare commands here):

```bash
fly deploy --app repodiet-agent-9636 --remote-only
fly machine list --app repodiet-agent-9636   # confirm exactly one Machine
fly machine update <machine-id> --app repodiet-agent-9636 --autostop=off --autostart=true
```

`--autostop=off` is a Machines-API-level flag (not a `fly.toml` block) as of
current `flyctl` — confirm the exact flag name with `fly machine update
--help` before running it, since this repo does not execute it.

#### Recovering the existing Fly volume after this PR merges

The volume already holds state from the earlier crash-looping deploy
(Incident #2, above), including whatever `/persistent/home` OnchainOS
wallet/credential state, `/persistent/data`, and task/runtime state existed
before the operator manually stopped Machine `7845320c476008`. **This PR
does not touch that volume, does not start that Machine, and does not
create a new volume or Machine.** The volume and its existing data must be
**preserved**, not recreated — recreating it would discard the OnchainOS
wallet login, requiring the one-time interactive `onchainos wallet login`
to be repeated.

The new bootstrap (`src/lib/okx-runtime/openclaw-bootstrap.ts`) is designed
specifically to make it safe to redeploy onto this existing, possibly
-corrupted volume without an operator manually touching it first:

1. On the next boot, the supervisor validates the persisted
   `/persistent/home/.openclaw/openclaw.json` before writing anything.
2. If that file is missing, empty, truncated, or invalid (the state a
   concurrent-write conflict would leave it in), it is renamed to
   `openclaw.json.corrupt-<ISO-timestamp>` — never deleted — and a fresh
   file is rebuilt from the pinned config-set sequence.
3. Nothing else under `/persistent` is touched by this recovery: OnchainOS
   wallet/credential files (elsewhere under `/persistent/home`),
   `/persistent/data`, and any task/runtime state survive unchanged. Only
   the single `openclaw.json` file is ever renamed.

So the recommended sequence is simply:

```bash
fly deploy --app repodiet-agent-9636 --remote-only
fly machine list --app repodiet-agent-9636   # confirm exactly one Machine (7845320c476008)
fly logs --app repodiet-agent-9636           # watch for bootstrap_* / gateway_auth_ready / plugin_verified events
```

If, after reviewing the logs, `/persistent/home/.openclaw/openclaw.json`
was quarantined and an operator wants to inspect the damaged file before it
is cleaned up manually:

```bash
fly ssh console --app repodiet-agent-9636 -C "ls -la /persistent/home/.openclaw/"
```

**Do not** run any `openclaw config set` or `okx-a2a` command by hand
against the live volume while the container is also running — that
concurrent-write race is exactly what caused Incident #2. If manual
inspection is genuinely needed, stop the Machine first
(`fly machine stop <machine-id> --app repodiet-agent-9636`), inspect
read-only, and restart it (`fly machine start <machine-id> --app
repodiet-agent-9636`) rather than issuing writes against a live container.

#### Measuring actual memory before finalizing the 512 MB candidate

`fly.toml`'s `memory = "512mb"` is an initial candidate, not a measured
value. After the first real deploy:

```bash
fly ssh console --app repodiet-agent-9636 -C "cat /sys/fs/cgroup/memory.current"
# or, from outside the machine:
fly machine status <machine-id> --app repodiet-agent-9636
```

Let the runtime run for at least one full `okx-a2a doctor --fix` cycle plus
several heartbeat intervals (the highest-memory moment is Gateway startup +
plugin install), then compare observed peak RSS against 512 MB with
headroom (aim for peak usage under ~70% of the configured limit) before
either lowering the candidate or raising it in `fly.toml`.

### Permanent Linux VM deployment (host-neutral, long-term)

See `deploy/README.md` for the full runbook. Summary: the same
`Dockerfile.seller` image, run via `docker-compose.production.yml` (now the
host-neutral compose file, not Fly/Railway-specific) on any persistent
Linux VM, with `/persistent` as a named Docker volume
(`repodiet_persistent` — same name as the Fly volume, so the in-container
path contract is identical). `deploy/repodiet-seller.service` is an
optional **host-level** systemd unit (not inside the container — the
container's own PID 1 stays `tini`) that runs `docker compose up -d` at
boot, on top of Docker's own `restart: unless-stopped` container-level
recovery. Tested on x86_64 only; arm64 is not claimed since the pinned
`onchainos`/`okx-a2a`/`openclaw` binaries are not verified there.

## Secrets

Copy `.env.seller.example` to `.env.seller` on the host and fill it in
there. Never commit it. Required to start:

- `REPODIET_OKX_RUNTIME_HEARTBEAT_SECRET` (min 32 chars)

The runtime **fails closed** without it rather than starting and reporting
itself online.

## OnchainOS and provider binding

`onchainos` is not distributed on the npm registry; the image installs it
from the official `okx/onchainos-skills` GitHub releases, pinned to an
immutable tag and verified against the published SHA-256 checksum before the
build is allowed to succeed (see the `ONCHAINOS_RELEASE_TAG` /
`ONCHAINOS_LINUX_SHA256` build args in `Dockerfile.seller`). The build fails
closed — no `|| true` fallback — if the download or the checksum is wrong.

`@okxweb3/a2a-node` (the `okx-a2a` CLI) exposes exactly four providers —
`codex`, `claude`, `hermes`, `openclaw` — with no generic
process/webhook/MCP/HTTP-callback adapter. `codex` and `claude` are
development tools and are rejected at startup (`identity_rejected`,
`unsupported_a2a_provider`/`codex_and_claude_are_development_tools_only_...`)
so a misconfigured deployment can never claim they are the production
responder. The default and documented host-agnostic path is `openclaw`
(override with `REPODIET_OKX_A2A_PROVIDER=hermes` if needed).

**`okx-a2a setup openclaw` does not bootstrap OpenClaw itself.** Verified by
direct reproduction: it shells out to `openclaw plugins install
@okxweb3/a2a-openclaw ...` against an *already-installed* `openclaw` CLI, and
fails immediately with `spawn openclaw ENOENT` if `openclaw` isn't on PATH.
So the image installs and pins the `openclaw` CLI itself (`OPENCLAW_VERSION`
build arg in `Dockerfile.seller`, verified with `openclaw --version` at build
time).

`scripts/repodiet-seller-runtime.ts` runs `okx-a2a doctor --fix --json`
(`communication_ready`) and `okx-a2a daemon status` / `daemon start`
(`a2a_daemon_ready`) once at startup, before the heartbeat loop begins. Each
heartbeat tick re-checks daemon liveness and restarts it via the official
`daemon start` command if it died — a bounded-backoff restart tied to the
heartbeat interval, not a custom process supervisor. It does **not** perform
provider selection or OpenClaw plugin configuration itself — see Incident #2
below for why, and "Bootstrap ownership" for the current split.

**Fixed — the OpenClaw Gateway process is now supervised.**
`scripts/seller-runtime-supervisor.ts` is the container's actual PID under
tini/gosu. Verified by direct reproduction in a real built container:
`okx-a2a setup openclaw`'s automatic post-install gateway restart uses
`systemctl --user` (or launchd/schtasks), which does not exist under this
container's `tini` PID 1 — it silently logged "Gateway service disabled"
and left the actual OpenClaw Gateway (the WebSocket/HTTP server other
processes authenticate against) not running, which produced the reproduced
failure: the okx-a2a OpenClaw plugin connected with `tokenConfigured:false`
and failed with `AUTH_TOKEN_MISSING`.

The supervisor writes `gateway.mode=local`, `gateway.auth.mode=token`,
`gateway.auth.token` (bound to the `OPENCLAW_GATEWAY_TOKEN` SecretRef),
`session.dmScope=per-channel-peer`, `plugins.load.paths` (both plugin
directories baked into the image at build time), conversation-hook access
for both plugins, and `plugins.allow: ["okx-a2a", "repodiet-a2a-bridge"]`
into OpenClaw's own config via `openclaw config set` (schema verified
directly against the installed `openclaw@2026.7.1-2` CLI docs and
TypeScript declarations, and against okx-a2a's own internal
`ensureOpenClawOkxA2aPluginConfig()` — not guessed); selects the AI
provider (`okx-a2a ai-provider set`); starts `openclaw gateway run` itself
as a managed foreground child; and polls `openclaw gateway health` then
`openclaw gateway status --require-rpc` until the Gateway is live **and**
authenticated before starting `repodiet-seller-runtime.ts` (which still
owns `doctor --fix`/`daemon`, unchanged — see "Bootstrap ownership"). It
also mirrors the shared token into `OKX_A2A_OPENCLAW_GATEWAY_TOKEN` — a
second, separately-read env var name confirmed directly in the installed
`@okxweb3/a2a-node@0.1.10` bundle, which the daemon/CLI's own gateway
client reads independently of the plugin's config. See the module docblock
in `scripts/seller-runtime-supervisor.ts` for the full, source-verified
citation trail, and `test/seller-runtime-supervisor.test.ts` for the
regression coverage (startup ordering, signal forwarding, fail-closed
paths, secret hygiene).

### Incident #2: boot-time network dependency and config corruption

A live deploy on Fly entered an unbounded restart loop and was manually
stopped by the operator to avoid burning trial runtime. Root cause,
confirmed by direct reproduction both locally and by reading the real
`@okxweb3/a2a-node@0.1.10` bundle (not guessed):

1. The supervisor previously called `okx-a2a setup openclaw --release latest
   --json` once at every boot to register the OpenClaw gateway plugin.
   `--release latest` re-resolves "latest" fresh on **every** boot — when a
   newer `@okxweb3/a2a-node` release appeared on npm after this image
   pinned `0.1.10`, that command silently attempted
   `npm install -g @okxweb3/a2a-node@latest` **inside the running
   container**, which hung well past any reasonable boot timeout on both a
   bandwidth-constrained sandbox and live Fly infrastructure.
2. Independently, that same command's internal `updateOpenClaw()` always
   ran `openclaw plugins install <spec> --force` — an unconditional network
   fetch — whenever the OpenClaw-side plugin was not yet installed, which is
   true on every fresh `/persistent` volume.
3. A concurrent live diagnostic (`fly ssh console ... okx-a2a setup
   openclaw ...`, run by an operator investigating the failure) raced the
   supervisor's own in-progress `openclaw config set` calls against the
   *same* persisted `openclaw.json` on the mounted volume. The resulting
   write conflict left that file in a state where **every subsequent
   restart** — including fully unattended ones with no further
   interference — failed at the very first `config set` call. Because every
   restart just replayed the same writes against the same broken file, this
   had no self-healing path.

**The fix, in full:**

- `@okxweb3/a2a-openclaw` (the gateway plugin) is now pinned, checksum
  -verified (`npm view @okxweb3/a2a-openclaw@0.1.10 dist.integrity`, cross
  -checked at build time), and extracted into the image at **build** time
  (`Dockerfile.seller`), exactly like `openclaw-plugins/repodiet-a2a-bridge`,
  and loaded at boot via `plugins.load.paths` — never installed over the
  network at boot. No `--release` flag of any kind appears in any command
  either script runs at runtime (`test/seller-runtime-portability.test.ts`
  and `test/seller-runtime-supervisor.test.ts` assert this by scanning the
  actual source).
- The broad `okx-a2a setup openclaw --release latest` command is never
  called at runtime. In its place, the supervisor performs the exact same
  config normalization that command's own `ensureOpenClawOkxA2aPluginConfig()`
  performs internally (`session.dmScope`, `plugins.allow`,
  `plugins.entries.okx-a2a.hooks.allowConversationAccess`) via plain
  `openclaw config set` — a pure local operation with no network call.
- AI provider selection now uses the CLI's own minimal, documented, local
  command — `okx-a2a ai-provider set --provider <provider> --json` (a PATH
  check plus a write to a local SQLite session store, no network) — instead
  of the broad `setup` command.
- **Build-time vs boot-time responsibility split:** anything that resolves a
  version, fetches a package, or touches the npm/GitHub-releases network
  happens exactly once, at image build time, with the result baked in and
  checksum-verified (`onchainos`, `okx-a2a`, `openclaw`,
  `@okxweb3/a2a-openclaw` — all four in `Dockerfile.seller`). Boot time only
  ever performs local, idempotent operations against files already on disk
  or the mounted volume: config reads/writes, plugin loading from a fixed
  image path, and CLI calls that are documented as local-only.
- **Single bootstrap owner:** `scripts/seller-runtime-supervisor.ts` is now
  the sole owner of OpenClaw config bootstrap and okx-a2a provider
  selection. `scripts/repodiet-seller-runtime.ts` no longer calls `okx-a2a
  setup` or `okx-a2a ai-provider set` at all — it starts only after the
  supervisor has proven the Gateway is live, authenticated, and both
  plugins are genuinely active, and it keeps its narrower, pre-existing
  responsibilities (`doctor --fix`, `daemon start`/`status`). Two
  independent boot-time writers racing the same persisted config file is
  exactly what produced the corruption above — there must be exactly one.
- **Safe config recovery** (`src/lib/okx-runtime/openclaw-bootstrap.ts`):
  - An exclusive, PID-based bootstrap lock
    (`$HOME/.openclaw/repodiet-bootstrap.lock`) means only one process ever
    writes `openclaw.json` at a time. A lock held by a still-live process is
    respected; a lock left behind by a process that is no longer alive (or
    older than 5 minutes) is reclaimed automatically.
  - The persisted config is validated (parses as JSON, is a plain object)
    both before bootstrap runs and after it writes. A missing, empty,
    truncated, or malformed file is never repaired in place — it is
    **renamed**, never deleted, to
    `openclaw.json.corrupt-<ISO-timestamp>` beside itself, and a fresh file
    is rebuilt from the same pinned config-set sequence. Nothing outside
    that single file is ever touched: OnchainOS wallet credentials, other
    auth state, and the rest of `/persistent` are untouched by design and
    covered by regression tests (`test/openclaw-bootstrap.test.ts`).
  - A version-aware bootstrap marker
    (`$HOME/.openclaw/repodiet-bootstrap-marker.json`, non-secret: pinned
    component versions, the plugin id set, and a hash of the exact
    config-set operation list) means a healthy, unchanged restart **skips**
    the config-set sequence entirely — pure validation instead. Bootstrap
    only reruns when a pinned version changes, the marker is missing or
    stale, the config fails validation, or plugin-activation verification
    fails.
- **Redacted, categorized failure diagnostics**
  (`src/lib/okx-runtime/command-diagnostics.ts`): every supervised command
  failure now logs a command name, exit code, timeout flag, a
  classification (`timeout` / `network_attempt` / `invalid_config` /
  `plugin_missing` / `plugin_registration_failure` / `permission_failure` /
  `gateway_authentication_failure` / `unknown`), a sanitized stderr tail,
  duration, and retry decision — instead of a bare `ok: false`. Redaction
  covers `OPENCLAW_GATEWAY_TOKEN`, `FLY_API_TOKEN`, PEM private key blocks,
  and `Bearer <token>` headers, on top of the existing generic secret
  patterns in `src/lib/okx-runtime/process-runner.ts`.
- **Bounded restart policy during validation.** `fly.toml`'s `[[restart]]`
  policy is temporarily `on-failure` with `retries = 3` (was `always`) so a
  regression cannot silently burn trial runtime in an unbounded loop again
  while the new bootstrap proves itself. This is a config-only change in
  this PR — it is not deployed by this PR. Revert to `policy = "always"`
  once the new bootstrap has run stably in production for a reasonable
  period.

### Bootstrap ownership

| Responsibility | Owner |
|---|---|
| OpenClaw config (gateway, session, plugin registration/hooks) | `seller-runtime-supervisor.ts` only |
| okx-a2a AI provider selection | `seller-runtime-supervisor.ts` only |
| OpenClaw Gateway process | `seller-runtime-supervisor.ts` only |
| Bootstrap lock, config validation/quarantine, bootstrap marker | `seller-runtime-supervisor.ts` only |
| `okx-a2a doctor --fix` (readiness/repair) | `repodiet-seller-runtime.ts` only |
| `okx-a2a daemon start`/`status` (daemon liveness) | `repodiet-seller-runtime.ts` only |
| Heartbeat publication | `repodiet-seller-runtime.ts` only |

`repodiet-seller-runtime.ts` is started by the supervisor only after the
Gateway is live, authenticated, and both plugins are proven active — never
independently.

**Fixed — RepoDiet's own code, dispatching to the real production
pipeline, now answers inbound XMTP traffic.** okx-a2a's own OpenClaw plugin
(`@okxweb3/a2a-openclaw`) turns every inbound XMTP message into a normal
OpenClaw **agent turn** — whatever model OpenClaw has configured would
answer it, which is the prohibited "Claude/Codex/Cursor acting as
RepoDiet" topology, and would simply fail with no model-provider
credential configured (none is staged, and none should be — see below).
`openclaw-plugins/repodiet-a2a-bridge/` fixes this: an OpenClaw plugin
using the documented `before_agent_reply` hook ("Short-circuit the model
turn with a synthetic reply or silence" — typed contract confirmed
directly against the installed SDK's `dist/hook-types-*.d.ts`) to
unconditionally claim every message inside an Agent 9636 seller session
(`sessionKey` matching `my:9636:to:<peer>`) and dispatch it to real
production endpoints (`dispatch.js`):

- Analysis-intent messages with a repository URL → real A2MCP
  `POST /api/a2mcp/quick-triage` (service 37347). Paid on every real call
  in production (x402) — an unpaid dispatch genuinely returns a live 402
  with a real quote (amount, asset, payTo, quoteId), which is exactly what
  gets relayed to the requester, not a fabricated "please pay" string.
- Cleanup-intent and unclassified messages → the real A2A intake endpoint
  `POST /api/a2a/tasks` (service 37348) — the same "submitTask" endpoint
  already published in the Agent Card and already exercised by OKX's own
  reviewer. The backend's own dynamically-generated response (discovery
  text, `SCOPE_REQUIRED` guidance, or a real task acknowledgement with a
  real task id) is relayed verbatim.
- Missing required fields (no message text, no repository URL for an
  analysis-only request) → a protocol-validation error naming the exact
  missing field, computed from the request, never fixed prose.
- A local idempotency store (`idempotency.js`, keyed by the okx-a2a
  job/session identity, persisted under `HOME`) replays the prior real
  result for a retried identical message instead of dispatching — and
  therefore paying/task-creating — twice.

Two earlier fixed-template constants (`SAFE_REPLY`, `ESCALATION_REPLY`)
were removed for exactly this reason — they answered without dispatching
anything real. All of this is unit- and live-integration-tested
(`test/repodiet-a2a-bridge.test.ts`, including one test that makes a real,
side-effect-free call to production and asserts on the real dynamic
response).

**Activated in the supervisor.** `scripts/seller-runtime-supervisor.ts`
writes `plugins.load.paths` covering both plugin directories baked into the
image at build time (`/app/openclaw-plugins/okx-a2a-openclaw` and
`/app/openclaw-plugins/repodiet-a2a-bridge`), conversation-hook access for
both, and `plugins.allow: ["okx-a2a", "repodiet-a2a-bridge"]` — then, once
the Gateway is live and authenticated, runs `openclaw plugins inspect <id>
--runtime --json` for **both** plugin ids and fails startup closed unless
each genuinely reports `"status":"loaded"`, `"activated":true`, with its
documented hook (`before_agent_run` for `okx-a2a`, `before_agent_reply` for
`repodiet-a2a-bridge`) present in `typedHooks`. A plugin file existing on
disk is not accepted as proof for either plugin.

**Proven against the real built image**, not just unit-tested in
isolation: `docker exec` into a running `Dockerfile.seller` container,
running the exact same config sequence the supervisor performs, then
`openclaw plugins inspect repodiet-a2a-bridge --runtime --json` returned
(captured verbatim in
`test/fixtures/openclaw-plugins-inspect-repodiet-a2a-bridge.real-output.json`):

```json
{"plugin":{"id":"repodiet-a2a-bridge","status":"loaded","activated":true,
"activationSource":"explicit","activationReason":"selected in allowlist"},
"shape":"hook-only","typedHooks":[{"name":"before_agent_reply"}]}
```

One real, load-bearing finding from that same reproduction: OpenClaw's own
plugin loader blocks a `plugins.load.paths` entry owned by a non-root uid
("blocked plugin candidate: suspicious ownership ... expected uid=0 or
root"). `Dockerfile.seller` copies `openclaw-plugins/` **after** the
`chown -R node:node /app` step specifically so it stays root-owned — the
seller process (running as `node`) only ever reads these files.

Funded-task **continuation** (escrow funding, approval, and PR delivery —
the `/api/okx/a2a/tasks/{taskId}/{fund-escrow,approval,delivery,release}`
endpoints) is intentionally still not automated here. Per
`docs/OKX_RESUBMISSION_AUDIT.md`, a full funded A2A cycle for service 37348
has never actually completed against production even under manual,
interactive control — blocked by an OKX-side routing defect ("mixed-service
indexing"), not anything in this repo. The bridge creates the real initial
task (or relays the real payment quote for analysis) for real; automating
further steps that touch real payment/escrow state, with no way to verify
correctness against a live cycle, is out of scope for this pass.

### Incident #3: `gosu` silently discarded `HOME`, so nothing was ever actually persisted

Discovered during the first live boot of the Incident #2 fix on
`repodiet-agent-9636`: bootstrap ran, several `openclaw config set` calls
genuinely succeeded, then later calls in the same sequence began timing out,
and — critically — **every subsequent boot still reported the config as
`missing`**, even after prior calls had reported `ok:true`. That was the
tell: a boot's own writes were not surviving into the next boot, which
should be impossible if they were genuinely landing on the mounted
`/persistent` volume.

Root cause, confirmed by direct reproduction (both a standalone container
test and `/proc/<pid>/environ` read from the live Machine while a boot was
in progress): `scripts/seller-entrypoint.sh` runs `exec gosu node "$@"` to
drop from root to the unprivileged `node` user. `gosu` resets `HOME` to the
target user's `/etc/passwd` entry (`/home/node`) — it does **not** preserve
an inherited `HOME`, even though it passes every other environment variable
through unchanged (confirmed live: `REPODIET_OKX_RUNTIME_ROOT` and
`XDG_DATA_HOME` both survived correctly; only `HOME` did not). So despite
`Dockerfile.seller`'s `ENV HOME=/persistent/home`, the actual running
supervisor process saw `HOME=/home/node` — part of the container's
ephemeral filesystem, wiped on every restart — and every OpenClaw config
write, and by extension any OnchainOS/okx-a2a credential write, silently
went there instead of the mounted volume. This predates this PR's own
bootstrap work; it means **any wallet login performed before this fix was
never actually persisted either**, regardless of how the config bootstrap
itself behaved.

Fix: `scripts/seller-entrypoint.sh` now runs
`exec gosu node env HOME="$HOME" "$@"` — capturing `$HOME` from the
Dockerfile's `ENV` (still correct at that point, before `gosu` would
otherwise discard it) and re-asserting it as the exec'd command's own
environment via `env`. GNU coreutils `env` (installed here, not busybox)
execs its target directly rather than forking, so this preserves the
single signal-transparent exec chain from `tini` through to `node`
established for Incident #1's fix.

The remaining, separate `openclaw config set` timeouts observed partway
through that same boot (a handful of calls each took 30s and failed) turned
out to be a real, separate issue — see Incident #4.

### Incident #4: 8 separate `openclaw` cold starts degraded under the Machine's resource limit

After the `HOME` fix (Incident #3) landed and config writes were confirmed
reaching the real persisted volume, the next live boot still failed: the
first boot succeeded on 6 of 8 `openclaw config set` calls before the
remaining two started timing out at exactly this supervisor's own 30s
per-call limit, and — worse — the *next* boot (a fresh Firecracker VM, so
no in-memory state could carry over) failed on every single call from the
very first one, all timing out at ~30s.

Root cause, isolated by local reproduction with the exact pinned
`openclaw@2026.7.1-2` CLI, outside any Fly-specific factor: 8 separate
`openclaw config set` invocations means 8 separate Node.js cold starts per
boot. Unconstrained, each takes ~4-6s; under a `docker run --memory=512m
--cpus=1` constraint matching the Machine's `shared-cpu-1x`/512MB spec,
each takes ~8-12s — a real, reproducible ~2x slowdown from resource
pressure alone, closely matching the ~7-8s per call actually observed live
in production. The constrained local test never escalated all the way to a
30s timeout across 10 calls, so memory pressure alone likely isn't the
*whole* story — the leading theory is that a call SIGKILLed by this
supervisor's own timeout (as happened on the first boot) leaves openclaw's
`state/openclaw.sqlite` needing crash recovery on its next open, and that
recovery, combined with the same resource pressure, is what pushes
*every* subsequent call over 30s — but this compounding step was not
independently proven, only inferred from the failure pattern.

Fix: eliminate 7 of the 8 cold starts instead of trying to outrun them.
`openclaw config set` has a real, documented `--batch-json` mode (traced
directly from the installed CLI's own `dist/config-cli-*.js`, not guessed):
a single invocation takes a JSON array of `{ path, value }` or `{ path,
ref: { provider, source, id } }` entries — the same SecretRef pointer
shape `--ref-provider/--ref-source/--ref-id` builds, so `gateway.auth.token`
still never carries a literal secret value on argv. Verified end-to-end
against the real pinned CLI with the real `@okxweb3/a2a-openclaw` and
`repodiet-a2a-bridge` plugin manifests mounted at their real image paths: a
single ~4.5s batched call applied and correctly persisted all 8 config
paths, replacing 8 cold starts with 1. `scripts/seller-runtime-supervisor.ts`
now issues one `openclaw config set --batch-json '[...]' --strict-json`
call (`buildOpenclawConfigBatch`/`configureOpenclaw`) with a 60s timeout
(up from 30s per call, now covering the one combined call) instead of
looping over 8 separate invocations. Batch mode is also atomic — verified
by direct reproduction that a single invalid entry rejects the whole batch
rather than partially applying it, so this cannot leave the config in a
half-written state the way 8 independent calls could.

### Incident #5: `@okxweb3/a2a-openclaw`'s own `@sentry/node` dependency was never installed

After Incident #4's fix, the next live boot on `repodiet-agent-9636`
finally cleared bootstrap entirely (batched config-set succeeded, marker
written, second boot correctly skipped re-configuring via
`bootstrap_skipped_marker_match`) and the OpenClaw Gateway itself came up
and reported `ready`. But the `okx-a2a` plugin failed to load:

```
[plugins] okx-a2a failed to load from /app/openclaw-plugins/okx-a2a-openclaw/dist/index.js:
Error: Cannot find module '@sentry/node'
```

Root cause, confirmed directly from the real published
`@okxweb3/a2a-openclaw@0.1.10` package's own `package.json`: it declares a
real runtime dependency, `"dependencies": { "@sentry/node": "^7.74.1" }`.
`Dockerfile.seller` only ever `npm pack`s and extracts the plugin's own
files (proving they're byte-correct via a checksum match) — it never
installed the plugin's *own* dependencies anywhere Node's module
resolution would find them. A checksum match and a successful `tar -xzf`
prove nothing about whether the extracted code can actually load; that gap
was only ever discoverable live, once the Gateway actually tried to
`require()` the plugin — well after both build and deploy had already
"succeeded."

Fix: `@sentry/node` is now a real, pinned dependency in this repo's own
`package.json` (resolved to `7.120.4`, satisfying the plugin's own
`^7.74.1`), installed into `/app/node_modules` by the existing `npm ci`
step — no separate install step needed, since Node's `require()`
resolution walks up from `/app/openclaw-plugins/okx-a2a-openclaw/dist/`
through ancestor `node_modules` directories and finds it at `/app/`.
Verified end-to-end against the real pinned CLI with the real plugin
manifest, `openclaw plugins inspect okx-a2a --runtime --json` reporting
`status: "loaded"`, `activated: true`, and `before_agent_run` in
`typedHooks` only once `@sentry/node` was present — confirming it was the
only missing dependency (a raw `require()` test outside OpenClaw's own
plugin loader gave a false-alarm second error, `Cannot find module
'openclaw/plugin-sdk/gateway-runtime'`, because OpenClaw's real plugin
loader injects its own module resolution before loading plugin code,
which a bare `node -e` require never replicates).

**A missing dependency like this must never again be discoverable only
live.** `Dockerfile.seller` now runs `scripts/verify-openclaw-plugins-load.ts`
as a build step immediately after the plugin extraction step: it configures
a scratch OpenClaw home (via a placeholder gateway token and a temporary
`$HOME`, both confined to that one `RUN` layer via inline shell `export`,
never a Dockerfile `ENV` — nothing here is ever baked into the image or the
real runtime's `HOME`) using the exact same `buildOpenclawConfigBatch()`
the supervisor uses at boot, then runs `openclaw plugins inspect` for both
plugins and fails the **build** closed if either does not report
genuinely loaded and activated with its documented hook. This reuses the
real supervisor's own batch/plugin/hook definitions and the same
`parsePluginInspection` parser the supervisor's own runtime verification
uses — not a second, hand-maintained copy that could drift.

### Incident #6: the Gateway readiness probes' own timeouts were shorter than a cold `openclaw` CLI start

After Incident #5's fix let both plugins genuinely load, the next several
live boots on `repodiet-agent-9636` still each hit
`openclaw_gateway_not_ready_within_timeout` after the full 120s — even
though the OpenClaw Gateway process itself reliably logged `ready`
internally. A prior pass (the readiness-diagnostics fix) added redacted
failure logging to every poll, and that immediately revealed the real
cause: every single `gateway_health_not_ready_yet` log line showed
`category: "timeout"`, an **empty** `stderrTail`, and a `durationMs` right
at the probe's own 10-second timeout — the `openclaw gateway health`
CLI invocation itself was never getting a chance to respond before this
supervisor killed it, on every single poll, across multiple full boot
cycles. It never even reached the second probe (`gateway status
--require-rpc`).

Root cause: `gateway health` and `gateway status --require-rpc` each spawn
a **fresh Node.js CLI cold start** — the exact same cost already measured
for `openclaw config set` in Incident #4 (~8-12s per cold start under a
`--memory=512m --cpus=1` constraint matching this Machine's
`shared-cpu-1x`/512MB spec). The readiness probes' own per-call timeouts
(10s for health, 15s for auth) were shorter than that already-measured
cold-start cost — on the live Machine, where the Gateway process itself is
*also* concurrently competing for the same single vCPU, the probes never
had a real chance to succeed.

Fix: raised `gatewayHealthy`'s timeout from 10s to 60s and
`gatewayAuthenticatedAndReady`'s from 15s to 60s, matching the same
generous scale already applied to the batch config-set call in Incident
#4. The overall `GATEWAY_READY_TIMEOUT_MS` deadline was raised from 120s to
300s alongside them, so the polling loop still gets several real attempts
at the new, more realistic per-call pace instead of exhausting itself on
one or two cold starts. All three are still configurable via
`REPODIET_OPENCLAW_GATEWAY_HEALTH_PROBE_TIMEOUT_MS`,
`REPODIET_OPENCLAW_GATEWAY_AUTH_PROBE_TIMEOUT_MS`, and
`REPODIET_OPENCLAW_GATEWAY_READY_TIMEOUT_MS` if the Machine's real-world
cold-start cost turns out to need further tuning.

## One-time CLI authentication

The `onchainos` and `okx-a2a` CLIs authenticate through their own credential
home. That home is the persisted `/persistent/home` volume, so the login
survives container restarts and image upgrades.

**Do not copy a workstation keyring into the image or the volume.** The local
credential store is machine-bound and copying it is both unreliable and
unsafe. Perform a one-time interactive login inside the running container:

```bash
docker compose -f docker-compose.production.yml exec repodiet-seller \
  onchainos wallet login
```

Follow the printed URL in a browser (or complete the printed device code),
then verify:

```bash
docker compose -f docker-compose.production.yml exec repodiet-seller \
  onchainos agent gate-check --role asp
```

Because `/persistent/home` is a persisted volume, this is required once —
not on every deploy. **Never paste a seed phrase, private key, heartbeat
secret, or any credential file into chat** — the browser/device-code
approval above is the only interactive step this runtime ever needs from an
operator.

## Deploy

```bash
docker compose -f docker-compose.production.yml up -d --build
```

## Health

The image ships a `HEALTHCHECK` that proves the process is alive **and**
holding its instance lock, rather than merely running:

```bash
docker compose -f docker-compose.production.yml ps
docker inspect --format '{{.State.Health.Status}}' <container>
```

Authoritative end-to-end health is the production surface, which reports
`heartbeatStatus` from the TTL rather than from process existence:

```bash
curl -s https://skillswap-virid-kappa.vercel.app/api/okx/health
```

`agentRuntime.heartbeatStatus` must read `fresh`.

## Logs

```bash
docker compose -f docker-compose.production.yml logs -f repodiet-seller
```

Structured single-line JSON events from `repodiet-seller-runtime.ts`:
`startup`, `identity_verified`, `identity_rejected`, `instance_lock_acquired`,
`communication_ready`, `a2a_daemon_ready`, `xmtp_ready`, `heartbeat_accepted`,
`heartbeat_withheld`, `heartbeat_rejected`, `heartbeat_error`,
`shutdown_started`, `shutdown_complete`, `fatal`.

`seller-runtime-supervisor.ts` (the container's actual PID 1 under
tini/gosu) logs its own events first, prefixed by component in each line's
JSON: `startup`, `bootstrap_lock_acquired`/`bootstrap_lock_not_acquired`/
`bootstrap_lock_released`, `openclaw_config_validated` (`when: "before"` and
`"after"`), `openclaw_config_quarantined`, `bootstrap_skipped_marker_match`,
`bootstrap_running`, `openclaw_config_set`/`openclaw_config_set_failed`,
`ai_provider_set`/`ai_provider_set_failed`, `bootstrap_marker_written`,
`gateway_health_ok`, `gateway_auth_ready`, `plugin_verified` (once per
plugin id), `running`, `shutdown_started`, `shutdown_complete`. Any command
failure logs a redacted, categorized diagnostic object (command, exitCode,
timedOut, category, stderrTail, durationMs, retryDecision — see Incident #2
above) instead of a bare `ok: false`.

`heartbeat_withheld` is not an error — it is the runtime correctly refusing
to claim online while the daemon, gate-check, or XMTP is failing.
`bootstrap_skipped_marker_match` is not an error either — it is the
expected, common case on every restart after the first successful boot.

## Upgrade

```bash
git pull
docker compose -f docker-compose.production.yml up -d --build
```

Volumes are preserved, so the CLI login is not repeated.

## Rollback

```bash
git checkout <previous-sha>
docker compose -f docker-compose.production.yml up -d --build
```

## Verify after host reboot

1. `docker compose -f docker-compose.production.yml ps` — container running.
2. Health status `healthy`.
3. Logs show `startup` → `identity_verified` → `instance_lock_acquired`.
4. Within one interval, `heartbeat_accepted`.
5. `/api/okx/health` reports `agentRuntime.heartbeatStatus: "fresh"`.

## Cutover from the workstation

Run both only briefly. Two live sellers would double-acknowledge tasks. Do
not stop the workstation runtime until the container has proven **all** of
the following, sustained for at least 180 seconds:

1. Supervisor: `bootstrap_marker_written` (first boot) or
   `bootstrap_skipped_marker_match` (subsequent boots), `gateway_auth_ready`,
   and `plugin_verified` (ok: true) for both `okx-a2a` and
   `repodiet-a2a-bridge`
2. `identity_verified`
3. `communication_ready` (ok: true, fail: 0)
4. `a2a_daemon_ready` (ok: true)
5. `xmtp_ready`
6. `heartbeat_accepted`, and `/api/okx/health` reports
   `agentRuntime.heartbeatStatus: "fresh"`

Then:

1. Stop the workstation runtime and its heartbeat daemon.
2. Wait at least 180 seconds.
3. Confirm the container still reports `heartbeat_accepted` and
   `/api/okx/health` still reads `fresh` with the laptop closed.
4. Disable any Windows scheduled task that would restart the local runtime.

Do not run a paid task as part of this verification — cutover is a
liveness/availability proof only.

## Not covered here

The container image and this runbook remain provider-neutral and provision
nothing themselves; Railway, Fly, and any permanent Linux VM are all
operator-provisioned (see "Railway (prior deployment target)", "Fly.io
(current testing target)", and "Permanent Linux VM deployment" above). This
PR does not create the Fly volume, deploy a Machine, or run `fly secrets
deploy` — those remain explicit operator actions.
