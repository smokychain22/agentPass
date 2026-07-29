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

### Railway (current deployment target)

Agent 9636's production seller runtime is deployed on Railway: project
`agile-patience`, service `repodiet-production-worker`, deploying `main` via
`Dockerfile.seller` (`RAILWAY_DOCKERFILE_PATH=Dockerfile.seller`), with a
Railway Volume mounted at `/persistent`. Railway rejects a Docker `VOLUME`
instruction at Dockerfile parse time, so persistence is attached by the
platform rather than declared in the image — see `scripts/seller-entrypoint.sh`,
which `chown`s the volume to the runtime user after Railway mounts it, since a
build-time `chown` at that path is masked by the later mount.

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

**Known gap — task dispatch is not yet wired.** This layer proves the
transport is real (daemon alive, identity verified, heartbeat honest). It
does **not** yet make RepoDiet's own scan/plan/patch/PR pipeline the thing
that handles an inbound service-37348 task. OpenClaw's Gateway exposes a
`POST /tools/invoke` HTTP endpoint that runs one named tool deterministically
without an LLM reasoning turn — that is the correct integration point for a
future RepoDiet tool-plugin — but no such plugin exists yet, and OpenClaw's
own `ai exec`/`ai resume` dispatch only lists `codex|claude|hermes` as
providers, not `openclaw`, confirming OpenClaw is not driven through that
per-task exec path either. Building and testing that plugin is required
follow-up work before any inbound task can be safely served from this
runtime.

**Known gap — the OpenClaw Gateway process itself is not supervised yet.**
Verified by direct reproduction in a real built container: `okx-a2a setup
openclaw`'s automatic post-install gateway restart uses `systemctl --user`
(or launchd/schtasks), which does not exist under this container's `tini`
PID 1 — it logs "Gateway service disabled" and leaves the actual OpenClaw
Gateway (the WebSocket/HTTP server that would host `/tools/invoke`) not
running. This does not affect what this runtime currently proves: the
`okx-a2a daemon` (the XMTP transport) starts and reports ready independently
of Gateway state, so `a2a_daemon_ready`/heartbeat gating are unaffected. The
Gateway only becomes load-bearing once the tool-dispatch plugin above is
built — at that point this runtime needs its own supervisor for `openclaw
gateway run` (the documented foreground form; `start`/`install`/`restart` all
assume a service manager this container doesn't have), analogous to
`ensureDaemonRunning()` for the okx-a2a daemon. Not implemented yet.

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
nothing themselves; Railway was operator-provisioned (see "Railway (current
deployment target)" above). Choosing a *different* host, or changing what is
already provisioned on Railway, remains an operator decision this repo does
not make on its own.
