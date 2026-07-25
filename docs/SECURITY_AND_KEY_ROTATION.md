# Security and Key Rotation

## Removed attack surface

The following production routes and their supporting code have been deleted — they were one-off
shortcuts scoped to a single customer or a single historical incident, not general product
capability:

- `POST /api/github/repository-repair` and `src/lib/github/repository-repair.ts`
  (`applyMeridianBaselineRepair`) — hard-coded to `velz-cmd/Meridian` and to a fixed bundle of
  patch files checked into `meridian-repair/`.
- `POST /api/internal/a2mcp/quick-triage-diagnostic`
- `POST /api/internal/a2mcp/verify-diagnostic`
- `POST /api/internal/a2mcp/recover-incident-payment` — gated on hard-coded
  `INCIDENT_QUOTE_ID` / `INCIDENT_PAYMENT_REFERENCE` / `INCIDENT_REQUEST_DIGEST` constants for one
  specific transaction.

Post-deploy verification (`scripts/a2mcp-production-validation.ts`) asserts all of these now return
`404` in production.

## Repository authorization

`isPrivilegedRepository` (`src/lib/product/bypass-audit.ts`) always returns `false` — no repository
name or owner is ever granted special production behavior. Repository identity for durable records
is bound to GitHub's immutable numeric repository ID, not just owner/name, so a rename cannot be
used to impersonate a different repository, and a freed name reused by a different account is
never treated as the same repository (see `docs/A2MCP_API.md` and
`src/lib/github/refresh-repo-identity.ts`).

## Internal diagnostic secrets

Any remaining internal/diagnostic surface must:

- require `REPODIET_INTERNAL_DIAGNOSTIC_SECRET` matched via a header comparison, never enabled
  publicly in production, and default-closed on missing configuration
- never move funds, create a quote, or create a payment record
- be rotated by regenerating the secret in the hosting platform's environment configuration and
  redeploying — there is no code-level allowlist tied to a specific token value

## Wallet and payment identities

Production payment flows are pinned to one payer, one seller (`payTo`), one network
(`eip155:196`), and one asset (`0x779ded0c9e1022225f8e0630b35a9b54be713736`). Settlement code
rejects any request whose payer, recipient, network, or asset does not match the quote exactly —
see `test/a2a-funding.test.ts` ("wrong payer is rejected", "wrong recipient is rejected", "wrong
network or asset is rejected").
