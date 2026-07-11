# RepoDiet E2E scenario matrix

Use this checklist when running against production RepoDiet.

## Scan tab

- [ ] Repository: `smokychain22/repodiet-e2e-test`
- [ ] Branch: `main`
- [ ] Commit SHA recorded
- [ ] Framework detected (Next.js)
- [ ] Project root: `.` (single app, no mirror copy)

## Findings tab — expected signals

| Finding | File(s) | Bucket / action |
|---------|---------|-----------------|
| Unused import: Clock | `src/components/Dashboard.tsx` | Supported → edit |
| Unused import: React (if detected) | `src/components/StatusCard.tsx` | Supported or review |
| Backup / archive file | `src/archive/OldDashboard.backup.tsx` | Safe candidate → delete |
| Unreferenced file | `src/lib/unused-helper.ts` | Review first |
| Duplicate cluster | `StatusCard.tsx` / `StatusCardCopy.tsx` | Review first |
| Orphan modules | `orphan-a.ts`, `orphan-b.ts` | Review first |
| Protected route | `src/app/page.tsx` | Do not touch |
| Unused dependency | `left-pad` | Review / package suggestion |

## Quick Cleanup — minimum proof

| Stage | Expected |
|-------|----------|
| Detected supported | ≥ 1 (Clock import; possibly backup delete) |
| Generated changes | ≥ 1 |
| Validated changes | ≥ 1 after `git apply --check` |
| Patch validation | `passed` (not `skipped` / `not_generated`) |

## Verify tab

- [ ] Unlocked only after validated changes > 0
- [ ] Typecheck / build commands show real exit codes

## GitHub PR

- [ ] Cleanup PR contains `Dashboard.tsx` import edit
- [ ] Cleanup PR may contain backup file deletion
- [ ] `main` branch unchanged
- [ ] Report-only PR works without code changes if cleanup has none
