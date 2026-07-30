# Permanent Linux VM deployment (host-neutral)

This is the long-term hosting path for the RepoDiet seller runtime (Agent
9636), independent of Fly.io. Fly.io (`fly.toml` at the repo root) is the
current **testing** target only — the Fly account behind it is on a limited
free trial and this repo does not claim it provides permanent 24/7 hosting.
The container image is unchanged between the two: `Dockerfile.seller` is
built and run identically on Fly and here.

Tested on **x86_64 only**. Do not assume arm64 support — the pinned
`onchainos`, `okx-a2a`, and `openclaw` binaries in `Dockerfile.seller` are
not verified on arm64.

## Requirements

- A persistent Linux VM (any provider) with Docker Engine (including the
  Docker Compose plugin, `docker compose`) installed and `docker.service`
  enabled.
- Outbound HTTPS + XMTP only. No inbound port needs to be opened — see
  `docker-compose.production.yml`.
- Enough disk for one Docker image plus the `/persistent` volume (wallet
  credential home + runtime state).

## Install

```bash
sudo mkdir -p /opt/repodiet
sudo git clone <this-repo-url> /opt/repodiet
cd /opt/repodiet
cp .env.seller.example .env.seller
# Fill in .env.seller with real values on the host — never commit it.

sudo cp deploy/repodiet-seller.service /etc/systemd/system/repodiet-seller.service
sudo systemctl daemon-reload
sudo systemctl enable --now repodiet-seller.service
```

`repodiet-seller.service` runs **on the host** and manages the
`docker compose` stack — it does not run inside the container, and does not
put systemd inside the image. The container's own PID 1 stays `tini` (see
`Dockerfile.seller`); process supervision inside the container is
`scripts/seller-runtime-supervisor.ts`, unchanged from the Fly path.

## What guarantees a restart after VM reboot

Two independent layers, so either alone is enough:

1. `repodiet-seller.service` is `enable`d, so systemd starts it at boot
   (`multi-user.target`), which runs `docker compose up -d`.
2. The container itself has `restart: unless-stopped` in
   `docker-compose.production.yml`, so once the Docker daemon comes up (its
   own `docker.service`, which distros normally enable by default),
   previously-running containers restart on their own even without step 1.

## One-time CLI authentication

Identical to the Fly path — see "One-time CLI authentication" in
`docs/SELLER_RUNTIME_DEPLOYMENT.md`. Because `/persistent/home` is a Docker
named volume on this VM (`repodiet_persistent`, matching the Fly volume
name), the wallet/OpenClaw login survives container recreation, image
upgrades, and VM reboots — only the volume itself is durable state.

## Upgrade

```bash
cd /opt/repodiet
git pull
sudo systemctl reload repodiet-seller.service
```

`ExecReload` reruns `docker compose up -d`, which rebuilds/pulls as needed
and recreates only the container — the named volume (and everything on it)
is untouched.

## Verify

```bash
sudo systemctl status repodiet-seller.service
docker compose -f docker-compose.production.yml logs -f repodiet-seller
docker inspect --format '{{.State.Health.Status}}' $(docker compose -f docker-compose.production.yml ps -q repodiet-seller)
curl -s https://skillswap-virid-kappa.vercel.app/api/okx/health
```

`agentRuntime.heartbeatStatus` must read `fresh`, same acceptance bar as
the Fly path.

## Uninstall

```bash
sudo systemctl disable --now repodiet-seller.service
sudo rm /etc/systemd/system/repodiet-seller.service
sudo systemctl daemon-reload
docker compose -f docker-compose.production.yml down
```

Add `-v` to the final command only if the persistent volume (wallet
credential home) should also be destroyed — normally it should not be.
