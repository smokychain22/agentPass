# Universal repository coverage — Phase 1

Phase 1 establishes **repository accounting**: every tracked Git path at the pinned commit receives exactly one terminal coverage outcome.

## What Phase 1 is

- Authoritative inventory from the pinned Git tree (`git ls-tree` or GitHub Trees API)
- ZIP/worktree used for materialization only
- Terminal outcomes (never bare SKIPPED/IGNORED/UNSUPPORTED/UNKNOWN/EXCLUDED)
- Analyzer registry + semantic → structural → textual → metadata fallback
- Repository Coverage UI separating accounting % from semantic %
- Existing Knip/Madge/jscpd adapters preserved; fallback findings normalized with lineage

## What Phase 1 is not

- Universal semantic language support
- Automatic cleanup for every finding
- Phase 2 language/format expansion

## Cleanup safety

Cleanup eligibility remains transformer- and preflight-gated. Accounting coverage of 100% does not make findings SAFE or cleanup-eligible.
