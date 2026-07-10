# repodiet-e2e-test

Controlled fixture repository for verifying [RepoDiet](https://skillswap-skillswap7.vercel.app) performs **real** detection, editing, deletion, verification, and PR creation.

**Do not use this repo for production code.** Every issue below is intentional.

## Repository URL

`https://github.com/smokychain22/repodiet-e2e-test`

## Intentional scenarios

| # | Location | Issue | Expected RepoDiet action |
|---|----------|-------|--------------------------|
| 1 | `src/components/Dashboard.tsx` | Unused import `Clock` from `lucide-react` | **Edit** — remove `Clock` from import |
| 2 | `src/components/StatusCard.tsx` | Possibly unused `React` import (jsx: preserve) | **Edit** only if parser proves safe; else review |
| 3 | `src/archive/OldDashboard.backup.tsx` | Obvious backup file, unreferenced | **Delete** after safety checks |
| 4 | `src/lib/unused-helper.ts` | Normal unreferenced helper | **Review first** — no auto-delete on fallback alone |
| 5 | `src/components/StatusCard.tsx` + `StatusCardCopy.tsx` | Duplicate component bodies | **Review first** — no blind deletion |
| 6 | `src/lib/orphan-a.ts` + `orphan-b.ts` | Orphan module group | **Review first** |
| 7 | `src/app/page.tsx` | Next.js route entry | **Protected** — never auto-delete |
| 8 | `package.json` → `left-pad` | Unused dependency | **Finding**; removal needs strong evidence + lockfile regen |

## Best first test (start here)

Run only these three expectations before expanding:

1. **Unused import (`Clock`)** → real edit in `Dashboard.tsx`
2. **Backup file** → real deletion of `src/archive/OldDashboard.backup.tsx`
3. **Unused helper** → review-first, **no** automatic deletion

### Expected diff for unused import

```diff
-import { Clock, CheckCircle } from "lucide-react";
+import { CheckCircle } from "lucide-react";
```

### Expected deletion for backup file

```
deleted: src/archive/OldDashboard.backup.tsx
```

## RepoDiet test flow

1. **Scan** `smokychain22/repodiet-e2e-test` on `main`
2. Confirm exact branch + commit SHA
3. **Findings** — inspect each scenario above
4. **Quick Cleanup** — generate changes for supported fixes only
5. Inspect real before/after diff
6. Confirm `git apply --check` passed
7. **Verify** — confirm real command output (not simulated)
8. Authorize GitHub App for this repository
9. **Create Cleanup PR**
10. On GitHub: confirm new branch, real diff, **main untouched**

## Pass criteria

RepoDiet **passes** when:

- Unused `Clock` import is detected and edited
- Backup file is detected and deleted only when eligible
- `unused-helper.ts` stays review-first
- `page.tsx` / `layout.tsx` / configs / lockfiles are protected
- Duplicates reported but not recklessly deleted
- Genuine unified diff generated
- Patch validation runs for edits **and** deletions
- Verify shows actual command results
- Real PR opened on a new branch

RepoDiet **fails** if Quick Cleanup shows complete with zero changes, buttons are enabled but backend rejects, or route files are marked safe to delete.

## Local setup

```bash
npm install
npm run typecheck
npm run build
```
