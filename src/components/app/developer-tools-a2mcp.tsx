"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/design-system/panel";

interface BuildInfo {
  gitCommit: string;
  gitBranch: string;
  environment: string;
  builtAt: string;
}

export function DeveloperToolsA2Mcp() {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);

  useEffect(() => {
    void fetch("/api/build-info")
      .then((res) => res.json())
      .then((data: BuildInfo) => setBuildInfo(data))
      .catch(() => setBuildInfo(null));
  }, []);

  const sample = `curl -X POST https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage \\
  -H "Content-Type: application/json" \\
  -d '{"repositoryUrl":"https://github.com/owner/repo","branch":"main","maximumFindings":5,"operation":"analyze_repository"}'`;

  const shortCommit =
    buildInfo?.gitCommit && buildInfo.gitCommit !== "unknown"
      ? buildInfo.gitCommit.slice(0, 7)
      : "—";

  return (
    <Panel variant="elevated" padding="md" className="border-border/60">
      <p className="ds-label mb-2">Use RepoDiet from another agent</p>
      <p className="mb-3 text-sm text-muted-foreground">
        A2MCP Quick Triage (service 32948) is read-only external triage — not part of the in-app
        cleanup payment flow. Full browser cleanup uses A2A service 32947 only.
      </p>
      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Deployment commit</dt>
          <dd className="font-mono" title={buildInfo?.gitCommit}>
            {shortCommit}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Environment</dt>
          <dd className="font-mono">{buildInfo?.environment ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Service</dt>
          <dd className="font-mono">32948</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Price</dt>
          <dd className="font-mono">0.03 USD₮0</dd>
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
