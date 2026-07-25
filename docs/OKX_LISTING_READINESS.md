# OKX Listing Readiness

## Existing identities (preserved, not replaced)

| Identity | Value |
|---|---|
| ASP Agent ID | `5283` |
| A2A Service ID | `32947` |
| A2MCP Service ID | `32948` |
| A2A operation | `create_cleanup_pr` |
| A2MCP operation | `analyze_repository` |
| Network | X Layer mainnet (`eip155:196`) |
| Settlement asset | USD₮0 `0x779ded0c9e1022225f8e0630b35a9b54be713736` |
| A2MCP price | exactly `0.03 USD₮0` (`30000` atomic units) |

## Service descriptions (accurate to current implementation)

**A2MCP** — Fast paid repository triage that returns evidence-backed findings, exact commit
coverage, limitations, and a signed result.

**A2A** — Deep repository analysis and approved code remediation delivered as a validated draft
GitHub pull request for the repository owner to review and accept.

## What changed since the last submission

- Removed the Meridian-specific repair shortcut and all incident-specific internal diagnostic
  routes (see `docs/SECURITY_AND_KEY_ROTATION.md`).
- Quick Triage coverage (`filesInspected`, `filesDiscovered`, `skippedClassifications`, `state`) is
  now derived from the real repository inventory, never from finding count.
- The Findings review UI exposes exactly two primary views — Results and Technical details — with
  no nested Review/Plan/Pay/Delivery switcher duplicating the outer workflow.
- Task/API state is now honest: `terminal` is derived from the A2A state machine's actual
  transition graph, so a recoverable status (`payment_failed`, `analysis_failed`,
  `verification_failed`, `delivery_failed`, `checks_failed`) is never reported as terminal.
- Parent/child A2A reconciliation and repository isolation (rename-with-same-immutable-ID,
  cross-tenant, cross-commit) have dedicated regression coverage.

## Resubmission checklist

1. Confirm production deployment is live at the canonical URL and the removed routes 404.
2. Confirm the A2MCP price is exactly `0.03 USD₮0` in the live listing.
3. Resubmit through OKX Onchain OS using the service descriptions above.
4. Record the actual review/approval status returned by OKX — do not claim approval until OKX shows
   it.
