import Link from "next/link";
import { ArrowRight, Shield } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/layout/site-header";
import { HeroCleanupEngine } from "@/components/landing/hero-cleanup-engine";
import { HeroCta } from "@/components/landing/hero-cta";
import { RepositoryDebtBento } from "@/components/landing/repository-debt-bento";
import { WorkflowPipeline } from "@/components/landing/workflow-pipeline";
import { TransformationSection } from "@/components/landing/transformation-section";
import { PatchBundleWorkspace } from "@/components/landing/patch-bundle-workspace";
import { SafetyBoundary } from "@/components/landing/safety-boundary";
import { DemoRepoSection } from "@/components/landing/demo-repo-section";
import { A2mcpToolsSection } from "@/components/landing/a2mcp-tools-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/design-system/container";
import { SectionHeader } from "@/components/design-system/section-header";
import { GridBackground } from "@/components/design-system/grid-background";
import { PricingCard } from "@/components/design-system/pricing-card";
import {
  API_SECTION,
  HERO,
  OUTPUTS_SECTION,
  PRICING_SECTION,
  PRICING_TIERS,
  PROBLEM_SECTION,
  SAFETY_SECTION,
  SITE_TAGLINES,
  TRANSFORMATION_SECTION,
  TRUST_POINTS,
} from "@/lib/marketing/content";

export function LandingPage() {
  return (
    <div className="landing-shell relative flex min-h-screen flex-col">
      <GridBackground variant="hero" className="fixed inset-0 z-0" />

      <SiteHeader />

      <main className="relative z-10">
        {/* Hero */}
        <section className="relative overflow-hidden pb-20 pt-14 sm:pt-24">
          <Container>
            <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-14">
              <div>
                <Badge variant="cyan" className="mb-5 font-mono text-[10px] uppercase tracking-[0.2em]">
                  {HERO.badge}
                </Badge>
                <h1 className="ds-hero-title">{HERO.headline}</h1>
                <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                  {HERO.subheadline}
                </p>
                <HeroCta className="mt-8" />
                <ul className="mt-6 flex flex-wrap gap-x-4 gap-y-2" aria-label="Trust points">
                  {TRUST_POINTS.map((point) => (
                    <li key={point} className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                      <span className="h-1 w-1 rounded-full bg-signal" aria-hidden />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
              <HeroCleanupEngine />
            </div>
          </Container>
        </section>

        {/* Repository debt */}
        <section className="section-alt relative">
          <Container as="section" className="py-16 sm:py-20">
            <SectionHeader
              label={PROBLEM_SECTION.eyebrow}
              title={PROBLEM_SECTION.title}
              description={SITE_TAGLINES.debt}
            />
            <div className="mt-10">
              <RepositoryDebtBento />
            </div>
          </Container>
        </section>

        {/* Workflow */}
        <section id="product" className="relative py-16 sm:py-20">
          <Container as="section">
            <SectionHeader
              label="How it works"
              title="Scan the repo. Classify risk. Package for review."
              description={SITE_TAGLINES.positioning}
            />
            <div className="mt-10">
              <WorkflowPipeline />
            </div>
          </Container>
        </section>

        {/* Transformation */}
        <section className="section-alt relative">
          <Container as="section" className="py-16 sm:py-20">
            <SectionHeader
              label={TRANSFORMATION_SECTION.eyebrow}
              title={TRANSFORMATION_SECTION.title}
            />
            <div className="mt-10">
              <TransformationSection />
            </div>
          </Container>
        </section>

        {/* Patch bundle workspace */}
        <section className="relative py-16 sm:py-20">
          <Container as="section">
            <SectionHeader
              label={OUTPUTS_SECTION.eyebrow}
              title={OUTPUTS_SECTION.title}
              description={OUTPUTS_SECTION.subtitle}
            />
            <div className="mt-10">
              <PatchBundleWorkspace />
            </div>
          </Container>
        </section>

        {/* Safety boundary */}
        <section className="section-alt relative">
          <Container as="section" className="py-16 sm:py-20">
            <div className="flex items-start gap-3">
              <Shield className="mt-1 h-5 w-5 shrink-0 text-signal" strokeWidth={1.5} aria-hidden />
              <SectionHeader
                label={SAFETY_SECTION.eyebrow}
                title={SAFETY_SECTION.title}
                description={SITE_TAGLINES.safety}
                className="flex-1"
              />
            </div>
            <div className="mt-10">
              <SafetyBoundary />
            </div>
          </Container>
        </section>

        {/* Live demo */}
        <section className="relative py-16 sm:py-20">
          <Container as="section">
            <DemoRepoSection />
          </Container>
        </section>

        {/* Agent/API */}
        <section className="section-alt relative">
          <Container as="section" className="py-16 sm:py-20">
            <SectionHeader
              label={API_SECTION.eyebrow}
              title={API_SECTION.title}
              description={API_SECTION.description}
            />
            <div className="mt-8">
              <A2mcpToolsSection />
            </div>
          </Container>
        </section>

        {/* Pricing preview */}
        <section className="relative py-16 sm:py-20">
          <Container as="section">
            <SectionHeader
              label={PRICING_SECTION.eyebrow}
              title={PRICING_SECTION.title}
              description={PRICING_SECTION.description}
            />
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PRICING_TIERS.map((tier) => (
                <PricingCard key={tier.name} tier={tier} />
              ))}
            </div>
            <p className="mt-6 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {PRICING_SECTION.note}
            </p>
            <div className="mt-6">
              <Button asChild variant="outline">
                <Link href="/pricing">
                  View Full Pricing
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </Container>
        </section>
      </main>

      <SiteFooter variant="product" />
    </div>
  );
}
