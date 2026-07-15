# A2A Verified Cleanup PR lifecycle

Canonical production: https://skillswap-virid-kappa.vercel.app  
ASP **5283** · A2A **32947** · operation `create_cleanup_pr`

## Required flow

```text
buyer creates A2A task
→ seller accepts or negotiates scope
→ funds enter escrow
→ RepoDiet creates a real Green PR
→ seller submits delivery evidence
→ buyer inspects and accepts
→ escrow releases to seller
→ receipt and task evidence are recorded
```

## RepoDiet API mapping

| Step | Surface |
|------|---------|
| Buyer creates task / seller binds scope | `POST /api/green-pr/contracts` → accept → `POST /api/okx/a2a/orders` (`escrowReference` optional) |
| Funds enter escrow | OKX-native escrow (external). Bound as `escrowReference` on the order/task settlement. |
| Create real Green PR | Fund → execute → `POST .../approve` → `createCleanupPullRequest` + CI monitor |
| Seller submits delivery evidence | Auto on `delivery_ready`, or `POST /api/okx/a2a/tasks/{taskId}/delivery` |
| Buyer inspects and accepts | `POST /api/okx/a2a/tasks/{taskId}/accept` |
| Escrow releases to seller | OKX-native release, then `POST /api/okx/a2a/tasks/{taskId}/release` with `escrowReleaseReference` |
| Receipt / evidence | Task poll + `GET /api/okx/receipts/{id}` + Green PR attestation |

## Status machine (settlement portion)

`delivery_ready` → `delivery_submitted` → `buyer_accepted` → `completed` (with `escrow_released` transition)

`delivery_ready` is **not** terminal. Quote entitlement closes only after escrow release is recorded.

## Honest boundary

RepoDiet creates the real GitHub Green PR and durable settlement evidence.  
OKX marketplace escrow lock/release remains OKX-native; RepoDiet records the references and gates seller settlement evidence on buyer acceptance.
