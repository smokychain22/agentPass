"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { A2MCP_TOOLS, A2MCP_TOOLS_HIGHLIGHT } from "@/lib/marketing/content";
import { getServerBaseUrl } from "@/lib/docs/base-url";

export function A2mcpToolsSection() {
  const [baseUrl, setBaseUrl] = useState(getServerBaseUrl());

  useEffect(() => {
    if (typeof window !== "undefined") setBaseUrl(window.location.origin);
  }, []);

  return (
    <div>
      <p className="mb-4 text-sm text-secondary">
        Deterministic JSON endpoints — callable with a public GitHub repo URL. No browser session
        required.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        {A2MCP_TOOLS_HIGHLIGHT.map((tool) => (
          <span
            key={tool}
            className="rounded border border-electric/30 bg-electric/5 px-2 py-1 font-mono text-xs text-electric"
          >
            {tool}
          </span>
        ))}
      </div>
      <p className="mb-3 text-xs text-[#64748B]">All A2MCP-ready tools:</p>
      <div className="mb-6 flex flex-wrap gap-2">
        {A2MCP_TOOLS.map((tool) => (
          <span
            key={tool}
            className="rounded border mcc-border bg-[#0C1118] px-2 py-1 font-mono text-xs text-secondary"
          >
            {tool}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm">
          <a href={`${baseUrl}/api/tools/manifest`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
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
