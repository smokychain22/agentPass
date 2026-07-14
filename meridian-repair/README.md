# Meridian PR #14 repair bundle

RepoDiet PR #14 on [velz-cmd/Meridian](https://github.com/velz-cmd/Meridian) left syntactically invalid TypeScript at commit `a39937b4`.

## Restore these files only

| File | From commit |
|------|-------------|
| `src/lib/feed-curation.ts` | `824075afe776067bf00343581105d6a1f5e61178` |
| `src/lib/token-quote.ts` | `824075afe776067bf00343581105d6a1f5e61178` |

## Open repair PR (requires your GitHub push access)

```bash
bash scripts/open-meridian-repair-pr.sh
```

Or apply the patch from a Meridian clone:

```bash
git checkout -b repair/restore-pr14-regression
git apply /path/to/agentPass/meridian-repair-pr14.patch
git add src/lib/feed-curation.ts src/lib/token-quote.ts
git commit -m "Repair malformed TypeScript introduced by RepoDiet PR #14"
git push -u origin repair/restore-pr14-regression
gh pr create --title "Repair malformed TypeScript introduced by RepoDiet PR #14"
```

Cloud agents cannot push to `velz-cmd/Meridian` (cursor[bot] is read-only).
