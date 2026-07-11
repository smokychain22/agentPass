# RepoDiet Classification Engine

RepoDiet is a conservative repository-understanding and repair engine. Classification accuracy and false-positive prevention take priority over finding count.

## Core principle

**Never classify from one signal. Never delete from a classification alone.**

Every action requires repository-wide evidence and successful verification. Ambiguity means review, not deletion.

## Classification lifecycle

```
SIGNAL → CANDIDATE → CORROBORATED → SUPPORTED → GENERATED → VALIDATED → VERIFIED → APPROVED → DELIVERED
```

RepoDiet never jumps from SIGNAL to SAFE. Automatic cleanup requires STRONG fused evidence, no contradictory counter-evidence, transformer preflight, and verification.

## 1. Repository Model schema

Persisted per commit SHA via `buildRepositoryModel()` (`src/lib/repository-model/`):

| Section | Fields |
|---------|--------|
| Identity | owner, repository, branch, commit SHA, default branch, visibility, scan timestamp |
| Structure | package.json roots, workspaces, lockfiles, framework roots, test/example/generated dirs |
| Files | path, hash, language, generated/binary/protected flags, framework role, entry-point status |
| Symbols | declarations, imports, exports, dynamic references |
| Relationships | static/dynamic import edges, config refs, script refs, route relationships |
| Runtime | package scripts, build/test/typecheck commands |

## 2. Project-root detection

Rules in `src/lib/repository-model/primary-root.ts` and `project-graph.ts`:

- Detect via `package.json`, workspaces, `turbo.json`, `nx.json`, framework configs, `app/`, `pages/`, `src/`, `packages/`
- Classify roles: primary_application, workspace_package, library, CLI, example, archive, unknown
- Mirror/nested copies excluded via `collectMirrorPrefixes` + `filterFindingsToPrimaryRoot`
- All findings scoped to selected primary root

## 3. Framework entry-point rules

`src/lib/repository-model/detect-entrypoints.ts` + `src/lib/findings/framework-protected.ts`:

- Next.js App Router: `page.*`, `layout.*`, `route.*`, `middleware.*`, `instrumentation.*`, `public/**`
- Package.json `main` / `module` / `exports` / `bin`
- CLI, workers, test setup, Storybook, migrations
- Convention-based entry points cannot be marked unused from static imports alone

## 4. Reference channels supported

| Channel | Implementation |
|---------|----------------|
| Static imports | Knip, internal import graph, `inbound_refs` signals |
| Dynamic imports | `grepRepoForStrings` + dynamic pattern scan (`counter-evidence.ts`) |
| Configuration | package.json, tsconfig, next/vite/eslint/tailwind configs |
| Scripts | package.json scripts, CI workflows (partial) |
| Package exports | package.json main/module/exports/bin |
| Framework conventions | `detectEntrypointRole`, protected path rules |
| Assets | Partial via string search |

Incomplete channels block STRONG grade for destructive types.

## 5. Protected-path rules

`src/lib/findings/confidence-path-rules.ts`:

Protected by default: env files, routes, layouts, API handlers, middleware, framework config, lockfiles, CI, Docker, migrations, auth, public assets, database schema.

Protected means: no automatic deletion; specialized transformer + user approval required.

## 6. Evidence model

```typescript
interface EvidenceBundle {
  analyzerEvidence: EvidenceItem[];
  graphEvidence: EvidenceItem[];
  frameworkEvidence: EvidenceItem[];
  configurationEvidence: EvidenceItem[];
  scriptEvidence: EvidenceItem[];
  runtimeEvidence: EvidenceItem[];
  gitEvidence: EvidenceItem[];
  counterEvidence: EvidenceItem[];
  unresolvedRisks: string[];
  grade: "strong" | "moderate" | "weak" | "contradictory" | "insufficient";
  classificationState: ClassificationState;
  classificationLabel: ClassificationLabel;
  decisionReason: string;
  autoFixAllowed: boolean;
}
```

