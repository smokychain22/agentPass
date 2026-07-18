# Fix & PR payment policy (OKX A2A escrow)

## Canonical channel

| Channel | Purchase path | Payment model |
|---------|---------------|---------------|
| OKX.AI marketplace A2A (service **32947**) | Authorize ASP **5283** / operation `create_cleanup_pr` | **OKX escrow** → cleanup → PR → buyer accept → OKX release |

The website Fix & PR tab creates `purchaseChannel: "okx_marketplace"` tasks and binds an OKX order.  
**Direct USDT transfer to RepoDiet’s wallet is not a customer Fix & PR payment rail.**

## Lifecycle

1. Connect repository and scan  
2. Select suggested files and review exact cleanup  
3. Authorize RepoDiet A2A service 32947  
4. Fund OKX escrow on X Layer  
5. RepoDiet applies bounded cleanup, verifies, and opens a PR  
6. Buyer reviews the PR and accepts (or rejects / disputes)  
7. OKX releases escrow after acceptance  
8. Delivery + payment receipt are shown  

## Honest boundary

- Escrow lock/release are **OKX-native**. RepoDiet records `escrowReference` / `escrowReleaseReference` and gates execution / settlement evidence.
- RepoDiet does **not** invent escrow confirmation, acceptance, or receipts.
- A2MCP paid tools (service **32948**) continue to use official x402 `402 Payment Required` + replay of completed results — not A2A escrow.

## Preview / test mode

When `VERCEL_ENV` is `preview` or `development` (unless explicitly re-enabled):

- Escrow fund endpoints return `PREVIEW_DRY_RUN_ONLY`
- No real escrow binding, write-token minting, or GitHub mutation

## Deprecated

The former “direct-site” ERC-20 Fix & PR button and copy (“Direct payment”, “Not OKX escrow”) are removed from the customer UI. Operator/test helpers that still mention `direct_site` are not a product payment path.
