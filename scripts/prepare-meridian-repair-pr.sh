#!/usr/bin/env bash
# Prepare Meridian repair PR for RepoDiet PR #14 regression.
# Run from a clone of https://github.com/velz-cmd/Meridian
set -euo pipefail

GOOD_COMMIT="824075afe776067bf00343581105d6a1f5e61178"
BROKEN_COMMIT="a39937b4b05691a7cc57f2824f18745dd61bea3f"
BRANCH="repair/restore-pr14-regression"

git fetch origin "$GOOD_COMMIT"
git checkout -B "$BRANCH"
git checkout "$GOOD_COMMIT" -- src/lib/feed-curation.ts src/lib/token-quote.ts
git add src/lib/feed-curation.ts src/lib/token-quote.ts

echo "Restored files from $GOOD_COMMIT"
git diff --cached --stat

npm ci
npm run build 2>&1 | tee /tmp/meridian-repair-build.log || true

git commit -m "Repair malformed TypeScript introduced by RepoDiet PR #14

Restore src/lib/feed-curation.ts and src/lib/token-quote.ts from commit
$GOOD_COMMIT (pre-RepoDiet PR #14).

Broken commit: $BROKEN_COMMIT merged PR #14 which left incomplete constant
declarations and dangling type properties.

Build output saved to /tmp/meridian-repair-build.log"

echo ""
echo "Next: git push -u origin $BRANCH"
echo "Then open PR titled: Repair malformed TypeScript introduced by RepoDiet PR #14"
