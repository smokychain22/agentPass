import Link from "next/link";
import { ArrowRight, Check, Shield } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/layout/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeroTerminal } from "@/components/landing/hero-terminal";
import { HeroCta } from "@/components/landing/hero-cta";
import { PipelineDiagram } from "@/components/landing/pipeline-diagram";
import { ArtifactPreviews } from "@/components/landing/artifact-previews";
import { DemoRepoSection } from "@/components/landing/demo-repo-section";
import { A2mcpToolsSection } from "@/components/landing/a2mcp-tools-section";
import {
  AFTER_ITEMS,
  API_SECTION,
  BEFORE_ITEMS,
  FLOW_METRICS,
  HERO,
  OUTPUTS_SECTION,
  PIPELINE_STEPS,
  PRICING_SECTION,
  PRICING_TIERS,
  PROBLEM_CARDS,
  PROBLEM_SECTION,
  SAFETY_CARDS,
  SAFETY_SECTION,
  TRANSFORMATION_SECTION,
  TRUST_LINE,
} from "@/lib/marketing/content";

export function LandingPage() {
  return (
    <div className="landing-shell relative flex min-h-screen flex-col">
      <div className="landing-grid pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="landing-glow pointer-events-none fixed inset-0 z-0" aria-hidden />

      <SiteHeader />

      <main className="relative z-10">
        {/* 1. Hero */}
        <section className="mx-auto max-w-6xl px-4 pb-24 pt-16 sm:px-6 sm:pt-28">
          <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-16">
            <div>
              <Badge
                variant="electric"
                className="mb-6 font-mono text-[10px] uppercase tracking-[0.2em]"
              >
                {HERO.badge}
              </Badge>
              <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-[3.15rem] lg:leading-[1.08]">
                {HERO.headline}
              </h1>
              <p className="mt-6 max-w-xl text-base text-muted-foreground sm:text-lg leading-relaxed">
                {HERO.subheadline}
              </p>
              <HeroCta className="mt-8" />
              <p className="mt-6 font-mono text-[11px] text-muted-foreground">{TRUST_LINE}</p>
            </div>
            <div className="relative">
              <div className="absolute -inset-4 rounded-2xl bg-electric/5 blur-2xl" aria-hidden />
              <HeroTerminal />
            </div>
          </div>
        </section>

        {/* 2. Pain: AI cleanup debt */}
        <section className="border-y border-border/80 bg-panel/50">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {PROBLEM_SECTION.eyebrow}
            </p>
            <h2 className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
              {PROBLEM_SECTION.title}
            </h2>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PROBLEM_CARDS.map((item, i) => (
                <Card
                  key={item.title}
                  className={`bento-card border-border/70 bg-card/70 ${
                    i === 0 ? "lg:col-span-2 lg:row-span-1" : ""
                  }`}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-medium">{item.title}</CardTitle>
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

        {/* 3. Product pipeline diagram */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            How it works
          </p>
          <h2 className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            From messy repo to review-ready cleanup bundle
          </h2>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground leading-relaxed">
            Conservative cleanup — not auto-clean. Every step produces artifacts your team can
            review before anything merges.
          </p>
          <div className="mt-12">
            <PipelineDiagram />
          </div>
          <p className="mt-8 text-center font-mono text-xs text-muted-foreground">
            {PIPELINE_STEPS.map((s) => s.title).join(" → ")}
          </p>
        </section>

        {/* 4. Before / After transformation */}
        <section className="border-y border-border/80 bg-panel/50">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {TRANSFORMATION_SECTION.eyebrow}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              {TRANSFORMATION_SECTION.title}
            </h2>
            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              <Card className="border-red-500/15 bg-red-950/10">
                <CardHeader>
                  <CardTitle className="text-base text-red-300/90">Before RepoDiet</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2.5 text-sm text-muted-foreground">
                    {BEFORE_ITEMS.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="text-red-400/70">—</span>
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
                  <ul className="space-y-2.5 text-sm text-muted-foreground">
                    {AFTER_ITEMS.map((item) => (
                      <li key={item} className="flex gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
              {FLOW_METRICS.map((label, i) => (
                <div key={label} className="flex items-center gap-2 sm:gap-3">
                  <span className="rounded-md border border-border/80 bg-card/80 px-3 py-1.5 font-mono text-xs sm:text-sm">
                    {label}
                  </span>
                  {i < FLOW_METRICS.length - 1 && (
                    <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 5. Cleanup artifacts */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {OUTPUTS_SECTION.eyebrow}
          </p>
          <h2 className="mt-2 max-w-3xl text-2xl font-semibold tracking-tight sm:text-3xl">
            {OUTPUTS_SECTION.title}
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">{OUTPUTS_SECTION.subtitle}</p>
          <div className="mt-12">
            <ArtifactPreviews />
          </div>
        </section>

        {/* 6. Safety model */}
        <section className="border-y border-border/80 bg-panel/50">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="flex items-start gap-3">
              <Shield className="mt-1 h-5 w-5 shrink-0 text-signal" />
              <div>
                <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                  {SAFETY_SECTION.eyebrow}
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {SAFETY_SECTION.title}
                </h2>
              </div>
            </div>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {SAFETY_CARDS.map((card) => (
                <Card key={card.title} className="bento-card border-border/70 bg-card/70">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-medium">{card.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {card.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* 7. Demo repo */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <DemoRepoSection />
        </section>

        {/* 8. API / agent-ready */}
        <section className="border-y border-border/80 bg-panel/50">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {API_SECTION.eyebrow}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              {API_SECTION.title}
            </h2>
            <p className="mt-3 max-w-2xl text-muted-foreground leading-relaxed">
              {API_SECTION.description}
            </p>
            <div className="mt-10">
              <A2mcpToolsSection />
            </div>
          </div>
        </section>

        {/* 9. Pricing preview */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {PRICING_SECTION.eyebrow}
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {PRICING_SECTION.title}
          </h2>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground leading-relaxed">
            {PRICING_SECTION.description}
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PRICING_TIERS.map((tier) => (
              <Card
                key={tier.name}
                className={
                  tier.highlighted
                    ? "border-electric/35 bg-electric/5 ring-1 ring-electric/15"
                    : "bento-card border-border/70 bg-card/70"
                }
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{tier.name}</CardTitle>
                  <p className="mt-2 font-mono text-2xl font-semibold text-electric">
                    {tier.price}
                  </p>
                </CardHeader>
                <CardContent>
                  <p className="mb-4 text-xs text-muted-foreground leading-relaxed">
                    {tier.description}
                  </p>
                  <ul className="mb-4 space-y-1.5 text-xs text-muted-foreground">
                    {tier.features.slice(0, 4).map((f) => (
                      <li key={f}>— {f}</li>
                    ))}
                  </ul>
                  <Button
                    asChild
                    variant={tier.highlighted ? "default" : "secondary"}
                    size="sm"
                    className="w-full"
                  >
                    <Link href={tier.href}>{tier.cta}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-8">
            <Button asChild variant="outline">
              <Link href="/pricing">
                View full pricing
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <SiteFooter variant="product" />
    </div>
  );
}