Fusion in `src/lib/evidence/decision-matrix.ts` — no arbitrary confidence percentages.

## 7. Category decision matrices

| Category | AUTO_FIX requires | Default label |
|----------|-------------------|---------------|
| unused_import | STRONG + preflight + transformer | unused_import_confirmed |
| unused_file | STRONG + native + zero inbound + no counter | potentially_unreferenced → eligible_for_removal |
| orphan_pattern | Never automatic | potential_orphan |
| duplicate_code | Never automatic (exact dup review-first) | exact_duplicate / near_duplicate |
| unused_dependency | Never automatic | unused_dependency_suspected |
| protected path | Never | protected |

Fallback-only analyzers cap at `insufficient` or `contradictory`.

## 8. Transformer preflight model

Preflight via `enrichFindingsWithPreflight` — signals `preflight=actionable_candidate` or `blockerCode=...`.

Evidence engine requires preflight for destructive AUTO_FIX except unused imports.

## 9. Deletion Proof format

`src/lib/evidence/deletion-proof.ts` — stored on findings with `unused_file` candidates:

- Why believed unnecessary
- Analyzers agreeing
- Entry points / imports / dynamic / config / scripts / exports checked
- Protection status
- Verification commands required
- `approvedForAutomaticDeletion` boolean

No Deletion Proof → no automatic file deletion.

## 10. Verification policy

`CATEGORY_VERIFICATION` in `src/lib/evidence/types.ts`:

- unused_import: parse, typecheck, build
- unused_file: import_graph, route_comparison, typecheck, build, tests
- unused_dependency: clean_install, lockfile, typecheck, lint, build
- duplicate_code: reference_update, canonical_export, typecheck, build

Statuses: passed | failed | unavailable | skipped | timed_out | blocked. Unavailable never becomes passed.

## 11. Test corpus

Existing fixtures under `test/` and `scripts/e2e-fixture/`:

- `evidence-classification.test.ts` — decision matrix unit tests
- `correctness-fixtures.test.ts`, `strict-mode.test.ts`, `repair-engine.test.ts`
- E2E: `npm run test:e2e-fixture`

Ground-truth corpora for Next.js, monorepo, dynamic imports, protected routes — expand incrementally.

## 12. False positives prevented

| Risk | Mitigation |
|------|------------|
| Framework route deleted | Protected path + entry-point counter-evidence |
| Fallback orphan auto-deleted | Fallback → contradictory grade |
| package.json export file deleted | Export counter-evidence |
| Dynamic import file deleted | Dynamic reference scan |
| Near-duplicate merged | Review-first only |
| Unused dep removed | Never AUTO_FIX |

## 13. Unsupported patterns

- Full webpack context / `import.meta.glob` resolution (grep heuristic only)
- Environment-selected module branches
- Symlink-aware path resolution (partial)
- LLM-only bug classification (not authorized for deletion)
- Autonomous near-duplicate consolidation
- Git-age-based deletion

## 14. Performance limits

- `TOOL_TIMEOUT_MS`: 120s per analyzer
- Counter-evidence grep: bounded file scan, 40 hit limit
- AST/import caches keyed by commit SHA (repository model)
- Large repos: project-root parallelism, incomplete analysis disables AUTO_FIX

## 15. Remaining risks

- String-based reference search can miss obfuscated paths
- Monorepo cross-package dynamic imports may need manual review
- jscpd near-duplicates remain noisy — downgraded to review
- Verification unavailable in cloud scan environment blocks delivery, not classification

## 16. Production E2E results

Run after integration:

```bash
npm run typecheck
npm run test
npm run test:e2e-fixture
```

Evidence enrichment runs in `runFindingsEngine` after strict mode, before lifecycle enrichment.

## Integration points

```
findings-engine:
  analyzers → normalize → enrichers → preflight → canonical → strict
  → enrichFindingsWithEvidence → lifecycle → summary
```

User-facing detail: `FindingDetail` shows classification, counter-evidence, deletion proof.
