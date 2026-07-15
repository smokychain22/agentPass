"use client";

import { Panel } from "@/components/design-system/panel";

/** Compact explanation of live OKX services — ASP 5283. */
export function ServiceModelPanel() {
  return (
    <Panel variant="elevated" padding="md" className="text-sm text-muted-foreground">
      <p className="ds-label mb-2">Live service model</p>
      <dl className="space-y-2">
        <div>
          <dt className="font-medium text-foreground">A2MCP 32948 · Quick Triage</dt>
          <dd>
            Operation <span className="font-mono">analyze_repository</span> — 0.03 USD₮0 per call via
            live x402 on X Layer. Bounded triage with up to five prioritized findings.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">A2A 32947 · Verified Cleanup PR</dt>
          <dd>
            Operation <span className="font-mono">create_cleanup_pr</span> — negotiated price (default
            reference 1 USD₮0) with escrow, delivery, and buyer acceptance.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">ASP 5283</dt>
          <dd>
            Public provider identity. Production origin{" "}
            <span className="font-mono">https://skillswap-virid-kappa.vercel.app</span>.
          </dd>
        </div>
      </dl>
    </Panel>
  );
}
