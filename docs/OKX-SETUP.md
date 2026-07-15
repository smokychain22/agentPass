# RepoDiet OKX credential setup

Two separate OKX systems — do not mix them.

| System | Purpose | How you get it |
|--------|---------|----------------|
| **Agentic Wallet** | ASP identity, receive payments, A2A escrow | Email + OTP via Onchain OS (no Developer API key) |
| **OKX Developer API** | x402 Payment SDK / facilitator verification | OKX Developer Portal → Create API key |

## Security

- Never commit API secrets or GitHub private keys to git.
- Set values only in **Vercel Environment Variables** or a local `.env` (gitignored).
- If a secret was pasted into chat or a ticket, **rotate it** in the OKX portal and GitHub App settings.

---

## 1. Agentic Wallet (first)

In a **new** Cursor Agent chat (after installing Onchain OS skills):

```
npx skills add okx/onchainos-skills --yes -g
```

Then:

```
Log in to Agentic Wallet with my email using Onchain OS.
Show me the EVM wallet address after login.
Do not save my OTP anywhere.
```

Save the returned EVM address:

```bash
OKX_AGENTIC_WALLET_ADDRESS=0xYourAddress
PAY_TO_ADDRESS=0xYourAddress
REPODIET_PAY_TO=0xYourAddress   # RepoDiet alias (same value)
```

ASP / service IDs are returned by OKX registration — save only what OKX returns:

```bash
OKX_ASP_AGENT_ID=...
OKX_A2A_SERVICE_ID=...
OKX_A2MCP_SERVICE_ID=...
```

---

## 2. OKX Developer API (x402 facilitator)

