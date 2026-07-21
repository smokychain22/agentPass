# Security and Key Rotation

## Key separation (never reuse)

| Purpose | Algorithm | Env (names only) |
|---------|-----------|------------------|
| Operator commerce receipts / binding | RSA 3072 | `REPODIET_OPERATOR_PRIVATE_KEY`, `REPODIET_OPERATOR_PUBLIC_KEY` |
| Result / A2MCP receipt (Ed25519) | Ed25519 | `REPODIET_RECEIPT_PRIVATE_KEY` (+ public via trust-root) |
| Green PR delivery proof | Ed25519 | `REPODIET_GREEN_PR_PRIVATE_KEY` |
| GitHub App | RSA | `GITHUB_APP_PRIVATE_KEY_BASE64` |

**Forbidden:** reusing `GITHUB_APP_PRIVATE_KEY_BASE64` for receipt/operator signing.

## Trust root

- `GET /api/okx/trust-root` publishes **public** keys / fingerprints and key IDs only
- Production must pin verifier public key; do not derive verifier material from private keys at runtime
- Rotation model:
  1. Publish new key ID as `current`
  2. Keep previous key ID as `retired` for verification of historical receipts only
  3. Retired keys must not remain advertised as current signing keys
  4. After grace window, stop accepting new signatures from retired IDs

## Dispatch / callback token exposure

A previous public deep-scan response could expose `dispatchToken`.

Mitigations in this branch:

1. Public `/api/deep-scans/{id}` uses allowlisted DTO — no `dispatchToken`, `claimToken`, `leaseToken`
2. On READY ingest, dispatch nonce is cleared / marked invalidated
3. Assume historical tokens compromised — do not reprint values; rely on TTL + invalidation
4. Worker callbacks require scoped auth + task/scan correlation checks

## Logging / Sentry

Never log:

- payment signatures
- private keys
- authorization headers
- callback / dispatch / claim tokens
- full repository secrets

Telemetry redaction: `src/lib/okx/marketplace-telemetry.ts`  
Log redaction: `src/lib/github/log-redaction.ts`

## Payment safety

- No automated mainnet payments
- No private keys in tests
- Testnet mode must never emit production network/asset terms
- Production mode must never emit testnet terms
- Receiving address is env-configured EVM address only
