"use client";

import { Panel } from "@/components/design-system/panel";

/** Compact explanation of live OKX services — ASP 5283. */
export function ServiceModelPanel() {
  return (
    <Panel variant="elevated" padding="md" className="text-sm text-muted-foreground">
      <p className="ds-label mb-2">Live service model</p>
      <dl className="space-y-2">
        <div>
          <dt className="font-medium text-foreground">A2MCP 32948</dt>
          <dd>Callable Quick Triage — fixed-price structured result through x402.</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">A2A 32947</dt>
          <dd>Cleanup Operator — negotiated scoped execution with delivery and acceptance.</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">ASP 5283</dt>
          <dd>The public provider identity containing these services.</dd>
        </div>
      </dl>
    </Panel>
  );
}
