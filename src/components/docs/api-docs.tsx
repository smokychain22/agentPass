"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/layout/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TOOL_MANIFEST_ENTRIES } from "@/lib/a2mcp/tool-manifest";
import {
  A2MCP_VERSION,
  MAX_FILES_ANALYZED,
  MAX_REPO_ZIP_BYTES,
  MAX_SINGLE_FILE_BYTES,
  TOOL_TIMEOUT_MS,
} from "@/lib/a2mcp/constants";
import { buildToolCurl, getServerBaseUrl } from "@/lib/docs/base-url";
import { MarketingCta } from "@/components/landing/marketing-cta";
import { A2MCP_READINESS_COPY } from "@/lib/marketing/content";
import { ToolEndpointCard } from "./tool-endpoint-card";
import { CodePanel } from "./code-panel";
import { CopyButton } from "./copy-button";

const SAFETY_POLICY = [
  "RepoDiet never pushes to your main branch.",
  "RepoDiet never merges pull requests for you.",
  "RepoDiet only works on public repos in the demo; PR mode uses authorized GitHub access.",
  "RepoDiet never reads or displays .env values.",
  "RepoDiet applies fixes on a review branch — unused imports, safe file deletes, package removals.",
  "Duplicates, routes, and protected paths require human review before any change.",
];

const LIMITS = [
  "Public GitHub repos only",
  `Max ZIP size: ${MAX_REPO_ZIP_BYTES / (1024 * 1024)}MB`,
  `Max files: ${MAX_FILES_ANALYZED}`,
  `Max single file read: ${MAX_SINGLE_FILE_BYTES / 1024}KB`,
  `Timeout: ${TOOL_TIMEOUT_MS / 1000} seconds`,
  "JavaScript/TypeScript focus",
  "Fallback analyzers may be used on serverless runtimes",
];

const OKX_RESPONSE_EXAMPLE = `{
  "ok": true,
  "tool": "scan_repo_bloat",
  "version": "${A2MCP_VERSION}",
  "repo": {},
  "scan": {},
  "findings": {},
  "policy": {},
  "warnings": []
}`;

const OKX_ERROR_EXAMPLE = `{
  "ok": false,
  "tool": "scan_repo_bloat",
  "version": "${A2MCP_VERSION}",
  "error": {
    "code": "REPO_NOT_FOUND",
    "message": "Could not fetch repository. Check if the repo is public and the branch exists."
  }
}`;

const SAMPLE_SCAN_CURL = buildToolCurl(getServerBaseUrl(), "/api/tools/scan_repo_bloat", {
  repoUrl: "https://github.com/smokychain22/agentPass",
  branch: "main",
  mode: "quick",
});

export function ApiDocs() {
  const [baseUrl, setBaseUrl] = useState(getServerBaseUrl());

  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(window.location.origin);
    }
  }, []);

  const manifestUrl = `${baseUrl}/api/tools/manifest`;
  const healthUrl = `${baseUrl}/api/tools/health`;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <Badge variant="electric" className="mb-4 font-mono text-[10px] uppercase tracking-wider">
          API Reference
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">RepoDiet API Docs</h1>

        <section className="mt-10 space-y-4">
          <h2 className="text-lg font-semibold">1. API Overview</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            RepoDiet exposes deterministic JSON endpoints for repo scanning, findings analysis,
            patch bundle generation, and regression checklist generation.
          </p>
          <Card className="border-border/80 bg-card/50">
            <CardContent className="py-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Base URL</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-sm text-electric">{baseUrl}</code>
                <CopyButton text={baseUrl} label="Copy URL" />
              </div>
            </CardContent>
          </Card>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <a href={manifestUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Open Manifest
              </a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href={healthUrl} target="_blank" rel="noopener noreferrer">
                Test Health
              </a>
            </Button>
            <CopyButton text={SAMPLE_SCAN_CURL.replace(getServerBaseUrl(), baseUrl)} label="Copy sample curl" />
            <Button asChild variant="outline" size="sm">
              <Link href="/app">Run Scan</Link>
            </Button>
          </div>
        </section>

        <section className="mt-12 space-y-4">
          <h2 className="text-lg font-semibold">2. Tool manifest</h2>
          <p className="text-sm text-muted-foreground">
            Machine-readable catalog of all RepoDiet tools, input schemas, and output schemas.
          </p>
          <Card className="border-border/80">
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <code className="font-mono text-sm">GET /api/tools/manifest</code>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="secondary" size="sm">
                  <a href={manifestUrl} target="_blank" rel="noopener noreferrer">
                    Open Manifest
                  </a>
                </Button>
                <CopyButton text={manifestUrl} label="Copy URL" />
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mt-12 space-y-6">
          <h2 className="text-lg font-semibold">3. Tool endpoints</h2>
          <p className="text-sm text-muted-foreground">
            All tools accept a public GitHub <code className="font-mono text-xs">repoUrl</code> and
            optional <code className="font-mono text-xs">branch</code>. No prior UI scan is required.
          </p>
          <div className="flex flex-wrap gap-2">
            {TOOL_MANIFEST_ENTRIES.map((tool) => (
              <a
                key={tool.name}
                href={`#${tool.name}`}
                className="rounded-md border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                {tool.name}
              </a>
            ))}
          </div>
          {TOOL_MANIFEST_ENTRIES.map((tool) => (
            <ToolEndpointCard key={tool.name} tool={tool} baseUrl={baseUrl} />
          ))}
        </section>

        <section className="mt-12 space-y-4">
          <h2 className="text-lg font-semibold">4. OKX-compatible response format</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Successful tool responses return JSON only. Tool-specific fields are returned at the top
            level alongside <code className="font-mono text-xs">ok</code>,{" "}
            <code className="font-mono text-xs">tool</code>,{" "}
            <code className="font-mono text-xs">version</code>, and{" "}
            <code className="font-mono text-xs">warnings</code>.
          </p>
          <CodePanel code={OKX_RESPONSE_EXAMPLE} language="json" />
          <p className="text-sm text-muted-foreground">Error responses:</p>
          <CodePanel code={OKX_ERROR_EXAMPLE} language="json" />
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold mb-4">5. Safety policy</h2>
          <Card className="border-signal/20 bg-signal/5">
            <CardContent className="py-4">
              <ul className="space-y-2 text-sm text-muted-foreground">
                {SAFETY_POLICY.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-signal" />
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold mb-4">6. Limits</h2>
          <Card className="border-border/80">
            <CardContent className="py-4">
              <ul className="space-y-2 text-sm text-muted-foreground font-mono">
                {LIMITS.map((item) => (
                  <li key={item}>— {item}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold mb-4">7. A2MCP readiness</h2>
          <Card className="border-electric/20 bg-electric/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Agent integration note</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed">
              {A2MCP_READINESS_COPY}
            </CardContent>
          </Card>
        </section>

        <section className="mt-12">
          <MarketingCta />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
