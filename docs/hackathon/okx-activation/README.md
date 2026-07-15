# OKX activation evidence index

Canonical production origin: **https://skillswap-virid-kappa.vercel.app**

## Identities

| Role | ID |
|------|-----|
| ASP Agent | **5283** |
| A2A Verified Cleanup PR | **32947** |
| A2MCP Quick Triage | **32948** |

Historical A2A ID **32913** is non-authoritative and must not appear in public copy.

## Final public service model

1. **A2MCP Quick Triage** — `analyze_repository` — **0.03 USD₮0** per call — live x402 on X Layer — bounded triage (up to five prioritized findings).
2. **A2A Verified Cleanup PR** — `create_cleanup_pr` — **negotiated** (default reference **1 USD₮0**) — task agreement, escrow, delivery, buyer acceptance, release.

Protocol distinction: A2MCP is standardized pay-per-call; A2A is customized escrow delivery. Not all paid tasks use x402.

## Preserved A2MCP acceptance artifacts (do not recreate)

- Quote: `quote_kpBaws-sNypi`
- Transaction: `0x068547fad27d1832e0a8d4f5f9a25b9b10ca9800646f6c83e8351ea70e9ef88b`
- Task: `task_83a1cd6430a644`
- Receipt: `receipt_OkwZLE67jSCT`
- Binding attestation: `binding_attestation_PrAfShe59R31`

## Key files

- `listing-status.json` — prepared public listing copy
- `service-identities.json` — live IDs and fee resolution
- `a2mcp-final-acceptance-result.json` — paid A2MCP + crypto evidence
- `a2a-lifecycle.md` / `a2a-lifecycle-readiness.json` — escrow → Green PR → accept → release mapping
- Production pages: `/`, `/pricing`, `/okx`, `/.well-known/agent-card.json`, `/api/tools/manifest`
