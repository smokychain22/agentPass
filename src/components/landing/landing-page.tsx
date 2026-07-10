import Link from "next/link";
import {
  Copy,
  Files,
  GitBranch,
  Package,
  ShieldAlert,
  Shield,
  ArrowRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/layout/site-header";
import { HeroTerminal } from "@/components/landing/hero-terminal";
import { HeroCta } from "@/components/landing/hero-cta";
import { BentoCard } from "@/components/landing/bento-card";
import { RepoDietPipeline } from "@/components/landing/repo-diet-pipeline";
import { BeforeAfterDiff } from "@/components/landing/before-after-diff";
import { ArtifactCards } from "@/components/landing/artifact-card";
import { SafetyCards } from "@/components/landing/safety-card";
import { DemoRepoSection } from "@/components/landing/demo-repo-section";
import { A2mcpToolsSection } from "@/components/landing/a2mcp-tools-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  API_SECTION,
  HERO,
  OUTPUTS_SECTION,
  PRICING_SECTION,
  PRICING_TIERS,
  PROBLEM_CARDS,
  PROBLEM_SECTION,
  SAFETY_SECTION,
  SITE_TAGLINES,
  TRANSFORMATION_SECTION,
  TRUST_LINE,
} from "@/lib/marketing/content";

const PROBLEM_ICONS: Record<string, LucideIcon> = {
  "Duplicate logic": Copy,
  "Dead files": Files,
  "Dependency drift": Package,
  "Orphan modules": GitBranch,
  "Fragile cleanup": ShieldAlert,
};

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
                className="mb-6 border-electric/20 bg-electric/5 font-mono text-[10px] uppercase tracking-[0.2em] text-electric"
              >
                {HERO.badge}
              </Badge>
              <h1 className="text-balance text-4xl font-semibold tracking-tight text-[#F8FAFC] sm:text-5xl lg:text-[3.15rem] lg:leading-[1.08]">
                {HERO.headline}
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-secondary sm:text-lg">
                {HERO.subheadline}
              </p>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#64748B]">
                {SITE_TAGLINES.workflow}
              </p>
              <HeroCta className="mt-8" />
              <p className="mt-6 font-mono text-[11px] text-[#64748B]">{TRUST_LINE}</p>
            </div>
            <HeroTerminal />
          </div>
        </section>

        {/* 2. AI cleanup debt */}
        <section className="border-y mcc-border bg-[#070A0F]/80">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <p className="mono-label">{PROBLEM_SECTION.eyebrow}</p>
            <h2 className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight text-[#F8FAFC] sm:text-3xl">
              {PROBLEM_SECTION.title}
            </h2>
            <p className="mt-3 max-w-xl text-sm text-secondary">{SITE_TAGLINES.debt}</p>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PROBLEM_CARDS.map((item, i) => (
                <BentoCard
                  key={item.title}
                  category={item.category}
                  title={item.title}
                  description={item.description}
                  icon={PROBLEM_ICONS[item.title]}
                  span={i === 0 ? "wide" : "default"}
                />
              ))}
            </div>
          </div>
        </section>

        {/* 3. Pipeline diagram */}
        <section id="product" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <p className="mono-label">How it works</p>
          <h2 className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight text-[#F8FAFC] sm:text-3xl">
            Scan the repo. Map the risk. Generate the bundle.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-secondary">
            {SITE_TAGLINES.positioning}
          </p>
          <div className="mt-12">
            <RepoDietPipeline />
          </div>
        </section>

        {/* 4. Before / After */}
        <section className="border-y mcc-border bg-[#070A0F]/80">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <p className="mono-label">{TRANSFORMATION_SECTION.eyebrow}</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#F8FAFC] sm:text-3xl">
              {TRANSFORMATION_SECTION.title}
            </h2>
            <div className="mt-12">
              <BeforeAfterDiff />
            </div>
          </div>
        </section>

        {/* 5. Cleanup artifacts */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <p className="mono-label">{OUTPUTS_SECTION.eyebrow}</p>
          <h2 className="mt-2 max-w-3xl text-2xl font-semibold tracking-tight text-[#F8FAFC] sm:text-3xl">
            {OUTPUTS_SECTION.title}
          </h2>
          <p className="mt-3 text-sm text-secondary">{OUTPUTS_SECTION.subtitle}</p>
          <div className="mt-12">
            <ArtifactCards />
          </div>
        </section>

        {/* 6. Safety model */}
        <section className="border-y mcc-border bg-[#070A0F]/80">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="flex items-start gap-3">
              <Shield className="mt-1 h-5 w-5 shrink-0 text-signal" strokeWidth={1.5} />
              <div>
                <p className="mono-label">{SAFETY_SECTION.eyebrow}</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#F8FAFC] sm:text-3xl">
                  {SAFETY_SECTION.title}
                </h2>
                <p className="mt-3 max-w-xl text-sm text-secondary">{SITE_TAGLINES.safety}</p>
              </div>
            </div>
            <div className="mt-12">
              <SafetyCards />
            </div>
          </div>
        </section>

        {/* 7. Demo repo */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <DemoRepoSection />
        </section>

        {/* 8. API / agent-ready */}
        <section className="border-y mcc-border bg-[#070A0F]/80">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <p className="mono-label">{API_SECTION.eyebrow}</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#F8FAFC] sm:text-3xl">
              {API_SECTION.title}
            </h2>
            <p className="mt-3 max-w-2xl leading-relaxed text-secondary">{API_SECTION.description}</p>
            <div className="mt-10">
              <A2mcpToolsSection />
            </div>
          </div>
        </section>

        {/* 9. Pricing preview */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <p className="mono-label">{PRICING_SECTION.eyebrow}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#F8FAFC] sm:text-3xl">
            {PRICING_SECTION.title}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-secondary">
            {PRICING_SECTION.description}
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PRICING_TIERS.map((tier) => (
              <div
                key={tier.name}
                className={
                  tier.highlighted
                    ? "cta-gradient-border rounded-lg bg-[#111821] p-5 shadow-mcc-glow"
                    : "bento-glow mcc-panel rounded-lg p-5"
                }
              >
                <p className="mono-label mb-2">Plan</p>
                <h3 className="text-base font-semibold text-[#F8FAFC]">{tier.name}</h3>
                <p className="mt-2 font-mono text-2xl font-semibold text-electric">{tier.price}</p>
                <p className="mt-2 text-xs leading-relaxed text-secondary">{tier.description}</p>
                <ul className="mb-4 mt-4 space-y-1.5 text-xs text-[#64748B]">
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
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-2xl text-xs leading-relaxed text-[#64748B]">
            {PRICING_SECTION.note}
          </p>
          <div className="mt-6">
            <Button asChild variant="outline" className="mcc-border">
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
