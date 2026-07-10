#!/usr/bin/env bash
# Push the controlled E2E fixture to https://github.com/smokychain22/repodiet-e2e-test
# Run from repo root with a GitHub token that can write to repodiet-e2e-test:
#   GITHUB_TOKEN=ghp_xxx ./scripts/push-e2e-fixture.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$ROOT/e2e-fixture"
REPO="${E2E_REPO:-https://github.com/smokychain22/repodiet-e2e-test.git}"
WORKDIR="$(mktemp -d)"

cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

if [[ ! -d "$FIXTURE/src" ]]; then
  echo "Missing fixture at $FIXTURE" >&2
  exit 1
fi

git clone "$REPO" "$WORKDIR/repo"
rsync -a --delete \
  --exclude node_modules \
  --exclude .next \
  "$FIXTURE/" "$WORKDIR/repo/"

cd "$WORKDIR/repo"
git add -A
if git diff --staged --quiet; then
  echo "No changes to push."
  exit 0
fi

git commit -m "Update RepoDiet E2E controlled test fixture"
git push origin main
echo "Pushed to $REPO (main)"
