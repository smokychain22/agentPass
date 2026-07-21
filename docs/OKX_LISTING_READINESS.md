# OKX Listing Readiness

**Status:** Not production-ready until every Definition of Done gate below has evidence.  
**Starting main SHA (this workstream):** `64d034605b4a26eebc0cafcdda901f68db8ff1f4`  
**Identities:** ASP Agent 5283 · A2A 32947 · A2MCP 32948  
**Production domain:** https://skillswap-virid-kappa.vercel.app  
**Controlled test repo:** https://github.com/velz-cmd/repodiet-e2e-test (`main`)

## Automated vs owner-approved actions

| Action | Automated tests | Requires explicit human approval |
|--------|-----------------|----------------------------------|
| Unpaid 402 / PAYMENT-REQUIRED decode | Yes | No |
| `onchainos payment quote` (no pay) | Staging CLI | No funds |
| `onchainos payment pay` | **Never automated** | **Yes — owner only** |
| Switch Vercel production to mainnet terms | No | **Yes** |
| Change OKX marketplace registration | No | **Yes — out of scope for agents** |
| Merge cleanup PR on third-party repo | No | Forbidden |
| Real marketplace A2A escrow acceptance | No | **Yes** |

## A2MCP listing gate (production)

Before marketplace submission verify:

1. Public HTTPS endpoint reachable globally
2. Correct production domain
3. Unpaid valid request → HTTP 402
4. `PAYMENT-REQUIRED` decodes to canonical `{ x402Version: 2, resource, accepts: [...] }`
5. Network exactly `eip155:196`
6. Asset exactly `0x779ded0c9e1022225f8e0630b35a9b54be713736`
7. Amount `30000` (0.03 USD₮0) matches OKX service registration
8. Receiving address matches `OKX_AGENTIC_WALLET_ADDRESS` / `PAY_TO_ADDRESS`
9. No testnet fallback in production mode
10. Health: `unpaidChallengeHealthy` / `configurationReady` truthfully reported
11. Receipt verification endpoint works
12. Replay does not double-charge (proven in automated tests + one authorized paid retry)
13. Agent 5283 callable; service 32948 points at final endpoint

## A2A marketplace gate

Using an owner-controlled buyer and the controlled test repository:

1. Create / assign marketplace task
2. Negotiate scope + versioned quote
3. Confirm marketplace escrow
4. Analysis → cleanup approval → branch → verification → PR
5. Delivery → acceptance → terminal state
6. Genuine review only after real completion

Do **not** claim A2A production readiness until this path is observed end-to-end.

## Environment variable names (never commit values)

- `REPODIET_PAYMENT_ENV` (`testnet` | `production`)
- `REPODIET_PAYMENT_MODE` (`testnet` | `mainnet`)
- `REPODIET_PAYMENT_NETWORK`
- `REPODIET_PAYMENT_CHAIN_ID`
- `REPODIET_PAYMENT_ASSET`
- `OKX_AGENTIC_WALLET_ADDRESS` / `PAY_TO_ADDRESS` / `REPODIET_PAY_TO`
- `OKX_API_KEY` / `OKX_SECRET_KEY` / `OKX_PASSPHRASE`
- `REPODIET_OPERATOR_PRIVATE_KEY` / `REPODIET_OPERATOR_PUBLIC_KEY`
- `REPODIET_RECEIPT_PRIVATE_KEY` / `REPODIET_GREEN_PR_PRIVATE_KEY`
- GitHub App vars (`GITHUB_APP_*`) — never reuse `GITHUB_APP_PRIVATE_KEY_BASE64` for receipt signing
