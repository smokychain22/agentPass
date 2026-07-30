#!/bin/sh
# Railway-compatible entrypoint for the RepoDiet seller runtime.
#
# Railway attaches its persistent volume at /persistent AFTER the image is
# built, which masks anything the Dockerfile created or chowned at that path.
# A build-time `chown -R node:node /persistent` therefore does not survive,
# and the volume arrives owned by root — so a container running as `node`
# could not write its runtime state or CLI credentials.
#
# This runs as root only long enough to create the directories on the mounted
# volume and hand them to the unprivileged user, then drops privileges and
# execs the runtime as `node`. The seller process itself never runs as root.
set -eu

PERSIST_ROOT="${PERSIST_ROOT:-/persistent}"

# Create on the mounted volume, not the image layer.
mkdir -p \
  "${PERSIST_ROOT}/data/okx-runtimes" \
  "${PERSIST_ROOT}/home"

# Only correct ownership when we are actually root; if the platform already
# runs us unprivileged with a writable volume, leave it alone.
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "${PERSIST_ROOT}"
  # Verified by direct reproduction (both a standalone container test and a
  # real Fly boot): gosu resets HOME to the target user's /etc/passwd entry
  # (/home/node) — it does NOT preserve an inherited HOME, even though it
  # passes every other environment variable through unchanged. Confirmed
  # live: REPODIET_OKX_RUNTIME_ROOT and XDG_DATA_HOME survived correctly,
  # but HOME did not, silently redirecting every OpenClaw/OnchainOS/okx-a2a
  # config and credential write to the ephemeral container filesystem
  # instead of the persisted volume — nothing was ever actually persisted,
  # including any prior wallet login, and every restart saw a blank state.
  # `env HOME=...` re-asserts the Dockerfile's intended value as the exec'd
  # command's own environment; GNU coreutils `env` (installed here, not
  # busybox) execs its target directly rather than forking, so this keeps
  # the single signal-transparent exec chain from tini through to node
  # intact — see the "single exec'd chain" note in Dockerfile.seller.
  exec gosu node env HOME="$HOME" "$@"
fi

exec "$@"
