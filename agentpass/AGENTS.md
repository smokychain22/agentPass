# AgentPass — agent notes

## Run

```bash
npm install
npm start          # http://localhost:8787
npm test           # smoke tests (boots temp server on :8799)
npm run mcp        # MCP stdio server (needs API up)
```

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `8787` | HTTP port |
| `AGENTPASS_DATA_DIR` | `./data` | JSON persistence |
| `AGENTPASS_PAY_TO` | demo address | x402 payTo |
| `REQUIRE_REAL_X402` | unset | If `1`, reject demo pay headers |

## What to build next (listing on OKX.AI)

1. Replace demo pay verification with OKX facilitator EIP-3009 verify
2. Bind `companyId` to Agentic Wallet identity / ERC-8004
3. Publish MCP + catalog on okx.ai ASP form
4. Drive real authorize/settle volume for Revenue Rocket
