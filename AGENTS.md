# AGENTS.md

## Cursor Cloud specific instructions

This repo currently contains **Rogue** (`/rogue`) — an adversarial red-team engine
for AI agents / OKX.AI ASPs.

- **Run:** `cd rogue && node server.js` → serves UI + API on `http://localhost:4177`.
- **No dependencies / no build step:** pure Node (>=18), zero npm packages. There is
  nothing to `npm install`; do not add a build step unless you introduce real deps.
- **Test the engine headlessly:** `cd rogue && node test/smoke.js` (asserts the
  baseline run exposes exploits and applying guardrails raises readiness).
- **Core API:** `POST /api/scan` with `{ "guardrails": [...], "targetName": "..." }`
  returns the full machine-readable exploit report (this doubles as the A2MCP
  `run_attack_suite` tool). `GET /api/health` for liveness.
- **Pluggable target:** the demo target in `rogue/engine/target.js` is a
  deterministic *simulated* agent so demos are reproducible. To test a real agent,
  implement an adapter with the same `runTarget(config, attack) -> {text, actions}`
  signature (HTTP/MCP call to the live ASP); the rest of the engine is unchanged.
