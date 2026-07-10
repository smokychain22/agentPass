# RepoDiet Production Audit

Audit date: 2026-07-10  
Branch audited: `cursor/production-audit-39ce`  
Production URL: `https://skillswap-skillswap7.vercel.app/`

This document classifies every user-visible capability as **REAL**, **PARTIAL**, **DEMO**, **COSMETIC**, **FAKE**, or **BROKEN** based on code-path inspection — not UI labels or README claims.

## Classification key

| Class | Meaning |
|-------|---------|
| REAL | Fully backed by production code and real data |
| PARTIAL | Some backend exists; end-to-end flow incomplete |
| DEMO | Works only with seeded/demo repository |
| COSMETIC | UI exists; no real backend action |
| FAKE | Static, timer-driven, mocked, or unsupported |
| BROKEN | Code exists but fails in production serverless |

---

## Capability audit table

| Capability | UI Location | Frontend Handler | API Route | Backend Module | Persistent? | Production Tested? | Classification | Problem | Required Fix |
|------------|-------------|------------------|-----------|----------------|-------------|-------------------|----------------|----------|--------------|
| Public GitHub URL scan | `/app` Scan tab | `runScan()` → `src/lib/scan.ts` | `POST /api/jobs/scan` | `src/lib/jobs/run-scan-job.ts` → `runBasicScan()` | Yes — `data/db.json` jobs | Local only | **REAL** | Structure scan only; analyzers run on Findings step | — |
| Repository ZIP fetch | Scan/Findings | job polling | `prepareRepoWorkspace()` | `src/lib/github/fetch-repo-zip.ts` | N/A | Local | **REAL** | Public GitHub only | — |
| Framework detection | Scan results | session state | `runBasicScan()` | `src/lib/scanner/detect-framework.ts` | No | Local | **REAL** | — | — |
| Package manager detection | Scan results | session state | `runBasicScan()` | `src/lib/scanner/detect-package-manager.ts` | No | Local | **REAL** | — | — |
| File tree inspection | Scan results | session state | `runBasicScan()` | `src/lib/scanner/file-tree.ts` | No | Local | **REAL** | — | — |
| Findings analysis | `/app` Findings tab | `runFindingsAnalysis()` | `POST /api/jobs/findings` | `src/lib/findings/findings-engine.ts` | Yes — `data/db.json` findings | Local only | **REAL** | Long-running on serverless | Monitor Vercel timeouts |
| Findings retrieval by scanId | JSON export / tools | fetch | `GET /api/findings/[scanId]` | `src/lib/findings/findings-store.ts` | Yes — durable store | Local | **PARTIAL→REAL** | Was in-memory only; now file-backed | Verify on multi-instance Vercel |
| Knip analyzer | Findings pipeline | job stage `knip` | findings job | `src/lib/findings/run-knip.ts` | N/A | Local | **REAL** | May fallback on Vercel | UI shows fallback label |
| jscpd analyzer | Findings pipeline | job stage `jscpd` | findings job | `src/lib/findings/run-jscpd.ts` | N/A | Local | **REAL** | May fallback | UI shows fallback label |
| Madge analyzer | Findings pipeline | job stage `madge` | findings job | `src/lib/findings/run-madge.ts` | N/A | Local | **REAL** | May fallback | UI shows fallback label |
| AI-slop heuristics | Findings pipeline | job stage `heuristics` | findings job | `src/lib/findings/ai-slop-heuristics.ts` | N/A | Local | **REAL** | Heuristic by design | — |
| Fallback analyzers | Findings banner | `analyzerStageLabel()` | normalize | `src/lib/findings/fallback/*` | N/A | Local | **REAL** | Not native tool output | Never label as native Knip/jscpd/Madge |
| Findings table/filters | Findings workspace | client state | — | `src/components/app/findings/*` | Session only | Local | **REAL** | Lost on refresh | Optional session restore |
| JSON export | Findings tab | download blob | — | `json-export.tsx` | From live findings | Local | **REAL** | — | — |
| Scan progress stages | Scan tab loading | `pollJob()` | `GET /api/jobs/scan/[jobId]` | `src/lib/jobs/job-store.ts` | Yes | Local | **REAL** (fixed) | Was `setInterval` fake timers | Removed fake timers |
| Findings progress stages | Findings loading | `pollJob()` | `GET /api/jobs/findings/[jobId]` | job store | Yes | Local | **REAL** (fixed) | Was cosmetic timers | Backend-driven stages |
| Patch Kit progress | Patch tab loading | `pollJob()` | `GET /api/jobs/patch/[jobId]` | `run-patch-job.ts` | Yes | Local | **REAL** (fixed) | Was cosmetic timers | Backend-driven stages |
| Patch bundle generation | Patch Kit tab | `runPatchKitGeneration()` | `POST /api/jobs/patch`, `POST /api/patches/generate` | `src/lib/patch-kit/patch-kit-engine.ts` | Yes — artifacts on disk | Local | **REAL** | Patch is command-style unified diff, not full hunks | Conservative by design |
| Patch git apply validation | Patch job | poll result | patch job | `src/lib/patch-kit/validate-patch.ts` | Stored in job | Local | **REAL** (added) | Was missing | `git apply --check` in isolated copy |
| Bundle download | Patch Kit | `downloadPatchKitZip()` | `GET /api/patches/[patchId]/download` | `patch-kit-store.ts` + `data/artifacts/` | Yes | Local | **REAL** | — | — |
| 7 bundle artifacts | Patch workspace | client render | patch engine | `generate-*.ts`, `generate-bundle.ts` | In patch payload | Local | **REAL** | `repodiet-cleanup.patch` uses `git rm` + stub hunks | Document as review-first |
| Verification plan UI | Verify tab | manual checklist | — | `verify-tab.tsx` | Session | Local | **PARTIAL** | Manual checklist only | Renamed honestly |
| Automated verification | Verify tab button | `runVerification()` | `POST /api/verify/run` | `src/lib/verify/run-verification.ts` | Yes — verifications record | Local | **PARTIAL** | No dependency install on serverless; limited script allowlist | Document limitations |
| GitHub cleanup PR | Patch Kit Operator | `runCreateCleanupPr()` | `POST /api/tools/create_cleanup_pr` | `src/lib/operator/create-cleanup-pr.ts` | No | Env-dependent | **PARTIAL** | Requires GitHub App env + user install | Configure `GITHUB_APP_*` |
| GitHub App install | Patch Kit | `startGitHubAppInstall()` | `/api/github/install` | `src/lib/github-app/*` | Cookie session | Env-dependent | **PARTIAL** | Requires app registration | — |
| Demo repository scan | Landing + Scan CTA | `isDemoRepoUrl()` | demo workspace | `src/lib/demo/paths.ts` | Local copy | Local | **DEMO** | Seeded workspace | Badge shown in findings |
| Landing demo metrics | Landing page | static import | `GET /api/demo/stats` | `src/lib/demo/scan-stats.json` | Static file | N/A | **DEMO** | Hardcoded demo counts | Only on landing/demo CTAs |
| Landing artifact previews | Landing bundle section | links | `GET /api/demo/sample-bundle` | `public/demo/*` | Static | N/A | **DEMO** | Sample bundle only | Label as sample |
| Hero terminal animation | Landing | CSS/timer | — | `hero-terminal.tsx` | N/A | N/A | **COSMETIC** | Marketing animation | Acceptable on landing |
| Workflow pipeline animation | Landing | CSS | — | `workflow-pipeline.tsx` | N/A | N/A | **COSMETIC** | Marketing | Acceptable on landing |
| Pricing USDT tiers | `/pricing` | static cards | — | `content.ts` | N/A | N/A | **COSMETIC** | No x402 gating on Next APIs | Label as proposed pricing |
| Wallet / payment unlock | Pricing CTAs | none | — | — | No | No | **FAKE** on Next | Legacy `server.js` has demo x402 header only | Remove purchase CTAs or implement gating |
| OKX A2MCP tool endpoints | `/okx`, `/api/tools/*` | HTTP | `src/app/api/tools/*` | `src/lib/a2mcp/tools/*` | No per-call | Local | **REAL** | Not marketplace-listed | Run `verify:okx` script |
| OKX manifest | External agents | fetch | `GET /api/tools/manifest` | `tool-manifest.ts` | N/A | Local | **REAL** | — | — |
| `scan_repo_bloat` mode param | A2MCP | — | tools route | `scan-repo-bloat.ts` | N/A | Local | **FAKE** | `quick\|full` accepted but ignored | Implement or remove param |
| Rate limiting | APIs | — | all job/patch/verify routes | `src/lib/security/rate-limit.ts` | Yes — usage buckets | Local | **REAL** (added) | IP-based only | Add auth-based limits later |
| ZIP-slip protection | Scan pipeline | — | unzip | `src/lib/scanner/unzip-repo.ts` | N/A | Unit | **REAL** (fixed) | Was vulnerable | Path sanitization added |
| SSRF / redirect validation | Fetch | — | fetch zip | `fetch-repo-zip.ts` | N/A | Code review | **REAL** (fixed) | Was follow-all-redirects | GitHub host allowlist |
| Job ownership | Job GET | — | job routes | `assertJobOwner()` | ownerKey=IP | Local | **PARTIAL** | IP-only, no auth | Add session auth for production |
| Session state on refresh | `/app` | React context | — | `app-session.tsx` | No | N/A | **PARTIAL** | Lost on refresh | Optional localStorage restore |
| Legacy Express API | — | — | `server.js:8788` | `lib/store.js` | Yes `db.json` | `test/smoke.js` | **PARTIAL** | Parallel stack, not Vercel primary | Document as legacy |
| Express verify endpoint | — | — | `GET /api/scans/:id/verify` | `server.js` | db.json | smoke.js | **PARTIAL** | Delta comparison only | Next verify API preferred |

