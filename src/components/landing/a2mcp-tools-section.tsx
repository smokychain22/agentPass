"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { A2MCP_TOOLS } from "@/lib/marketing/content";
import { getServerBaseUrl } from "@/lib/docs/base-url";

export function A2mcpToolsSection() {
  const [baseUrl, setBaseUrl] = useState(getServerBaseUrl());

  useEffect(() => {
    if (typeof window !== "undefined") setBaseUrl(window.location.origin);
  }, []);

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        A2MCP-ready deterministic JSON endpoints — callable with a public GitHub repo URL. No browser
        session required.
      </p>
      <div className="flex flex-wrap gap-2 mb-6">
        {A2MCP_TOOLS.map((tool) => (
          <Badge key={tool} variant="default" className="font-mono text-xs">
            {tool}
          </Badge>
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
