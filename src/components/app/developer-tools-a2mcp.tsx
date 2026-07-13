"use client";

import { Panel } from "@/components/design-system/panel";

export function DeveloperToolsA2Mcp() {
  const sample = `curl -X POST https://skillswap-skillswap7.vercel.app/api/a2mcp/quick-triage \\
  -H "Content-Type: application/json" \\
  -d '{"repoUrl":"https://github.com/owner/repo","maximumFindings":10}'`;

  return (
    <Panel variant="elevated" padding="md" className="border-border/60">
      <p className="ds-label mb-2">Use RepoDiet from another agent</p>
      <p className="mb-3 text-sm text-muted-foreground">
        A2MCP Quick Triage (service 32948) is read-only external triage — not part of the in-app
        cleanup payment flow. Full browser cleanup uses A2A service 32947 only.
      </p>
      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Service</dt>
          <dd className="font-mono">32948</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Price</dt>
          <dd className="font-mono">0.03 USDT</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Endpoint</dt>
          <dd className="truncate font-mono text-xs">POST /api/a2mcp/quick-triage</dd>
        </div>
      </dl>
      <pre className="mt-3 overflow-x-auto rounded-md border border-border/50 bg-background p-3 text-xs">
        {sample}
      </pre>
    </Panel>
  );
}
