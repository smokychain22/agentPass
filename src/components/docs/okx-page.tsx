"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Blocks, CheckCircle2, Cpu, ExternalLink, Network, Shield } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/layout/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { A2MCP_VERSION } from "@/lib/a2mcp/constants";
import { buildToolCurl, getServerBaseUrl } from "@/lib/docs/base-url";
import { MarketingCta } from "@/components/landing/marketing-cta";
import {
  A2MCP_READINESS_COPY,
  A2MCP_TOOLS_HIGHLIGHT,
  AGENT_API_PRICING,
  OKX_A2A_SERVICE,
  OKX_COMPETITIVE_POSITION,
  OKX_DEMO_FLOW,
  OKX_JUDGE_PITCH,
  PRICING_TIERS,
} from "@/lib/marketing/content";
import { CopyButton } from "./copy-button";

const LIVE_TOOLS = A2MCP_TOOLS_HIGHLIGHT;

const PROPOSED_PRICING = AGENT_API_PRICING.map((row) => ({
  tool: row.tool,
  price: row.price,
  note: row.operation,
}));

const SAFETY_POLICY = [
  "Never pushes directly to main — cleanup PRs use a separate branch",
  "Never merges pull requests automatically — human review required",
  "Only safe-candidate files are deleted on cleanup branches",
  "Review First findings are documented, not changed",
  "Routes, configs, env files, lockfiles, and public assets are protected",
  "User GitHub tokens are used once and never stored",
];

const SUBMISSION_CHECKLIST = [
  "Live deployment URL loads RepoDiet app",
  "GET /api/tools/health returns ok: true",
  "GET /api/tools/manifest returns tool schemas",
  "POST /api/tools/scan_repo_bloat works on a public repo",
  "Generate Patch Kit — conservative bundle with 7 artifacts",
  "Create Cleanup PR via RepoDiet Operator",
  "Open GitHub PR and run regression checklist before merging",
  "POST /api/tools/create_cleanup_pr returns PR URL and safety summary",
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
          RepoDiet Operator is a Software Utility Agent Service Provider for the OKX.AI Genesis
          Hackathon. Agents call A2MCP-ready JSON tools for scanning, patch generation, and cleanup
          PR creation. Full cleanup workflows can be delivered as A2A agent tasks with optional
          x402 settlement at the gateway layer — not live on the public demo deployment.
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
          <h2 className="text-lg font-semibold">Why RepoDiet wins on outcomes</h2>
          <Card className="mt-4 border-electric/20 bg-electric/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{OKX_JUDGE_PITCH.headline}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed space-y-4">
              <p>{OKX_JUDGE_PITCH.problem}</p>
              <p>{OKX_JUDGE_PITCH.differentiation}</p>
              <p className="font-medium text-foreground">{OKX_JUDGE_PITCH.proofContract}</p>
              <ul className="space-y-2">
                {OKX_JUDGE_PITCH.vsAgents.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-electric" />
                    {item}
                  </li>
                ))}
              </ul>
              <p>{OKX_JUDGE_PITCH.agentUtility}</p>
              <div>
                <p className="mb-2 font-medium text-foreground">Live demo proof points</p>
                <ul className="space-y-1">
                  {OKX_JUDGE_PITCH.demoProof.map((item) => (
                    <li key={item} className="flex gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
          <p className="mt-3 text-xs text-muted-foreground">
            Market context: {OKX_COMPETITIVE_POSITION.nearDirect}{" "}
            {OKX_COMPETITIVE_POSITION.adjacent} RepoDiet owns{" "}
            {OKX_COMPETITIVE_POSITION.repodietCategory}
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">A2A cleanup service</h2>
          <Card className="mt-4 border-border/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{OKX_A2A_SERVICE.name}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed space-y-3">
              <p>{OKX_A2A_SERVICE.description}</p>
              <p>
                Agents can chain tools — for example{" "}
                <code className="font-mono text-xs">scan_repo_bloat</code> →{" "}
                <code className="font-mono text-xs">generate_cleanup_patch</code> →{" "}
                <code className="font-mono text-xs">create_cleanup_pr</code> — without human UI
                interaction.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">Pricing</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            ASP tiers for OKX listing. Public demo endpoints are open — A2MCP-ready APIs are live;
            x402 payment enforcement is not live on the demo deployment.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {PRICING_TIERS.map((tier) => (
              <div
                key={tier.name}
                className="rounded-md border border-border bg-card/50 px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-sm">{tier.name}</span>
                  <span className="font-mono text-sm text-electric shrink-0">{tier.price}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{tier.description}</p>
              </div>
            ))}
          </div>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href="/pricing">View full pricing</Link>
          </Button>
          <details className="mt-6">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
              Per-tool proposed pricing (x402)
            </summary>
            <div className="mt-3 space-y-2">
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
          </details>
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
          <h2 className="text-lg font-semibold">A2MCP-ready endpoints</h2>
          <Card className="mt-4 border-electric/20 bg-electric/5">
            <CardContent className="py-4 text-sm text-muted-foreground leading-relaxed">
              {A2MCP_READINESS_COPY}
            </CardContent>
          </Card>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">Demo flow</h2>
          <Card className="mt-4 border-border/80">
            <CardContent className="py-4">
              <ol className="space-y-3">
                {OKX_DEMO_FLOW.map((step, i) => (
                  <li key={step} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border font-mono text-xs text-electric">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
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

        <div className="mt-12">
          <MarketingCta />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
