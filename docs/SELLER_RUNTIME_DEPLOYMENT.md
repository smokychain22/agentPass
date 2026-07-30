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

### Fly.io (current testing target)

`fly.toml` at the repo root targets the existing Fly app
`repodiet-agent-9636` (organisation `personal`) — no Machine or volume
exists on it yet, and this repo does not create either. The Fly account
behind this app is on a **limited free trial**; do not treat it as a claim
of permanent 24/7 hosting — see "Permanent Linux VM deployment" below for
the long-term host. The container image is identical on Fly and everywhere
else: `Dockerfile.seller`, unchanged.

Seven secrets are already staged in Fly
(`REPODIET_OKX_RUNTIME_HEARTBEAT_SECRET`, `OPENCLAW_GATEWAY_TOKEN`,
`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_BASE64`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_WEBHOOK_SECRET`) — this PR does not
read, print, or run `fly secrets deploy` against them.

**Operator commands after this PR is merged** (none of these are run by
this PR):

```bash
fly volumes create repodiet_persistent --app repodiet-agent-9636 --region sin --size 1
fly deploy --app repodiet-agent-9636 --remote-only
fly machine list --app repodiet-agent-9636   # confirm exactly one Machine
fly machine update <machine-id> --app repodiet-agent-9636 --autostop=off --autostart=true
```

`--autostop=off` is a Machines-API-level flag (not a `fly.toml` block) as of
current `flyctl` — confirm the exact flag name with `fly machine update
--help` before running it, since this repo does not execute it.

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
time) — only okx-a2a's *own plugin registration* into that CLI is left to run
at container startup, because that step is stateful (it writes into the
persisted home volume).

`scripts/repodiet-seller-runtime.ts` runs `okx-a2a setup <provider>` once at
every container start (`provider_bound`), followed by `okx-a2a doctor --fix
--json` (`communication_ready`) and `okx-a2a daemon status` / `daemon start`
(`a2a_daemon_ready`), before the heartbeat loop begins. Each heartbeat tick
re-checks daemon liveness and restarts it via the official `daemon start`
command if it died — a bounded-backoff restart tied to the heartbeat
interval, not a custom process supervisor.

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

The supervisor now: writes `gateway.mode=local`, `gateway.auth.mode=token`,
and `gateway.auth.token` (bound to the `OPENCLAW_GATEWAY_TOKEN` SecretRef)
plus `plugins.allow: ["okx-a2a"]` into OpenClaw's own config via `openclaw
config set` (schema verified directly against the installed
`openclaw@2026.7.1-2` CLI docs and TypeScript declarations — not guessed);
registers the okx-a2a plugin (`okx-a2a setup openclaw`); starts `openclaw
gateway run` itself as a managed foreground child; and polls `openclaw
gateway health` then `openclaw gateway status --require-rpc` until the
Gateway is live **and** authenticated before starting
`repodiet-seller-runtime.ts` (which still owns `okx-a2a setup`/`doctor
--fix`/`daemon`, unchanged). It also mirrors the shared token into
`OKX_A2A_OPENCLAW_GATEWAY_TOKEN` — a second, separately-read env var name
confirmed directly in the installed `@okxweb3/a2a-node@0.1.10` bundle,
which the daemon/CLI's own gateway client reads independently of the
plugin's config. See the module docblock in
`scripts/seller-runtime-supervisor.ts` for the full, source-verified
citation trail, and `test/seller-runtime-supervisor.test.ts` for the
regression coverage (startup ordering, signal forwarding, fail-closed
paths, secret hygiene).

**Remaining gap — RepoDiet is not yet the thing that answers a real inbound
XMTP task.** The Gateway now starts and authenticates, but okx-a2a's own
OpenClaw plugin (`@okxweb3/a2a-openclaw`) turns every inbound XMTP message
into a normal OpenClaw **agent turn** — whatever model OpenClaw has
configured would answer it, which is the prohibited "Claude/Codex/Cursor
acting as RepoDiet" topology, and would simply fail with no model-provider
credential configured (none is staged, and none should be — see below).
`openclaw-plugins/repodiet-a2a-bridge/` is a real, contract-verified fix:
an OpenClaw plugin using the documented `before_agent_reply` hook
("Short-circuit the model turn with a synthetic reply or silence" — typed
contract confirmed directly against the installed SDK's
`dist/hook-types-*.d.ts`) to unconditionally claim every message inside an
Agent 9636 seller session (`sessionKey` matching `my:9636:to:<peer>`, the
same pattern already proven in
`scripts/okx-runtime/repodiet-a2a-responder.ts`) and answer it
deterministically — either the same safe-message template already proven
over the HTTP intake path, or a fixed escalation notice — **never** a model
call. Its decision logic (`logic.js`) is unit-tested
(`test/repodiet-a2a-bridge.test.ts`).

This plugin is **built but not yet wired into the supervisor's startup
config calls**. Activating it needs `openclaw config set plugins.load.paths
'["/app/openclaw-plugins/repodiet-a2a-bridge"]' --strict-json` plus
`plugins.entries.repodiet-a2a-bridge.hooks.allowConversationAccess: true`
(required for any non-bundled plugin using a conversation hook). That was
deliberately deferred out of this change: adding an unverified plugin load
to the fail-closed startup sequence risks turning a now-working
gateway-ready path into a new failure mode that cannot be exercised without
a live gateway. Before wiring it in, run `openclaw plugins inspect
repodiet-a2a-bridge --runtime --json` against a real built container and
confirm it reports the plugin loaded.

Funded-task execution (real repository analysis, real PR creation) is
intentionally still out of scope for this plugin — it only answers
pre-work/discovery messages. Wiring `analyze_repository` (A2MCP 37347) and
`create_cleanup_pr` (A2A 37348) dispatch through this same hook, calling
the already-production-proven HTTP pipeline (`docs/OKX_RESUBMISSION_AUDIT.md`
documents `analyze_repository` working end-to-end with a real on-chain
payment against `velz-cmd/repodiet-e2e-test`), is the next concrete step.

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

Structured single-line JSON events: `startup`, `identity_verified`,
`identity_rejected`, `instance_lock_acquired`, `provider_bound`,
`communication_ready`, `a2a_daemon_ready`, `xmtp_ready`, `heartbeat_accepted`,
`heartbeat_withheld`, `heartbeat_rejected`, `heartbeat_error`,
`shutdown_started`, `shutdown_complete`, `fatal`.

`heartbeat_withheld` is not an error — it is the runtime correctly refusing
to claim online while the daemon, gate-check, or XMTP is failing.

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

1. `identity_verified`
2. `provider_bound` (ok: true)
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
