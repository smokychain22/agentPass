# RepoDiet OKX Resubmission Audit

Last verified: 2026-07-27

## Pinned production identities

| Resource | Canonical value |
| --- | --- |
| ASP Agent | `9636` |
| A2A service | `37348` |
| A2A operation | `create_cleanup_pr` |
| A2MCP service | `37347` |
| A2MCP operation | `analyze_repository` |
| Seller wallet | `0xaa895234c3fc31c40018eef975db6ac79bf87f1a` |
| Registered communication address | `0x00dbdbb36b71ace0e1fc517056f376f977d8256e` |
| Production origin | `https://skillswap-virid-kappa.vercel.app` |

Agent 9636 was registered on 2026-07-27 under the authenticated healthy account
(`officialsmokychain@gmail.com`, wallet `0xaa895234c3fc31c40018eef975db6ac79bf87f1a`) as a
replacement for Agent 5283, whose communication-key binding could not be repaired through any
official Onchain OS command (see "Legacy record" below). Registration tx:
`0x93aed3538eab509932ef1a537f6a5e5051586f41cb882ae71a96f6b141ea7abb` (SUCCESS, contract
`AgentIdentity`).

## Legacy record — Agent 5283 (superseded, not an active production identity)

| Resource | Legacy value |
| --- | --- |
| ASP Agent | `5283` |
| A2A service | `32947` |
| A2MCP service | `32948` |
| Seller wallet | `0x1339724ada3adf04bb7a8ccc6498216214bbdf90` |
| Registered communication address | `0x185d96f1ccbae299263e789349028ef9569f9d22` |

Agent 5283 and services 32947/32948 are preserved, unmodified, and untouched by the Agent 9636
registration — they live under a different wallet (`0x1339…df90`, a different OKX account/email
entirely) that this deployment's authenticated session cannot access. Do not delete, edit, close,
resubmit, or reference them as active production identities. They remain here only as a historical
record of the original listing and its rejection reason.

### Original blocking defect (Agent 5283)

The seller wallet session restored the expected seller wallet, but the supported CLI did not
expose Agent 5283 as the current seller ASP. Agent 5283's stored communication key could not sign
as its registered communication address. The current OKX identity update command does not allow
changing an Agent role, owner, or communication address, and no supported client-side key rotation
or communication-address rebind command exists. This defect is the reason Agent 9636 was
registered as a replacement rather than continuing to pursue a repair of Agent 5283.

## Confirmed production behavior

- The public Agent Card exposes the pinned Agent and service IDs.
- An unpaid `POST /api/a2mcp/quick-triage` returns HTTP 402.
- The x402 challenge binds the canonical production resource, POST method, X Layer mainnet, the official USD₮0 asset, 30,000 atomic units, and the seller wallet.
- HTTP A2A discovery intake acknowledges a valid discovery request without starting a scan, payment, branch, or pull request.

These HTTP checks prove endpoint reachability. They do not prove that the official OKX seller runtime is online.

## Health contract

RepoDiet fails closed. Public HTTP traffic and A2MCP 402 responses cannot mark the official seller Agent online.

`agentOnline`, `onchainOsAuthenticated`, and A2A runtime readiness require a short-lived authenticated heartbeat that is bound to:

- Agent `9636`
- A2A service `37348`
- the seller wallet
- the registered communication address
- the recovered communication signer
- an active official task watch
- a ready XMTP client

An absent, expired, or mismatched heartbeat keeps A2A readiness false and raises the silent-timeout alert.

## Remaining acceptance gates

1. Start the isolated persistent seller runtime for Agent 9636 and its authenticated heartbeat.
2. Prove an official no-funding A2A availability response under 10 seconds.
3. Prove an unpaid A2MCP request returns a correctly bound x402 402 challenge for service 37347.
4. Complete one controlled 1 USD₮0 A2A escrow, delivery, acceptance, and release using `velz-cmd/repodiet-e2e-test`.
5. Complete one fresh 0.03 USD₮0 A2MCP canary and prove identical replay causes no second settlement or scan.
6. Submit the new ASP 9636 only after all production evidence is stored.