From [OKX Onchain OS Developer Portal](https://web3.okx.com/onchainos/dev-portal) (official docs link):

1. Connect wallet → Verify → Create API key (e.g. `RepoDiet Production`)
2. Copy **immediately** (secret may be one-time):

```bash
OKX_API_KEY=...
OKX_SECRET_KEY=...
OKX_PASSPHRASE=...    # you choose this when creating the key
```

RepoDiet also accepts `REPODIET_OKX_*` aliases for the same three values.

**Pakistan / restricted regions:** If your country is not in the phone list, Developer API may be unavailable. Agentic Wallet email login may still work; contact OKX hackathon support for API access.

---

## 3. x402 network (already correct in code)

RepoDiet uses **X Layer mainnet**:

```bash
X402_NETWORK=eip155:196          # hardcoded in src/lib/payment/constants.ts
X402_PRICE=$0.01                 # per-tool pricing in quote-service / lib/x402.js
```

Settlement asset (USD₮0 on X Layer):

`0x779ded0c9e1022225f8e0630b35a9b54be713736`

Do **not** use `eip155:1952` unless OKX explicitly gives you a current test environment.

Enable production x402 verification:

```bash
REQUIRE_REAL_X402=1
REPODIET_OKX_A2MCP_PAID=1
REPODIET_X402_FACILITATOR_URL=<your OKX facilitator base URL if self-hosted>
```

Until facilitator URL is configured, test mode works with `REPODIET_X402_TEST_SECRET` (development only).

---

## 4. Where each variable goes

### Vercel (Next.js app) — **no OKX API secrets in browser**

| Variable | Notes |
|----------|--------|
| `REPODIET_PAY_TO` or `PAY_TO_ADDRESS` | Agentic Wallet EVM address |
| `OKX_ASP_AGENT_ID` | After ASP registration |
| `OKX_A2A_SERVICE_ID` | Optional tracking |
| `OKX_A2MCP_SERVICE_ID` | Optional tracking |
| `NEXT_PUBLIC_OKX_ASP_AGENT_ID` | Public display only (same ID) |
| `NEXT_PUBLIC_OKX_AGENT_URL` | Keep **unset** until `https://www.okx.ai/agents/5283` genuinely loads. Do not enable `NEXT_PUBLIC_OKX_AGENT_URL_AUTO` while the public agent page 404s. |
| `XLAYER_RPC_URL` | Optional. Default `https://rpc.xlayer.tech` — used to verify direct-site ERC-20 USDT transfers |
| `ALLOW_INTERNAL_TEST_BUYER` | Must be `0` in production (correct spelling: **BUYER**, not `BUER`). Internal E2E buyer only. |
| `REPODIET_A2A_TEST_PRICE` | Temporary controlled **0.20 USDT** A2A price for funded acceptance only. **Remove after acceptance passes.** |
| `REPODIET_X402_TEST_MODE` | Local/test settlement helper. **Remove from production after A2A acceptance.** |
| `REPODIET_X402_TEST_SECRET` | Local/test HMAC settle helper. **Remove from production after A2A acceptance.** |
| `REPODIET_OKX_A2MCP_PAID=1` | Enable paid A2MCP |
| `REQUIRE_REAL_X402=1` | Production payment verification |
| `GITHUB_APP_ID` | Existing RepoDiet GitHub App |
| `GITHUB_APP_CLIENT_ID` | OAuth |
| `GITHUB_APP_CLIENT_SECRET` | OAuth |
| `GITHUB_APP_SLUG` | Install URL slug |
| `GITHUB_APP_PRIVATE_KEY_BASE64` | PEM as base64 **or** `GITHUB_APP_PRIVATE_KEY` with `\n` escapes |
| `GITHUB_APP_WEBHOOK_SECRET` or `GITHUB_WEBHOOK_SECRET` | Webhook HMAC |
| `SUPABASE_URL` | If using Supabase persistence |
| `SUPABASE_PUBLISHABLE_KEY` | Browser-safe |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only (RepoDiet name; not `SUPABASE_SECRET_KEY`) |
| `UPSTASH_REDIS_REST_URL` | Alternative to Supabase for jobs/sandbox |
| `UPSTASH_REDIS_REST_TOKEN` | |
| `GEMINI_API_KEY` | Optional proposal formatting |
| `EARN_WORKER_SECRET` | If calling external earn worker |

### Server-side only (Vercel encrypted env — never `NEXT_PUBLIC_*`)

| Variable | Notes |
|----------|--------|
| `OKX_API_KEY` | Payment SDK |
| `OKX_SECRET_KEY` | Payment SDK |
| `OKX_PASSPHRASE` | Payment SDK |

The legacy Docker worker is deprecated; Vercel Sandbox + Workflows handle verification. OKX API keys stay on Vercel server routes, not in a separate worker container, unless you run a custom facilitator.

---

## 5. GitHub App private key formats

**Option A — base64 (recommended for Vercel):**

```bash
base64 -w0 repodiet.pem
# → GITHUB_APP_PRIVATE_KEY_BASE64=...
```

**Option B — escaped newlines:**

```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' repodiet.pem
# → GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
```

Generate webhook secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Suggested GitHub App permissions: Metadata (read), Contents (R/W), Pull requests (R/W), Issues (read), Checks (read), Actions (read). Avoid Administration and Secrets.

---

## 6. Verify after deploy

```bash
REPODIET_PRODUCTION_URL=https://skillswap-virid-kappa.vercel.app npm run verify:okx
REPODIET_PRODUCTION_URL=https://skillswap-virid-kappa.vercel.app npm run verify:x402
```

---

## RepoDiet env name cheat sheet

| Your checklist name | RepoDiet accepts |
|---------------------|------------------|
| `PAY_TO_ADDRESS` | `REPODIET_PAY_TO`, `OKX_AGENTIC_WALLET_ADDRESS` |
| `OKX_ASP_AGENT_ID` | `REPODIET_OKX_AGENT_ID`, `OKX_AGENT_ID` |
| `GITHUB_WEBHOOK_SECRET` | `GITHUB_APP_WEBHOOK_SECRET` |
| `OKX_API_KEY` | `REPODIET_OKX_API_KEY` |

See `.env.example` for a full template (placeholders only).
