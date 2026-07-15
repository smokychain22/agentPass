# A2A controlled test-price acceptance

Canonical production: https://skillswap-virid-kappa.vercel.app  
ASP **5283** · A2A **32947** · operation `create_cleanup_pr`

## Env policy

| Variable | During acceptance | After acceptance passes |
|----------|-------------------|-------------------------|
| `REPODIET_A2A_TEST_PRICE` | `1` (quotes **0.20 USDT**) | **Remove** |
| `REPODIET_X402_TEST_MODE` | optional helper | **Remove** |
| `REPODIET_X402_TEST_SECRET` | optional helper | **Remove** |
| `ALLOW_INTERNAL_TEST_BUYER` | `0` | **Retain `0`** |

Correct spelling: `ALLOW_INTERNAL_TEST_BUYER` (not `BUER`).

## Acceptance path

1. Buyer creates `repository.cleanup_pr` → quote at **0.20 USDT** when test price is active.
2. Pay quote (`POST /api/tasks/pay`) → `POST /api/a2a/tasks/{id}/fund` if needed.
3. Approve → real Green PR on a GitHub App–connected repo (e.g. `velz-cmd/repodiet-e2e-test`).
4. `POST .../delivery` → `POST .../accept` → `POST .../release` with escrow reference.
5. Confirm receipt / task evidence.
6. Remove the three temporary env vars; keep `ALLOW_INTERNAL_TEST_BUYER=0`.

Do not start another A2MCP paid quote for this track.
