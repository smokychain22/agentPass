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
  # exec so the runtime becomes PID 1's direct child and receives SIGTERM.
  exec gosu node "$@"
fi

exec "$@"
