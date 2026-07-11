# AgentPass

**OPC spend passport & finance control plane for OKX.AI**

> Not another swap/yield agent. The control plane every autonomous agent assumes you already have.

AgentPass lives in `agentpass/` alongside RepoDiet in this monorepo.

## Quick start

```bash
npm run agentpass:start
# → http://localhost:8787
npm run test:agentpass
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
| POST | `/api/company/:id/settle` | $0.005 | Settle with receipt |
| GET | `/api/company/:id/snapshot` | free | Finance snapshot |
| GET | `/api/company/:id/export` | free | CSV books export |

## MCP tools

Run `npm run agentpass:mcp` — stdio JSON-RPC tools: `agentpass_create_company`, `agentpass_register_agent`, `agentpass_authorize`, `agentpass_settle`, etc.

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
