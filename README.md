# RepoDiet Green PR Protocol

**Proof-carrying maintenance for AI-built software.**

RepoDiet is an autonomous cleanup contractor on OKX.AI (ASP **5283**). Buyers hire standardized triage or customized cleanup delivery — with an explicit protocol split.

> OKX.AI Genesis Hackathon · Software Utility · A2MCP + A2A

## Live OKX services

| Protocol | Service ID | Operation | Price | Settlement |
|---|---|---|---|---|
| **A2MCP** Quick Triage | **32948** | `analyze_repository` | **0.03 USD₮0** per call | Live x402 on X Layer |
| **A2A** Verified Cleanup PR | **32947** | `create_cleanup_pr` | **negotiated** (default **1 USD₮0**) | Task agreement → escrow → delivery → buyer acceptance → release |

**Canonical production origin:** https://skillswap-virid-kappa.vercel.app

- **A2MCP:** standardized Quick Triage pay-per-call through x402 — bounded triage returning up to five prioritized findings.
- **A2A:** customized cleanup PR delivery through negotiated task terms, escrow, and buyer acceptance — not every paid task uses x402.

Public OKX agent page (`NEXT_PUBLIC_OKX_AGENT_URL`) remains unset until `https://www.okx.ai/agents/5283` genuinely loads.

## The contract

Every paid A2A cleanup begins with a versioned `repodiet.contract/v1` document that pins repository scope, checks, payment binding, and acceptance rules. RepoDiet never pushes directly to `main` and never auto-merges.

## Separation of powers

1. **Planner** proposes and canonicalizes the maintenance contract.
2. **Executor** applies only contract-authorized operations in an isolated branch.
3. **Verifier** independently recomputes scope, baseline-versus-patched results, required GitHub checks, payment binding, and receipt validity.
4. **Attestor** signs an in-toto-style statement in a DSSE envelope with a key separate from the receipt signer.
5. **Buyer agent** calls `verify_green_pr` before recommending OKX A2A acceptance.

## OKX-native flow

```text
A2MCP Quick Triage (x402) → optional A2A negotiated cleanup
→ bound quote / escrow → isolated cleanup branch → independent verification
→ review-ready PR → signed receipt (+ Green PR attestation) → buyer acceptance
```

## Public protocol endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/.well-known/agent-card.json` | A2A/A2MCP capabilities and payment split |
| `POST` | `/api/a2mcp/quick-triage` | Paid A2MCP Quick Triage (`analyze_repository`) |
| `POST` | `/api/a2a/tasks` | Submit a contract-bound A2A cleanup task |
| `GET` | `/api/okx/trust-root` | Operator SPKI public trust root |
| `GET` | `/api/okx/receipts/{receiptId}` | Verify RSA-SHA256 execution receipts |
| `GET` | `/api/tools/manifest` | Tool schemas + two-service pricing |
| `POST` | `/api/green-pr/contracts` | Propose and canonicalize a maintenance contract |
| `GET` | `/proof/green-pr/{id}` | Human-readable public proof page |

## Local development

```bash
npm ci
npm run dev
npm run typecheck
npm run test:green-pr
npm run build
```

## Current scope

- Public GitHub repositories
- JavaScript and TypeScript projects
- Deterministic, bounded cleanup operations only
- Explicit buyer acceptance before escrow release
- No direct-main push and no automatic merge

## License

MIT
