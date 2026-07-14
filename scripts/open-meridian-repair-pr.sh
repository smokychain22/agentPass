#!/usr/bin/env bash
# Open Meridian repair PR using YOUR GitHub credentials (not cursor[bot]).
# Requires: gh auth login as a user with push access to velz-cmd/Meridian
set -euo pipefail

GOOD_COMMIT="824075afe776067bf00343581105d6a1f5e61178"
BROKEN_COMMIT="a39937b4b05691a7cc57f2824f18745dd61bea3f"
BRANCH="repair/restore-pr14-regression"
REPO="velz-cmd/Meridian"

WORKDIR="${1:-/tmp/Meridian-repair}"
mkdir -p "$(dirname "$WORKDIR")"
if [[ ! -d "$WORKDIR/.git" ]]; then
  git clone "https://github.com/${REPO}.git" "$WORKDIR"
fi
cd "$WORKDIR"

git fetch origin main "$GOOD_COMMIT"
git checkout main
git pull origin main
git checkout -B "$BRANCH"
git checkout "$GOOD_COMMIT" -- src/lib/feed-curation.ts src/lib/token-quote.ts
git add src/lib/feed-curation.ts src/lib/token-quote.ts

if git diff --cached --quiet; then
  echo "No changes — files may already match $GOOD_COMMIT"
  exit 0
fi

git commit -m "Repair malformed TypeScript introduced by RepoDiet PR #14

Restore src/lib/feed-curation.ts and src/lib/token-quote.ts from commit
$GOOD_COMMIT (pre-RepoDiet PR #14).

Broken commit: $BROKEN_COMMIT merged PR #14 which left incomplete constant
declarations and dangling type properties.

No unrelated changes."

git push -u origin "$BRANCH"

gh pr create \
  --repo "$REPO" \
  --base main \
  --head "$BRANCH" \
  --title "Repair malformed TypeScript introduced by RepoDiet PR #14" \
  --body "## Summary

Restores only two files corrupted by RepoDiet cleanup PR #14.

| File | Issue |
|------|--------|
| \`src/lib/feed-curation.ts\` | Unfinished \`BLUE_CHIP_NAME_HINTS = [\`, \`BLUE_CHIP_SYMBOLS\` removed |
| \`src/lib/token-quote.ts\` | Dangling type properties; \`isTokenQuoteReliable\` header deleted |

## Commits

- **Broken:** \`$BROKEN_COMMIT\` (RepoDiet PR #14 merged)
- **Restored from:** \`$GOOD_COMMIT\`

## Scope

- Only \`src/lib/feed-curation.ts\` and \`src/lib/token-quote.ts\`
- No revert of unrelated commits or RepoDiet artifacts under \`repodiet/\`

## Verification

Run locally after merge:

\`\`\`bash
npm ci
npm run build
\`\`\`

Note: a pre-existing type error in \`src/app/api/nexus/feed/route.ts\` may remain; this repair fixes the syntax corruption introduced by RepoDiet PR #14."

echo ""
echo "PR created. Review and merge before re-scanning Meridian in RepoDiet."