---

## Fake / cosmetic features found (before fixes)

1. **Fake progress timers** in `scan.ts`, `findings/client.ts`, `patch-kit/client.ts` — `setInterval` advanced labels while a single blocking request ran.
2. **In-memory findings/patch stores** — lost on Vercel cold starts (`globalThis` Maps).
3. **"Phase 3" UI copy** — implied Patch Kit / Knip not implemented when they were.
4. **"Deep scan locked"** — no separate deep path; Knip already runs on Findings.
5. **Verify tab "Verify before merging"** — implied automated verification.
6. **Pricing USDT purchase CTAs** — no server-side payment enforcement on Next.js routes.
7. **Landing metrics** — static `DEMO_SCAN_STATS` presented as product output context.
8. **`scan_repo_bloat` mode** — ignored `quick|full` parameter.

## Demo-only features (legitimate, now isolated)

- `DEMO_REPO_URL` → local `demo-repos/repodiet-demo-slop-app` workspace
- `GET /api/demo/stats`, `GET /api/demo/sample-bundle`
- Landing terminal / bento metrics sourced from `scan-stats.json`
- `mode: "demo"` on findings payload + **DEMO REPOSITORY** banner in Findings tab

## Partial features

- **GitHub PR delivery** — real when GitHub App configured; otherwise unavailable
- **Automated verification** — `git apply --check` real; build/lint/test limited without dependency install
- **Persistence on Vercel multi-instance** — file store works locally; Vercel may need KV/Blob for cross-instance durability
- **Client session** — workflow state not restored after refresh

