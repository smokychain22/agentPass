# A2MCP Payment Runbook

## Before initiating any new payment

Production may already contain a successful paid A2MCP event. Never authorize a new settlement
without first checking for one:

1. Look up the durable quote/payment record (`src/lib/payment/payment-store.ts`,
   `src/lib/payment/payment-execution-store.ts`) for the repository/commit in question.
2. If found, verify: payer, seller, network, asset, amount, repository, and commit all match what's
   being requested now.
3. Verify the seller actually received the on-chain transfer (`verifyOnchainUsdtTransfer`,
   `src/lib/payment/onchain-usdt.ts`).
4. Replay the identical request (same `quoteId` + `requestHash`) and confirm it returns the existing
   signed result/receipt rather than executing again.

If all of that checks out, no new payment is needed — surface the existing quote, transaction, and
receipt as evidence instead of settling again.

## If a new settlement is genuinely required

Stop and display before doing anything else:

- payer, seller, network, asset, amount
- repository, branch/ref, exact commit
- request digest, quote ID
- the specific reason the previous evidence is invalid (expired, wrong repository/commit, or none
  exists)

## Canary amount

The only authorized A2MCP canary amount is exactly `30000` atomic units (`0.03 USD₮0`). Any request
for a different amount on the canary path should be treated as a configuration error, not honored.

## What was removed

The historical incident-specific recovery route
(`/api/internal/a2mcp/recover-incident-payment`, and its hard-coded `INCIDENT_QUOTE_ID` /
`INCIDENT_PAYMENT_REFERENCE` / `INCIDENT_REQUEST_DIGEST` constants) has been deleted. It only ever
recovered one specific historical quote/transaction pair; the general mis-consumed-quote repair
mechanism (`repairMisConsumedQuote`, `src/lib/payment/quote-repair.ts`, exercised automatically by
`requireEntitlement` on retry) already handles this class of failure for any quote, without a
per-incident allowlist.
