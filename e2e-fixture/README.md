# repodiet-e2e-test

Controlled Next.js fixture for verifying [RepoDiet](https://skillswap-skillswap7.vercel.app) performs real detection, editing, deletion, verification, and PR creation.

**Every issue below is intentional.** Do not use this repository for production code.

## Repository

`https://github.com/smokychain22/repodiet-e2e-test`

## Intentional cleanup scenarios

| # | File | Issue | Expected RepoDiet action |
|---|------|-------|--------------------------|
| 1 | `src/components/Dashboard.tsx` | `Clock` imported but unused | **Edit** — remove `Clock` from import |
| 2 | `src/archive/OldDashboard.backup.tsx` | Obvious backup, unreferenced | **Delete** after safety checks |
| 3 | `src/lib/unused-helper.ts` | Unreferenced helper | **Review first** — no auto-delete |
| 4 | `StatusCard.tsx` / `StatusCardCopy.tsx` | Duplicate UI logic | **Review first** |
| 5 | `orphan-a.ts` / `orphan-b.ts` | Orphan module group | **Review first** |
| 6 | `src/app/page.tsx`, `layout.tsx` | Next.js entry points | **Protected** |
| 7 | `left-pad` in `package.json` | Unused dependency | Finding; careful removal only |

## Best first test

1. Unused `Clock` import → real edit in `Dashboard.tsx`
2. Backup file → real deletion of `src/archive/OldDashboard.backup.tsx`
3. `unused-helper.ts` → review-first, **no** automatic deletion

### Expected import edit

```diff
-import { Clock, CheckCircle } from "lucide-react";
+import { CheckCircle } from "lucide-react";
```

## Local verification

```bash
npm install
npm run typecheck
npm run build
```

## RepoDiet production flow

1. Scan this repository on `main`
2. Run Findings
3. Quick Cleanup → generate supported changes
4. Verify patch validation and real diffs
5. Create Cleanup PR on a new branch (main untouched)
