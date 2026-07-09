"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Blocks, CheckCircle2, Cpu, ExternalLink, Network, Shield } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/layout/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TOOL_MANIFEST_ENTRIES } from "@/lib/a2mcp/tool-manifest";
import { A2MCP_VERSION } from "@/lib/a2mcp/constants";
import { buildToolCurl, getServerBaseUrl } from "@/lib/docs/base-url";
import { CopyButton } from "./copy-button";

const LIVE_TOOLS = TOOL_MANIFEST_ENTRIES.map((t) => t.name);

const PROPOSED_PRICING = [
  { tool: "scan_repo_bloat", price: "0.05 USDT", note: "Quick structure + findings summary" },
  { tool: "detect_duplicate_code", price: "0.05 USDT", note: "Duplicate cluster report" },
  { tool: "find_dead_files", price: "0.05 USDT", note: "Unused + orphan file analysis" },
  { tool: "find_unused_dependencies", price: "0.05 USDT", note: "Package cleanup suggestions" },
  { tool: "generate_cleanup_patch", price: "0.15 USDT", note: "Full Patch Kit bundle" },
  { tool: "generate_regression_checklist", price: "0.05 USDT", note: "Regression checklist" },
];

const SAFETY_POLICY = [
  "Public GitHub repositories only — no private tokens required",
  "No repository mutation or auto-delete",
  ".env files detected but never read or displayed",
  "cleanup.patch includes safe candidates only",
  "Review First findings are documented, not patched",
];

const SUBMISSION_CHECKLIST = [
  "Live deployment URL loads RepoDiet app",
  "GET /api/tools/health returns ok: true",
  "GET /api/tools/manifest returns tool schemas",
  "POST /api/tools/scan_repo_bloat works on a public repo",
  "PATCH bundle generates conservative artifacts (no unsafe deletes)",
  "Docs page documents all endpoints with curl examples",
  "OKX listing describes A2MCP-ready APIs honestly (payment gateway optional)",
];

export function OkxPageContent() {
  const [baseUrl, setBaseUrl] = useState(getServerBaseUrl());

  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(window.location.origin);
    }
  }, []);

  const manifestUrl = `${baseUrl}/api/tools/manifest`;
  const healthUrl = `${baseUrl}/api/tools/health`;
  const sampleCurl = buildToolCurl(baseUrl, "/api/tools/scan_repo_bloat", {
    repoUrl: "https://github.com/smokychain22/agentPass",
    branch: "main",
    mode: "quick",
  });

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
          OKX.AI ASP · Software Utility
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">RepoDiet on OKX.AI</h1>
        <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
          RepoDiet is a Software Utility Agent Service Provider for the OKX.AI Genesis Hackathon.
          Agents call A2MCP-ready JSON tools for scanning and patch generation. Full cleanup
          workflows can be delivered as A2A agent tasks with optional x402 settlement at the gateway
          layer.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
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
          <CopyButton text={sampleCurl} label="Copy sample curl" />
          <Button asChild variant="outline" size="sm">
            <Link href="/app">Run Scan</Link>
          </Button>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <Card className="border-border/80 bg-card/50">
            <CardHeader>
              <Blocks className="mb-2 h-4 w-4 text-electric" />
              <CardTitle className="text-sm">Category</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">Software Utility</CardContent>
          </Card>
          <Card className="border-border/80 bg-card/50">
            <CardHeader>
              <Cpu className="mb-2 h-4 w-4 text-electric" />
              <CardTitle className="text-sm">A2MCP-ready APIs</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {LIVE_TOOLS.length} live JSON tools · v{A2MCP_VERSION}
            </CardContent>
          </Card>
          <Card className="border-border/80 bg-card/50">
            <CardHeader>
              <Network className="mb-2 h-4 w-4 text-signal" />
              <CardTitle className="text-sm">A2A service</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              End-to-end repo cleanup delivery
            </CardContent>
          </Card>
        </div>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">Live A2MCP-ready endpoints</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Callable today via POST with a public GitHub repo URL. No browser session or scan ID
            required. Also available: <code className="font-mono text-xs">GET /api/tools/health</code>{" "}
            and <code className="font-mono text-xs">GET /api/tools/manifest</code>.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {LIVE_TOOLS.map((tool) => (
              <Badge key={tool} variant="signal" className="font-mono text-xs">
                {tool}
              </Badge>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">A2A cleanup service</h2>
          <Card className="mt-4 border-border/80">
            <CardContent className="py-4 text-sm text-muted-foreground leading-relaxed space-y-3">
              <p>
                RepoDiet delivers agent-to-agent cleanup workflows: scan a JavaScript/TypeScript
                repository, classify findings into safe / review-first / do-not-touch buckets, and
                return a Patch Kit bundle with report, conservative cleanup patch, package
                suggestions, regression checklist, Cursor prompt, and findings.json.
              </p>
              <p>
                Agents can chain tools — for example{" "}
                <code className="font-mono text-xs">scan_repo_bloat</code> →{" "}
                <code className="font-mono text-xs">generate_cleanup_patch</code> →{" "}
                <code className="font-mono text-xs">generate_regression_checklist</code> — without
                human UI interaction.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">Proposed pricing (x402)</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            ASP pricing model for OKX listing. Public demo endpoints are currently open — payment/x402
            enforcement is not live on the demo deployment.
          </p>
          <div className="mt-4 space-y-2">
            {PROPOSED_PRICING.map((row) => (
              <div
                key={row.tool}
                className="flex flex-col gap-1 rounded-md border border-border bg-card/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <span className="font-mono text-sm">{row.tool}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">{row.note}</p>
                </div>
                <span className="font-mono text-sm text-electric shrink-0">{row.price}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-signal" />
            Safety policy
          </h2>
          <Card className="mt-4 border-signal/20 bg-signal/5">
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
          <h2 className="text-lg font-semibold">A2MCP readiness</h2>
          <Card className="mt-4 border-electric/20 bg-electric/5">
            <CardContent className="py-4 text-sm text-muted-foreground leading-relaxed">
              RepoDiet endpoints are A2MCP-ready deterministic JSON tools. Payment/x402 enforcement
              can be added at the gateway/listing layer. Current public demo endpoints are open for
              review and hackathon testing.
            </CardContent>
          </Card>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">Submission checklist</h2>
          <Card className="mt-4 border-border/80">
            <CardContent className="py-4">
              <ul className="space-y-3">
                {SUBMISSION_CHECKLIST.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal/80" />
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        <div className="mt-12 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/app">Open App</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/docs">Read API Docs</Link>
          </Button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
