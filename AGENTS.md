# AGENTS.md

## RepoDiet (Next.js — primary app)

```bash
npm install
npm run dev          # http://localhost:3000
npm run typecheck
npm run test:e2e-fixture
```

RepoDiet scans repositories, generates verified cleanup patches, and opens GitHub PRs.

## AgentPass (`agentpass/` — OPC finance control plane)

```bash
npm run agentpass:start   # http://localhost:8787
npm run test:agentpass
npm run agentpass:mcp     # MCP stdio server (needs API up)
```

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `8787` | AgentPass HTTP port |
| `AGENTPASS_DATA_DIR` | `./data` | JSON persistence |
| `AGENTPASS_PAY_TO` | demo address | x402 payTo |
| `REQUIRE_REAL_X402` | unset | If `1`, reject demo pay headers |

AgentPass provides policy → authorize → settle → books for OKX.AI agents.
