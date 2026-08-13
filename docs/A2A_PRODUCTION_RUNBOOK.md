# A2A production runbook — buyer → RepoDiet #9636 → escrow → PR → settlement

Prepared 2026-08-13. Every command below was taken from live `--help` output, not guessed.
**Do not start until the eligibility gate in step 0 passes.**

## Identities

| Role | Account | Agent | Wrapper |
|---|---|---|---|
| Buyer | `abdullahlp114@gmail.com` | #10466 (User) | `C:\Users\hp\okx-buyer.ps1` |
| Seller / ASP | `officialsmokychain@gmail.com` | #9636 (RepoDiet) | `C:\Users\hp\okx-seller.ps1` |

A2A service `37348` (1 USDT, escrow) · A2MCP service `37347` (0.03 USDT, x402)
Target repo: `https://github.com/velz-cmd/Meridian`

## Step 0 — Eligibility gate (BLOCKING)

A2A marketplace routing requires the ASP to be **listed and eligible**, not merely approved-looking.

```powershell
.\okx-seller.ps1 agent get-agents --agent-ids 9636
```
Require **`approvalDisplayStatus = 4`** ("Listed — eligible for task recommendations") and `status = 1`.
While it reads `2` / "Listing under review", A2A cannot route — stop here.

```powershell
.\okx-buyer.ps1 agent asp-match --task-desc "delete unused files from repository and deliver a pull request" --provider-agent-id 9636 --agent-id 10466 --format json
```
Require service **`37348`** to appear. If only `37347` (A2MCP) is returned, the gate has not opened —
do **not** attempt `create-task`, it will return `designated provider not match: 9636`.

## Step 0b — GitHub delivery capability (BLOCKING, before any funding)

A repository-writing task cannot be delivered without a RepoDiet GitHub App installation on the
target repo. Reading a public repo works without one (ZIP archive), so a successful free scan is
**not** evidence of write access. Check explicitly:

```bash
curl -sS -X POST "https://skillswap-virid-kappa.vercel.app/api/github/capability" \
  -H "Content-Type: application/json" \
  -d '{"repositoryUrl":"https://github.com/velz-cmd/Meridian"}'
```

Require `installationFound: true` and `canCreateBranch`/`canPushChanges`/`canCreatePullRequest` all
`true`. As of 2026-08-13 this returns `failureCode: "installation_required"` for Meridian — the repo
owner must install the `repodiet-operator` GitHub App (https://github.com/apps/repodiet-operator) on
`velz-cmd/Meridian` with branch + PR write. **Do not fund escrow until this passes**, or the task
will fund and then fail at delivery.

## Step 1 — Route preflight (creates nothing)

```powershell
.\okx-buyer.ps1 agent prepare-create --description "<desc>" --title "Delete unused files" --budget 1 --max-budget 1 --currency USDT --provider 9636
```

Inspect `routing`. Require `route` to resolve to the **A2A/escrow** path.
Today it returns `{"route":"x402","endpoint":".../api/a2mcp/quick-triage","feeAmount":"0.03"}` —
correct for the current unapproved state, wrong for this task. **Do not fund anything until this
resolves to A2A.** Capture the raw before/after routing output as evidence of the transition.

## Step 2 — Create ONE task

```powershell
.\okx-buyer.ps1 agent create-task `
  --description "Revalidate and remove only files that remain provably unused in velz-cmd/Meridian at current HEAD; deliver as a pull request on a dedicated branch with no unrelated changes." `
  --title "Delete unused files" `
  --budget 1 --max-budget 1 --currency USDT `
  --provider 9636 --service-id 37348 --payment-mode escrow `
  --service-token-address 0x779ded0c9e1022225f8e0630b35a9b54be713736 `
  --service-token-amount 1 `
  --service-params "repository: velz-cmd/Meridian; scope: remove only files revalidated as unused at current HEAD"
```

`--provider` is the **agentId** (9636) and `--service-id` is the **service id** (37348) — confirmed
from `create-task --help`. Record `jobId`. Create only one task; do not retry into duplicates.

## Step 3 — Negotiation

Watch the task and let #9636 respond through its own A2A implementation.

```powershell
.\okx-buyer.ps1 agent status <jobId>
.\okx-buyer.ps1 agent active-tasks
```
Verify provider identity #9636, service 37348, correct repository, scope, and quoted price before
proceeding. Do not accept a malformed quote.

## Step 4 — Escrow (ONE funding transaction)

Record the balance first:
```powershell
.\okx-buyer.ps1 wallet balance --chain xlayer
```
Fund via the confirm/accept step the task state machine presents (`agent confirm-accept` sets payment
mode and executes payment; parameters auto-resolve from the task detail API). Then verify
independently: buyer balance delta, transaction hash, and task state — never trust exit status alone.

## Step 5 — Delivery (seller side)

RepoDiet pins the commit, revalidates candidates, creates a dedicated branch, removes only validated
files, runs checks, opens a PR, and submits delivery. Scope is deliberately tiny.

## Step 6 — Verify before accepting

- correct repo and branch; commit exists; PR exists
- **exactly** the intended files changed, nothing unrelated
- checks pass; PR description matches the task; deletion rationale is evidence-backed

If RepoDiet judges a candidate unsafe and skips it, that is **correct behaviour**, not a failure.

## Step 7 — Accept and settle

```powershell
.\okx-buyer.ps1 agent complete <jobId>
```
Then verify final task state, escrow release, and balance movement on both sides.

## Deletion candidates — validated at commit `a35631c`

| File | Verdict | Basis |
|---|---|---|
| `scripts/test-birdeye-delayed.mjs` | **LIKELY SAFE** | zero references repo-wide (code, docs, configs, `package.json`); ad-hoc probe script; no sibling or documented workflow |
| `scripts/sync-vercel-env.mjs` | **REVIEW REQUIRED — do not auto-delete** | no code references, but a documented **manual operational** workflow exists (`docs/VERCEL-SOCIAL-ENV.md`) around the sibling `scripts/sync-vercel-env.ps1`, and the file's own header documents manual use (`Usage: node scripts/sync-vercel-env.mjs`). The `.ps1` does not invoke the `.mjs`, so they are parallel manual tools — deleting the `.mjs` may break a non-Windows operator workflow. |

Revalidate both at the live HEAD immediately before deletion; repository state may have changed.