## Broken production features (addressed)

| Feature | Was | Fix |
|---------|-----|-----|
| `GET /api/findings/[scanId]` | In-memory only | `findings-store.ts` → `durable-store.ts` |
| Patch download after restart | In-memory ZIP | `data/artifacts/<id>.zip` |
| ZIP-slip | No path check | `unzip-repo.ts` sanitization |
| Fake analyzer completion labels | Timers | Job polling with real stages |

## Misleading copy fixed

- Removed "Phase 3" from scan/findings UI
- Renamed Verify → **Verification plan**
- Scan mode text now explains analyzers run on Findings step
- Fallback analyzer banner uses honest source labels via `analyzerStageLabel()`
- Safe candidate wording → "Candidate for developer review" in prompts

## Backend fixes implemented

1. `src/lib/store/durable-store.ts` — file-backed persistence for jobs, findings, patches, verifications, usage
2. Job API: `POST/GET /api/jobs/{scan,findings,patch}/...` with real stage updates
3. `POST /api/patches/generate`, `GET /api/patches/[patchId]/download`
4. `POST /api/verify/run` — limited automated verification
5. `src/lib/patch-kit/validate-patch.ts` — `git apply --check`
6. Analyzer truthfulness: `rawToolReports.{status,source,sourceMode,durationMs}`, finding `evidence` + `confidenceReason`
7. Security: ZIP-slip, GitHub-only fetch, redirect validation, rate limits
8. Demo isolation: `mode: "demo"|"live"` + UI badge

