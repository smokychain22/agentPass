# RepoDiet Green PR Protocol

**Proof-carrying maintenance for AI-built software.**

RepoDiet is an autonomous cleanup contractor. A buyer does not pay for another code-health report; it pays for a bounded, review-ready GitHub pull request whose scope, checks, payment, and provenance can be verified by another agent.

> OKX.AI Genesis Hackathon · Software Utility · A2A delivery + A2MCP verification

## The contract

Every paid cleanup begins with a versioned `repodiet.contract/v1` document that pins:

- repository, branch, project root, and exact source commit;
- finding IDs, allowed and protected paths, operation types, and change budgets;
- required baseline, patched, and GitHub checks;
- isolated-branch, pull-request, rollback, and acceptance rules; and
- the OKX ASP, service, quote, payer, recipient, asset, network, amount, and expiry.

The canonical contract digest is bound into the quote before funding. The executor can only dispatch the signed scope. RepoDiet never pushes directly to `main` and never auto-merges.

## Separation of powers

1. **Planner** proposes and canonicalizes the maintenance contract.
2. **Executor** applies only contract-authorized operations in an isolated branch.
3. **Verifier** independently recomputes scope, baseline-versus-patched results, required GitHub checks, new diagnostics, payment binding, and receipt validity.
4. **Attestor** signs an in-toto-style statement in a DSSE envelope with a key separate from the receipt signer.
5. **Buyer agent** calls `verify_green_pr` before recommending OKX A2A acceptance.

A valid signature is not enough: the public verifier rejects signed attestations whose paths, operations, findings, budgets, commands, diagnostics, artifact digests, repository, commit, PR head, service, or payment evidence do not satisfy the original contract.

## OKX-native flow

```text
A2MCP analysis → bound quote → maintenance contract → OKX A2A order
→ isolated cleanup branch → independent verification → Green PR
→ signed receipt + DSSE attestation → A2MCP verify_green_pr → buyer acceptance
```

- **A2A service:** negotiated, repository-specific cleanup and pull-request delivery.
- **A2MCP service:** repeatable analysis plus `verify_receipt`, `verify_attestation`, and `verify_green_pr` operations.
- **Settlement:** X Layer (`eip155:196`) using the contract-bound asset and recipient.
- **Fail-closed delivery:** missing keys, evidence, source-commit agreement, required checks, or payment prevents `delivery_ready`.

RepoDiet does not claim to control OKX escrow timing or arbitration. It supplies evidence for the buyer's acceptance decision.

## Public protocol endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/.well-known/agent-card.json` | A2A capabilities and contract requirements |
| `POST` | `/api/green-pr/contracts` | Propose and canonicalize a maintenance contract |
| `POST` | `/api/green-pr/contracts/{id}/accept` | Bind the exact contract digest to its quote |
| `GET` | `/api/green-pr/contracts/{id}` | Retrieve contract and delivery state |
| `GET` | `/schemas/repodiet.contract.v1.schema.json` | Versioned contract JSON Schema |
| `POST` | `/api/a2a/tasks` | Submit a contract-bound cleanup task |
| `POST` | `/api/a2mcp/quick-triage` | Analyze or invoke Green PR verification operations |
| `POST` | `/api/attestations/verify` | Verify a stored DSSE attestation |
| `GET` | `/api/attestations/{id}` | Retrieve the machine-readable envelope |
| `GET` | `/proof/green-pr/{id}` | Human-readable public proof page |

## Local development

```bash
npm ci
npm run dev
npm run typecheck
npm run test:green-pr
npm run build
```

Contracted delivery additionally requires separate asymmetric signing identities:

```text
REPODIET_RECEIPT_PRIVATE_KEY
REPODIET_RECEIPT_PUBLIC_KEY
REPODIET_RECEIPT_KEY_ID
REPODIET_GREEN_PR_PRIVATE_KEY
REPODIET_GREEN_PR_PUBLIC_KEY
REPODIET_GREEN_PR_KEY_ID
```

Trusted public-key maps can be supplied with `REPODIET_RECEIPT_TRUSTED_PUBLIC_KEYS` and `REPODIET_GREEN_PR_TRUSTED_PUBLIC_KEYS`. Without a configured trust root, verification fails closed.

## Current scope

- Public GitHub repositories
- JavaScript and TypeScript projects
- Deterministic, bounded cleanup operations only
- Explicit human approval before PR creation
- No direct-main push and no automatic merge

## License

MIT
