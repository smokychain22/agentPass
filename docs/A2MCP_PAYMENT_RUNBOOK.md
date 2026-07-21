# A2MCP Payment Runbook

## Purpose

Validate RepoDiet A2MCP Quick Triage payment interoperability with OKX OnchainOS **without** auto-paying.

## Staging / preview (testnet)

1. Deploy a preview with:
   - `REPODIET_PAYMENT_ENV=testnet`
   - `REPODIET_PAYMENT_NETWORK=eip155:1952`
   - `REPODIET_PAYMENT_CHAIN_ID=1952`
   - `REPODIET_PAYMENT_ASSET=0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`
   - Valid `PAY_TO_ADDRESS` (EVM)

2. Quote only (does not sign or pay):

```bash
onchainos payment quote \
  "https://<preview-domain>/api/a2mcp/quick-triage" \
  --method POST \
  --param "repositoryUrl=https://github.com/velz-cmd/repodiet-e2e-test" \
  --param "branch=main" \
  --param "maximumFindings=3" \
  --param "operation=analyze_repository"
```

### Expected after Phase 1 fix

- CLI accepts `PAYMENT-REQUIRED`
- Displays canonical quote / payment ID
- Does **not** report `no accepts[] array`
- Network / asset / amount / payee match testnet configuration
- Quoting does not sign or pay

### Invalid requests (before 402)

Malformed URL, SSRF targets, private repos, bad branch → HTTP 4xx **without** payment challenge.

## STOP — owner confirmation required

Do **not** run `onchainos payment pay` (or any mainnet payment) unless an owner explicitly authorizes a **testnet** payment.

After an explicitly authorized testnet payment, verify:

1. Paid retry → HTTP 200
2. ≤ 3 structured findings (when `maximumFindings=3`)
3. Immutable commit SHA present
4. Transaction / payment reference present
5. Signed receipt returned
6. Receipt verifies via public verifier
7. Health updates `lastPaidCallAt` / last successful paid call
8. Identical replay returns cached result — **no second charge**

## Production

See `docs/OKX_LISTING_READINESS.md`. Production mainnet switch and live payment require explicit owner approval. This agent must not execute `onchainos payment pay` or change marketplace registration.