## Tests added

- `test/next-api.test.js` — store, demo isolation, zip-slip code checks, route existence
- `scripts/production-smoke-test.ts` — deployed domain E2E
- `scripts/verify-okx-integration.ts` — manifest + tool endpoint verification

## Known remaining limitations

1. **No wallet/x402 payment gating** on Next.js APIs — pricing is informational
2. **No private repository support** — public GitHub ZIP only
3. **Vercel serverless** — file persistence may not share across instances; consider Vercel KV + Blob
4. **Verification** — dependency install skipped in serverless; full build verification requires local execution
5. **Patch format** — conservative `git rm` + stub hunks, not full content-aware unified diffs
6. **No user authentication** — job ownership is IP-based
7. **Deployment Protection** — Vercel login wall is a dashboard setting, not app code

## End-to-end production path status

| Step | Status | Evidence |
|------|--------|----------|
| Real repo URL | **REAL** | `fetch-repo-zip.ts` |
| Safe download/extract | **REAL** | `unzip-repo.ts` + limits |
| Real/honest analyzers | **REAL** | `findings-engine.ts` + `rawToolReports` |
| Findings with evidence | **REAL** | `normalize-findings.ts` |
| Findings persist after refresh | **REAL** | `durable-store.ts` + `GET /api/findings/[scanId]` + `sessionStorage` restore |
| User selects cleanup candidates | **REAL** | Findings workspace checkboxes + `selectedFindingIds` |
| Real unified diff patch | **REAL** | `generate-unified-diff.ts` via `git diff HEAD` |
| `git apply --check` validation | **REAL** | `validate-patch.ts` + `test/unified-diff.test.js` |
| Downloadable artifact bundle | **REAL** | `GET /api/patches/[patchId]/download` |
| Isolated verification workspace | **REAL** | `run-verification.ts` |
| Build/lint/typecheck execution | **PARTIAL** | Runs after `npm install --ignore-scripts`; may fail on complex repos or timeout |
| GitHub PR after approval | **PARTIAL** | `create_cleanup_pr` when GitHub App configured |
| OKX/A2MCP same engine | **REAL** | `api/tools/*` executors |
| Payment enforcement (patch/verify) | **PARTIAL** | x402 gate on patch/verify; demo repo free; `X-RepoDiet-Demo-Pay` header for hackathon |

**Verdict:** RepoDiet is a **real analysis + patch-bundle product** with **honest fallback labeling** and **durable local persistence**. It is **not yet a fully production-hardened multi-tenant SaaS** until cross-instance persistence, payment gating, and full verification are completed and `npm run test:production` passes on the deployed domain.

---

## Code search markers

Searched patterns: `TODO`, `FIXME`, `mock`, `setInterval`, `Phase 3`, `disabled`, `placeholder`, `hardcoded`, `demo`, `fake`.

Remaining intentional demo references: `src/lib/demo/*`, landing content, `/api/demo/*`, `mode === "demo"`.

Removed fake progress: `setInterval` stage advancement removed from scan/findings/patch clients.

## Run verification locally

```bash
npm install
npm run typecheck
npm run build
REPODIET_TEST_OFFLINE=1 npm run test:next
npm run api & npm run dev &
REPODIET_PRODUCTION_URL=http://localhost:3000 npm run test:production
```
