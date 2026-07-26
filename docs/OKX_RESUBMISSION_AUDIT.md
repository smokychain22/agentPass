# RepoDiet OKX Resubmission Audit

Last verified: 2026-07-26

## Pinned production identities

| Resource | Canonical value |
| --- | --- |
| ASP Agent | `5283` |
| A2A service | `32947` |
| A2A operation | `create_cleanup_pr` |
| A2MCP service | `32948` |
| A2MCP operation | `analyze_repository` |
| Seller wallet | `0x1339724ada3adf04bb7a8ccc6498216214bbdf90` |
| Registered communication address | `0x185d96f1ccbae299263e789349028ef9569f9d22` |
| Production origin | `https://skillswap-virid-kappa.vercel.app` |

No replacement Agent or service IDs may be created.

## Confirmed production behavior

- The public Agent Card exposes the pinned Agent and service IDs.
- An unpaid `POST /api/a2mcp/quick-triage` returns HTTP 402.
- The x402 challenge binds the canonical production resource, POST method, X Layer mainnet, the official USD₮0 asset, 30,000 atomic units, and the seller wallet.
- HTTP A2A discovery intake acknowledges a valid discovery request without starting a scan, payment, branch, or pull request.

These HTTP checks prove endpoint reachability. They do not prove that the official OKX seller runtime is online.

## Blocking official A2A identity defect

The seller wallet session restores the expected seller wallet, but the supported CLI does not expose Agent 5283 as the current seller ASP. Agent 5283's stored communication key cannot sign as its registered communication address. The same control check succeeds for the buyer Agent 5295.

The current OKX identity update command does not allow changing an Agent role or communication address. No supported client-side key rotation or communication-address rebind command is available.

Required OKX owner action:

1. Preserve Agent `5283`, A2A service `32947`, A2MCP service `32948`, listing history, and service metadata.
2. Restore Agent `5283` to the seller wallet account.
3. Rotate or rebind Agent `5283` to a communication key whose recovered signer exactly matches its registered communication address.
4. Confirm the seller ASP gate passes before marketplace retesting.

Do not resubmit the listing until this binding is repaired and a live availability task receives an official acknowledgement.

## Health contract

RepoDiet now fails closed. Public HTTP traffic and A2MCP 402 responses cannot mark the official seller Agent online.

`agentOnline`, `onchainOsAuthenticated`, and A2A runtime readiness require a short-lived authenticated heartbeat that is bound to:

- Agent `5283`
- A2A service `32947`
- the seller wallet
- the registered communication address
- the recovered communication signer
- an active official task watch
- a ready XMTP client

An absent, expired, or mismatched heartbeat keeps A2A readiness false and raises the silent-timeout alert.

## Remaining acceptance gates

1. Repair the Agent 5283 seller communication-key binding.
2. Start the isolated persistent seller runtime and its authenticated heartbeat.
3. Prove an official no-funding A2A availability response under 10 seconds.
4. Complete one controlled 1 USD₮0 A2A escrow, delivery, acceptance, and release using `velz-cmd/repodiet-e2e-test`.
5. Complete one fresh 0.03 USD₮0 A2MCP canary and prove identical replay causes no second settlement or scan.
6. Resubmit the existing ASP 5283 only after all production evidence is stored.
