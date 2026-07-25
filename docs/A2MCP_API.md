# A2MCP API — Quick Triage

## What it does

Fast paid repository triage that returns evidence-backed findings, exact commit coverage,
limitations, and a signed result.

## Public identity

- OKX A2MCP Service ID: `32948`
- Operation: `analyze_repository`
- Price: exactly `0.03 USD₮0` (`30000` atomic units), network `eip155:196`, asset
  `0x779ded0c9e1022225f8e0630b35a9b54be713736`

## Endpoint

`POST /api/a2mcp/quick-triage`

Unpaid requests receive a canonical x402 v2 `402` with a `PAYMENT-REQUIRED` header and JSON body
built from the same object (`buildX402ChallengeFrom402Body` /
`src/lib/payment/x402-payment-required.ts`), so the header and body can never drift. The `accepts[]`
array is always present and non-empty; payment fields are never flattened to the top level.

There is no internal diagnostic bypass route — `/api/internal/a2mcp/quick-triage-diagnostic`,
`/api/internal/a2mcp/verify-diagnostic`, and `/api/internal/a2mcp/recover-incident-payment` have
been removed. Production validation (`scripts/a2mcp-production-validation.ts`) exercises only the
public endpoint and confirms those routes now return `404`.

## Coverage is truthful, not finding-count-derived

`filesInspected` is computed from the real repository inventory
(`buildFullRepositoryInventory`, `src/lib/scanner/inventory.ts`), bounded by
`QUICK_TRIAGE_MAX_FILES_INSPECTED` (800) — never from the number of findings produced. A repository
with zero findings can still report a nonzero `filesInspected`. The coverage object
(`src/lib/a2mcp/quick-triage-bounded.ts`) always includes:

| field | meaning |
|---|---|
| `state` | `complete` \| `partial` \| `unavailable` |
| `commitSha` | exact commit the scan ran against |
| `filesDiscovered` | total files found in the repository |
| `filesInspected` | supported-source files actually analyzed, bounded by the cap |
| `supportedFilesAnalyzed` | same as `filesInspected` (explicit alias for clarity) |
| `filesSkipped` | `filesDiscovered - filesInspected` |
| `skippedClassifications` | per-kind counts with a reason (generated / vendor / binary / over-cap / …) |
| `limitations` | plain-language notes, including "only the first N were inspected" when bounded |

## Replay and idempotency

A request is keyed by `quoteId + requestHash`. Replaying an identical request against a completed
execution returns the same signed result and receipt — it never re-executes the scan, never
re-charges, and never issues a second quote.
