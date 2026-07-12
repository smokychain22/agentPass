# RepoDiet Accuracy Lab

The Accuracy Lab is RepoDiet's internal benchmark system for measuring **precision**, **autofix safety**, and **verification completeness** — not marketing recall claims.

## Architecture under test

```
Specialized detectors (Knip, jscpd, Madge, RepoDiet)
        ↓
Repository-context graph + Intelligence Manifest
        ↓
False-positive elimination (evidence gate)
        ↓
Evidence and confidence engine
        ↓
Risk-classified remediation (Green / Yellow / Red)
        ↓
Minimal patch generation (AST / structured edits)
        ↓
Adversarial verification (mandatory gates)
        ↓
Draft PR with proof (pr-evidence-report.md)
```

## Competitor techniques reference

| Product | What we adopt | RepoDiet improvement |
|---------|---------------|----------------------|
| CodeQL | Semantic DB, SARIF, incomplete-scan diagnostics | Normalized evidence + scan coverage status |
| Semgrep | Taint analysis, rule-defined fixes | Deterministic AST first; AI only after proof |
| SonarQube | Quality gates, new-code focus | Confidence tiers + partial-scan blocking |
| Snyk | Priority score | Priority = confidence × reachability × exposure × … |
| Knip | Project structure | Framework-aware entry points before trusting Knip |
| Madge | Dependency graph | Independent SCC verification (planned) |
| Renovate | Approval workflows | Same for cleanup PRs: propose → verify → approve |

## Benchmark corpus (planned)

Each case in `accuracy-lab/cases/` defines ground truth:

- `expectedFinding` / `expectedNonFinding`
- `expectedConfidence` tier
- `autofixAllowed` boolean
- `expectedChangedFiles`
- `requiredVerification` commands
- `remediationClass` (green | yellow | red)

### Case categories

1. True unused files
2. Files that look unused but are framework entry points (false positive traps)
3. True unused dependencies
4. Dependencies referenced only in npm scripts
5. Dynamic imports
6. TypeScript path aliases
7. Workspace package references
8. Public package exports
9. Circular dependencies
10. Benign cycles with runtime effects
11. Exact vs intentional duplication
12. Generated code
13. Security source-to-sink (future Semgrep integration)
14. Near-miss negatives
15. Fixes that compile but change behavior
16. Fixes that pass tests but break public APIs

## Release targets

| Metric | Target |
|--------|--------|
| Displayed findings precision | ≥ 95% |
| Automatic-fix eligibility precision | ≥ 99% |
| Opened PRs passing verification gates | 100% |
| Incomplete scans showing "clean" | 0 |
| High-confidence without inspectable evidence | 0 |
| Recall | Reported transparently per rule family |

## Running benchmarks

```bash
npx tsx accuracy-lab/run-benchmark.ts
```

(Currently smoke-runs case schema validation; full corpus execution is incremental.)

## Connected fixture

`velz-cmd/repodiet-e2e-test` remains a **smoke** fixture for the connected GitHub account. It is not the complete accuracy benchmark — the Lab corpus above is authoritative.
