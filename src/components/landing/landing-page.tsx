import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/layout/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeroTerminal } from "@/components/landing/hero-terminal";
import { MarketingCta } from "@/components/landing/marketing-cta";
import { ArtifactPreviews } from "@/components/landing/artifact-previews";
import { A2mcpToolsSection } from "@/components/landing/a2mcp-tools-section";
import {
  A2MCP_READINESS_COPY,
  AFTER_ITEMS,
  BEFORE_ITEMS,
  FLOW_METRICS,
  HOW_IT_WORKS,
  PRICING_TIERS,
  PROBLEM_CARDS,
  TRUST_LINE,
} from "@/lib/marketing/content";

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main>
        {/* 1. Hero */}
        <section className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <Badge variant="electric" className="mb-6 font-mono text-[10px] uppercase tracking-wider">
                Software Utility · A2MCP-ready
              </Badge>
              <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-[3.25rem] lg:leading-[1.1]">
                AI built your app fast.
                <br />
                <span className="text-electric">RepoDiet keeps the codebase alive.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base text-muted-foreground sm:text-lg leading-relaxed">
                Scan AI-built JavaScript and TypeScript repos for duplicate code, unused files,
                dependency drift, orphan modules, and AI-slop signals — then generate a conservative
                cleanup bundle.
              </p>
              <MarketingCta size="lg" className="mt-8" />
              <p className="mt-6 font-mono text-[11px] text-muted-foreground">{TRUST_LINE}</p>
            </div>
            <HeroTerminal />
          </div>
        </section>

        {/* 3. Problem */}
        <section className="border-y border-border bg-card/30">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              The problem
            </h2>
            <p className="mt-2 max-w-xl text-2xl font-semibold tracking-tight">
              Fast AI output. Slow cleanup debt.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PROBLEM_CARDS.map((item) => (
                <Card key={item.title} className="border-border/80 bg-card/60">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{item.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {item.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* 4. How it works */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            How RepoDiet works
          </h2>
          <p className="mt-2 text-2xl font-semibold tracking-tight">
            Conservative cleanup bundle — not auto-clean
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((step) => (
              <Card key={step.step} className="border-border/80 bg-card/50">
                <CardHeader className="pb-2">
                  <span className="font-mono text-xs text-electric">Step {step.step}</span>
                  <CardTitle className="text-base mt-1">{step.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* 5. Before / After */}
        <section className="border-y border-border bg-card/30">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Before / After
            </h2>
            <p className="mt-2 text-2xl font-semibold tracking-tight">
              From messy AI repos to review-ready cleanup
            </p>
            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              <Card className="border-red-500/20 bg-red-500/5">
                <CardHeader>
                  <CardTitle className="text-base text-red-300/90">Before RepoDiet</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {BEFORE_ITEMS.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="text-red-400/80">—</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              <Card className="border-signal/20 bg-signal/5">
                <CardHeader>
                  <CardTitle className="text-base text-signal">After RepoDiet</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {AFTER_ITEMS.map((item) => (
                      <li key={item} className="flex gap-2">
                        <Check className="h-4 w-4 shrink-0 text-signal mt-0.5" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
              {FLOW_METRICS.map((label, i) => (
                <div key={label} className="flex items-center gap-2 sm:gap-3">
                  <span className="rounded-md border border-border bg-card px-3 py-1.5 font-mono text-xs sm:text-sm">
                    {label}
                  </span>
                  {i < FLOW_METRICS.length - 1 && (
                    <ArrowRight className="h-4 w-4 text-muted-foreground hidden sm:block" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 6. Artifacts */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Patch bundle artifacts
          </h2>
          <p className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight">
            Seven deliverables in every ZIP bundle
          </p>
          <div className="mt-10">
            <ArtifactPreviews />
          </div>
        </section>

        {/* 7. A2MCP */}
        <section className="border-y border-border bg-card/30">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              A2MCP-ready API tools
            </h2>
            <p className="mt-2 text-2xl font-semibold tracking-tight">
              Deterministic JSON endpoints for agents
            </p>
            <div className="mt-8">
              <A2mcpToolsSection />
            </div>
          </div>
        </section>

        {/* 8. Pricing preview */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Pricing
          </h2>
          <p className="mt-2 text-2xl font-semibold tracking-tight">
            ASP tiers for OKX listing — demo open today
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Public demo endpoints are free. Proposed x402 pricing for production gateway — not
            enforced on demo deployment.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PRICING_TIERS.map((tier) => (
              <Card
                key={tier.name}
                className={
                  tier.highlighted
                    ? "border-electric/40 bg-electric/5 ring-1 ring-electric/20"
                    : "border-border/80 bg-card/60"
                }
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{tier.name}</CardTitle>
                  <p className="font-mono text-2xl font-semibold text-electric mt-2">{tier.price}</p>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5 text-xs text-muted-foreground mb-4">
                    {tier.features.slice(0, 4).map((f) => (
                      <li key={f}>— {f}</li>
                    ))}
                  </ul>
                  <Button asChild variant={tier.highlighted ? "default" : "secondary"} size="sm" className="w-full">
                    <Link href={tier.href}>{tier.cta}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-6">
            <Button asChild variant="outline">
              <Link href="/pricing">
                View full pricing
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>

        {/* 9. OKX */}
        <section className="border-y border-border bg-card/30">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <Badge variant="signal" className="mb-4">
              OKX.AI Genesis Hackathon
            </Badge>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Built for the agent economy
            </h2>
            <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
              {A2MCP_READINESS_COPY}
            </p>
            <Button asChild className="mt-6" variant="secondary">
              <Link href="/okx">
                OKX ASP details
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>

        {/* 10. Final CTA */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Keep your AI-built codebase maintainable
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
            Scan a public repo, map findings, generate a conservative patch bundle, and verify before
            you merge.
          </p>
          <MarketingCta size="lg" className="mt-8 justify-center" />
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
