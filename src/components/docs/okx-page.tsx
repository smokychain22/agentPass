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
  AGENT_API_PRICING,
  OKX_A2A_SERVICE,
  OKX_A2MCP_SERVICE,
  OKX_COMPETITIVE_POSITION,
  OKX_DEMO_FLOW,
  OKX_JUDGE_PITCH,
  PRICING_TIERS,
} from "@/lib/marketing/content";
import { CopyButton } from "./copy-button";

const SAFETY_POLICY = [
  "Never pushes directly to main — cleanup PRs use a separate branch",
  "Never merges pull requests automatically — human review / buyer acceptance required",
  "Only safe-candidate files are deleted on cleanup branches",
  "Review First findings are documented, not changed",
  "Routes, configs, env files, lockfiles, and public assets are protected",
  "A2MCP Quick Triage is read-only; A2A delivery mutates only an isolated branch",
];

const SUBMISSION_CHECKLIST = [
  "Canonical production origin: https://skillswap-virid-kappa.vercel.app",
  "ASP Agent ID 5283 · A2A 32947 · A2MCP 32948",
  "GET /api/tools/health returns ok: true",
  "GET /api/tools/manifest returns the two-service pricing model",
  "GET /.well-known/agent-card.json distinguishes A2MCP x402 vs A2A escrow",
  "POST /api/a2mcp/quick-triage challenges unpaid calls with x402 (0.03 USD₮0)",
  "GET /api/okx/trust-root exposes the pinned SPKI public key",
  "GET /api/okx/receipts/{receiptId} verifies RSA-SHA256 receipts",
  "A2A create_cleanup_pr is negotiated escrow delivery — not A2MCP pay-per-call",
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
  const agentCardUrl = `${baseUrl}/.well-known/agent-card.json`;
  const trustRootUrl = `${baseUrl}/api/okx/trust-root`;
  const sampleCurl = buildToolCurl(baseUrl, "/api/a2mcp/quick-triage", {
    repositoryUrl: "https://github.com/smokychain22/agentPass",
    branch: "main",
    maximumFindings: 5,
    operation: "analyze_repository",
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
          OKX.AI ASP 5283 · Two live services
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">RepoDiet on OKX.AI</h1>
        <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
          RepoDiet Operator is a Software Utility ASP with an explicit protocol split:{" "}
          <strong className="text-foreground">A2MCP</strong> standardizes Quick Triage pay-per-call
          through x402; <strong className="text-foreground">A2A</strong> delivers customized cleanup
          PRs through negotiated task terms, escrow, and buyer acceptance.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={manifestUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              Open Manifest
            </a>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <a href={agentCardUrl} target="_blank" rel="noopener noreferrer">
              Agent Card
            </a>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <a href={trustRootUrl} target="_blank" rel="noopener noreferrer">
              Trust Root
            </a>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <a href={healthUrl} target="_blank" rel="noopener noreferrer">
              Test Health
            </a>
          </Button>
          <CopyButton text={sampleCurl} label="Copy Quick Triage curl" />
          <Button asChild variant="outline" size="sm">
            <Link href="/app">Open App</Link>
          </Button>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <Card className="border-border/80 bg-card/50">
            <CardHeader>
              <Blocks className="mb-2 h-4 w-4 text-electric" />
              <CardTitle className="text-sm">ASP identity</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Agent ID <span className="font-mono text-foreground">5283</span>
            </CardContent>
          </Card>
          <Card className="border-border/80 bg-card/50">
            <CardHeader>
              <Cpu className="mb-2 h-4 w-4 text-electric" />
              <CardTitle className="text-sm">A2MCP Quick Triage</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Service <span className="font-mono text-foreground">32948</span> · v{A2MCP_VERSION}
            </CardContent>
          </Card>
          <Card className="border-border/80 bg-card/50">
            <CardHeader>
              <Network className="mb-2 h-4 w-4 text-signal" />
              <CardTitle className="text-sm">A2A Cleanup PR</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Service <span className="font-mono text-foreground">32947</span>
            </CardContent>
          </Card>
        </div>

        <section className="mt-12" id="a2mcp-quick-triage">
          <h2 className="text-lg font-semibold">A2MCP Quick Triage</h2>
          <Card className="mt-4 border-electric/20 bg-electric/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{OKX_A2MCP_SERVICE.name}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed space-y-3">
              <p>{OKX_A2MCP_SERVICE.description}</p>
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide">Operation</dt>
                  <dd className="font-mono text-foreground">{OKX_A2MCP_SERVICE.operation}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide">Price</dt>
                  <dd className="font-mono text-electric">{OKX_A2MCP_SERVICE.price}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide">Settlement</dt>
                  <dd>{OKX_A2MCP_SERVICE.settlement}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide">Service ID</dt>
                  <dd className="font-mono text-foreground">{OKX_A2MCP_SERVICE.serviceId}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </section>

        <section className="mt-12" id="a2a-cleanup-pr">
          <h2 className="text-lg font-semibold">A2A Verified Cleanup PR</h2>
          <Card className="mt-4 border-border/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{OKX_A2A_SERVICE.name}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed space-y-3">
              <p>{OKX_A2A_SERVICE.description}</p>
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide">Operation</dt>
                  <dd className="font-mono text-foreground">{OKX_A2A_SERVICE.operation}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide">Price</dt>
                  <dd className="font-mono text-electric">
                    {OKX_A2A_SERVICE.price} · default {OKX_A2A_SERVICE.defaultReferencePrice}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wide">Settlement</dt>
                  <dd>{OKX_A2A_SERVICE.settlement}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
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
          <h2 className="text-lg font-semibold">Displayed pricing</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Public OKX listing model — two services only. A2MCP uses live x402; A2A uses escrow and
            buyer acceptance. Not every paid task uses x402.
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
          <div className="mt-6 space-y-2">
            {AGENT_API_PRICING.map((row) => (
              <div
                key={row.tool}
                className="flex flex-col gap-1 rounded-md border border-border bg-card/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <span className="font-medium text-sm">{row.operation}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <span className="font-mono">{row.tool}</span> · {row.protocol} · {row.settlement}
                  </p>
                </div>
                <span className="font-mono text-sm text-electric shrink-0">{row.price}</span>
              </div>
            ))}
          </div>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href="/pricing">View pricing page</Link>
          </Button>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">Acceptance flow</h2>
          <ol className="mt-4 space-y-2 text-sm text-muted-foreground">
            {OKX_DEMO_FLOW.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="font-mono text-xs text-electric">{i + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-signal" />
            Safety policy
          </h2>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            {SAFETY_POLICY.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-signal" />
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">Judge checklist</h2>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            {SUBMISSION_CHECKLIST.map((item) => (
              <li key={item} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Public OKX agent page link is intentionally unset until{" "}
            <span className="font-mono">https://www.okx.ai/agents/5283</span> loads. Do not advertise
            that route yet.
          </p>
        </section>

        <div className="mt-16">
          <MarketingCta />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
