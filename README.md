# AgentPass

**OPC spend passport & finance control plane for OKX.AI**

> Not another swap/yield agent. The control plane every autonomous agent assumes you already have.

AgentPass lets a one-person company (OPC) set spend policy, authorize every agent payment *before* it signs an x402 transfer, settle with receipts, and export books. Built for the [OKX.AI Genesis Hackathon](https://web3.okx.com/xlayer/build-x-hackathon) — Finance Copilot / Software Utility / Revenue Rocket / Best Product.

## Why this lane

| Lane | Status on OKX / X Layer |
|------|-------------------------|
| DeFi execution agents | Saturated — Otto X, Leigent, YieldMax, Mollie… |
| V4 launchpads | Hatch AI and others |
| Trust / attestation | Built, ~0 sold (AttestVerify, Internet Court…) |
| Info report tools | Hundreds, mostly 0 sold |
| **OPC spend policy + ledger** | **Thin — OKX’s own thesis is “one person, $1M/year” but no ASP owns the finance passport** |

Novelty claim: **not** “nobody ever thought of budgets.” Claim: **no polished OKX.AI ASP ships policy → authorize → settle → books as a pay-per-call service agents actually call before spending.** That is the product.

## Product loop

```
Founder sets policy (caps, categories, approval threshold)
        ↓
Agent wants to pay an ASP via x402
        ↓
agentpass_authorize  →  allow | deny | needs_approval
        ↓
Agent pays ASP (only if allowed)
        ↓
agentpass_settle  →  receipt on OPC ledger
        ↓
Export CSV / snapshot for tax & Revenue Rocket metrics
```

## Quick start

```bash
npm install
npm start
# → http://localhost:8787
npm test
```

Demo console: open the site → **Launch demo OPC** → authorize spends, approve pending, export CSV.

## HTTP ASP

| Method | Path | x402 | Purpose |
|--------|------|------|---------|
| POST | `/api/company` | free | Create OPC |
| POST | `/api/company/:id/agents` | free | Register agent |
| POST | `/api/company/:id/policy` | free | Update policy |
| POST | `/api/company/:id/authorize` | $0.005 | Authorize spend |
| POST | `/api/company/:id/approve` | free | Founder approve/deny |
| POST | `/api/company/:id/settle` | $0.002 | Settle + receipt |
| GET | `/api/company/:id/snapshot` | $0.01 | Budget + ledger |
| GET | `/api/company/:id/export.csv` | $0.025 | Books export |
| GET | `/api/catalog` | free | ASP catalog |

Paid routes return standard **HTTP 402** with x402 `accepts` on X Layer (`eip155:196`, USDT0 / USDG). Local/demo mode accepts `X-AgentPass-Demo-Pay`. Set `REQUIRE_REAL_X402=1` and wire the OKX facilitator for mainnet.

## MCP tools

```bash
npm run mcp
# AGENTPASS_URL=http://127.0.0.1:8787
```

Tools: `agentpass_create_company`, `agentpass_register_agent`, `agentpass_authorize`, `agentpass_settle`, `agentpass_approve`, `agentpass_budget`, `agentpass_set_policy`, `agentpass_export`.

Compatible with Claude Code, Codex, OpenClaw, Hermes (stdio JSON-RPC).

## Hackathon positioning

- **ASP type:** ready-to-use tool + always-on service + crypto finance use case
- **Integration depth:** x402 payment gate, X Layer network ids, MCP for Onchain OS clients, CSV books for OPC ops
- **Usage metric:** every authorize/settle is a countable marketplace call (Revenue Rocket / activity)
- **Honest risk:** OKX may ship native wallet spend limits later — AgentPass wins by being the *OPC books + multi-agent policy + approval workflow* layer on top, not a duplicate of a single allowlist filter

## Repo layout

```
server.js          Express ASP + static console
lib/policy.js      Spend policy engine
lib/company.js     OPC, agents, authorize, settle, export
lib/x402.js        402 gate + demo payment
lib/money.js       USDT micro-units
mcp/server.js      MCP tool bridge
public/            Founder console UI
test/smoke.js      Unit + HTTP smoke tests
```

## License

MIT
