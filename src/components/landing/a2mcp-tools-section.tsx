"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { A2MCP_TOOL_GROUPS, A2MCP_TOOLS_HIGHLIGHT } from "@/lib/marketing/content";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import { getServerBaseUrl } from "@/lib/docs/base-url";

export function A2mcpToolsSection() {
  const [baseUrl, setBaseUrl] = useState(getServerBaseUrl());

  useEffect(() => {
    if (typeof window !== "undefined") setBaseUrl(window.location.origin);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {A2MCP_TOOLS_HIGHLIGHT.map((tool) => (
          <RiskBadge key={tool} level="cyan">
            {tool}
          </RiskBadge>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {A2MCP_TOOL_GROUPS.map((group) => (
          <Panel key={group.category} variant="elevated" padding="md">
            <p className="ds-label mb-3">{group.category}</p>
            <ul className="space-y-2">
              {group.tools.map((tool) => (
                <li key={`${group.category}-${tool}`}>
                  <code className="rounded border border-border/40 bg-[#05080D]/60 px-2 py-1 font-mono text-[11px] text-electric">
                    {tool}
                  </code>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm">
          <a href={`${baseUrl}/api/tools/manifest`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Open Manifest
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/docs">View API Docs</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={`${baseUrl}/api/tools/health`} target="_blank" rel="noopener noreferrer">
            Test Health
          </a>
        </Button>
      </div>
    </div>
  );
}
