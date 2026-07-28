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
| Persistence | Two volumes: `/data` (runtime state) and `/home/node` (CLI credentials) |
| Network | Outbound HTTPS + XMTP. **No inbound ports** — it is a client, not a server |
| Restart | `unless-stopped`, so it survives container crash and host reboot |

The runtime is not a web server. Do not publish a port.

## Secrets

Copy `.env.seller.example` to `.env.seller` on the host and fill it in
there. Never commit it. Required to start:

- `REPODIET_OKX_RUNTIME_HEARTBEAT_SECRET` (min 32 chars)

The runtime **fails closed** without it rather than starting and reporting
itself online.

## One-time CLI authentication

The `onchainos` and `okx-a2a` CLIs authenticate through their own credential
home. That home is the persisted `/home/node` volume, so the login survives
container restarts and image upgrades.

**Do not copy a workstation keyring into the image or the volume.** The local
credential store is machine-bound and copying it is both unreliable and
unsafe. Perform a one-time interactive login inside the running container:

```bash
docker compose -f docker-compose.production.yml exec repodiet-seller \
  onchainos wallet login
```

Follow the printed URL in a browser, then verify:

```bash
docker compose -f docker-compose.production.yml exec repodiet-seller \
  onchainos agent gate-check --role asp
```

Because `/home/node` is a named volume, this is required once — not on every
deploy.

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
`identity_rejected`, `instance_lock_acquired`, `heartbeat_accepted`,
`heartbeat_withheld`, `heartbeat_rejected`, `heartbeat_error`,
`shutdown_started`, `shutdown_complete`, `fatal`.

`heartbeat_withheld` is not an error — it is the runtime correctly refusing
to claim online while the gate-check or XMTP is failing.

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

Run both only briefly. Two live sellers would double-acknowledge tasks.

1. Bring the container up and confirm `heartbeat_accepted`.
2. Stop the workstation runtime and its heartbeat daemon.
3. Confirm `/api/okx/health` still reports `fresh` with the laptop closed.
4. Disable any Windows scheduled task that would restart the local runtime.

## Not covered here

Choosing and paying for a host is deliberately left to the operator — this
runbook is provider-neutral and provisions nothing.
