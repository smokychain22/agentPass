# RepoDiet

**Cut AI code bloat before your app collapses.**

> OKX.AI Genesis Hackathon · Software Utility · A2MCP + A2A

AI built your app fast. RepoDiet keeps the codebase alive — scan duplicate components, dead files, unused dependencies, and orphan routes, then generate a **Patch Bundle** and **Regression Contract**.

## One-liner

RepoDiet scans AI-built JavaScript/TypeScript apps, finds duplicate and dead code, and generates a safe cleanup patch with a regression checklist.

## OKX fit

| | |
|---|---|
| **Category** | Software Utility |
| **A2MCP** | `scan_repo_bloat`, `detect_duplicate_code`, `find_dead_files`, `find_unused_dependencies`, `generate_cleanup_patch`, `generate_regression_checklist` |
| **A2A** | RepoDiet — Clean my AI-built app repo |
| **Pricing** | Quick scan $0.05 · Deep scan $0.15 · Patch bundle $0.25 USDT (x402 on X Layer) |

## Quick start

```bash
npm install
npm run dev        # Next.js UI → http://localhost:3000
npm run api        # Express API (Phase 2+) → http://localhost:8788
npm run build      # Production build
npm test           # API smoke tests
```

**Phase 1 routes:** `/` landing · `/app` scanner · `/docs` · `/okx`

Open `/app` → paste a repo URL or **Try Demo Repo** to preview the scan flow.

## Product concepts

- **AI Slop Fingerprint** — ComponentFinal, Button2, backup folders, orphan utils
- **Delete Confidence Engine** — SAFE DELETE / REVIEW FIRST / DO NOT TOUCH
- **Patch Bundle** — `repodiet-cleanup.patch`, report, regression checklist, Cursor prompt
- **Regression Contract** — routes/APIs that must still work before merge

## API

| Method | Path | x402 |
|--------|------|------|
| POST | `/api/scans/demo` | free |
| POST | `/api/scans/create` + `/api/scans/run` | free |
| GET | `/api/scans/:id/findings` | free |
| POST | `/api/scans/:id/generate-patch` | free (listing demo) |
| POST | `/api/tools/scan_repo_bloat` | $0.05 |
| POST | `/api/tools/generate_cleanup_patch` | $0.15 |
| POST | `/api/tools/generate_regression_checklist` | $0.25 |

Demo payment: header `X-RepoDiet-Demo-Pay: 1`

## Hackathon checklist

1. List on OKX.AI as Software Utility ASP
2. Post on X with #OKXAI + 90s demo (demo repo scan → patch → receipt)
3. Submit form before **Jul 17, 23:59 UTC**

## License

MIT

## Monorepo

| Path | ASP |
|------|-----|
| `/` (this app) | **RepoDiet** — deployed to Vercel |
| `agentpass/` | AgentPass — OPC spend passport |
| `rogue/` | Rogue — adversarial red-team for AI agents |
