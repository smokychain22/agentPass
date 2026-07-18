# Direct-site Fix & PR payment policy

## Channels

| Channel | Purchase path | Payment model |
|---------|---------------|---------------|
| OKX.AI marketplace A2A (service 32947) | Hire ASP 5283 on OKX | Escrow + buyer acceptance + release (OKX-native `escrowReference`) |
| Direct website Fix & PR | `/app` Fix & PR tab | **Direct** X Layer USDT ERC-20 transfer to RepoDiet recipient |

The Fix & PR screen on the website is **not** OKX escrow. Marketing copy that describes A2A as escrow refers to the OKX marketplace settlement lifecycle, not the direct-site wallet transfer button.

## When funds become final (direct site)

1. Buyer authorizes an on-chain USDT transfer for the exact `amountMicro` on the signed quote.
2. RepoDiet verifies the transfer against quote binding (recipient, asset, amount, expiry, request hash).
3. After verification, the cleanup worker may run. Funds are treated as received settlement for that quote — not held in an OKX escrow contract by RepoDiet.

## Failure / refund (direct site)

- If cleanup fails after verified payment, RepoDiet does **not** automatically reverse the on-chain transfer.
- Operator/support refunds (if any) are manual and out-of-band.
- Duplicate charging is prevented by quote binding + single-use payment reference / entitlement checks on `POST /api/tasks/pay` and task fund.

## Preview / test mode

- Preview deployments must not use live write credentials against customer repositories.
- Trusted test quotes may record a non-on-chain payment reference for UI validation only.
- Production Fix & PR with live wallet credentials can move real USDT — do not treat Production as a dry-run.

## Buyer approval

Direct-site flow still requires explicit buyer approval of proposed changes before PR creation (`awaiting_approval` → approve). That approval gates **PR creation**, not escrow release (there is no escrow on this channel).
