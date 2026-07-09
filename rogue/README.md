# Rogue

**Autonomous adversarial red-team for AI agents and OKX.AI ASPs.**

> Most teams build agents that _do_ things. Rogue is the agent that _breaks_ them
> — before real users or attackers do.

Rogue is **not** a chatbot (type prompt → get text). It runs a suite of real
adversarial attacks against a target agent, decides with machine-checkable
detectors whether each attack **succeeded** (policy violated) or was **blocked**,
then produces exploit replays, a launch-readiness score, and the exact guardrails
that fix each open exploit. Apply the guardrails and retest to prove the fix.

## Why it fits OKX.AI

OKX.AI is launching agents/ASPs that can negotiate scope (A2A), call tools, and
get **paid** (escrow / x402 A2MCP). If agents can move money and call tools, the
missing layer is: _can this agent be manipulated before it goes live?_ Rogue is
that layer.

- **A2A service:** "Red-team my ASP before I list it" → returns an exploit report + fixes.
- **A2MCP tool:** `POST /api/scan` is a callable `run_attack_suite` endpoint returning a machine-readable report.

## Attack coverage (MVP)

Prompt injection · fake authority · unsupported financial claims · payment/spend
abuse · tool misuse · data exfiltration · indirect (URL) injection · disclaimer
stripping · escrow-release impersonation · scope violation · encoding jailbreak ·
delegation + auto-approve.

## Run it

```bash
cd rogue
npm start          # → http://localhost:4177
npm test           # engine smoke test (baseline → patched)
```

No dependencies, no build step, no API keys — Node 18+ only.

## How it works

```
Target (agent)  ──►  Rogue attack suite  ──►  detectors  ──►  exploit replays
                                                     │
                                          readiness score + verdict
                                                     │
                                    recommended guardrails ──► retest
```

The built-in target is a **deterministic simulated** finance agent so the demo is
reproducible. To point Rogue at a **real** agent, implement an adapter with the
same signature as `engine/target.js`:

```js
runTarget(config, attack) -> { text: string, actions: string[] }
```

...that performs an HTTP/MCP call to the live ASP and maps its response. Nothing
else in the engine changes.

## Layout

| Path | Purpose |
| --- | --- |
| `engine/attacks.js` | Attack library (prompt, severity, policy, detector, fix) |
| `engine/target.js` | Pluggable target adapter + built-in simulated agent |
| `engine/runner.js` | Runs the suite, scores readiness, recommends fixes |
| `server.js` | Zero-dep HTTP server: UI + `/api/scan`, `/api/health` |
| `public/` | Command-center UI |
| `test/smoke.js` | End-to-end engine test |
