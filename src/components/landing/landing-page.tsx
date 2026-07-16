import Link from "next/link";
import { ArrowRight, CheckCircle2, Shield } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/layout/site-header";
import { HeroCta } from "@/components/landing/hero-cta";
import { RepositoryDebtBento } from "@/components/landing/repository-debt-bento";
import { WorkflowPipeline } from "@/components/landing/workflow-pipeline";
import { ScanToPrSection } from "@/components/landing/scan-to-pr-section";
import { TransformationSection } from "@/components/landing/transformation-section";
import { SafetyBoundary } from "@/components/landing/safety-boundary";
import { DemoRepoSection } from "@/components/landing/demo-repo-section";
import { A2mcpToolsSection } from "@/components/landing/a2mcp-tools-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/design-system/container";
import { SectionHeader } from "@/components/design-system/section-header";
import { GridBackground } from "@/components/design-system/grid-background";
import { Panel } from "@/components/design-system/panel";
import { PricingCard } from "@/components/design-system/pricing-card";
import {
  API_SECTION,
  HERO,
  PRICING_SECTION,
  PRICING_TIERS,
  PROBLEM_SECTION,
  SAFETY_SECTION,
  SCAN_TO_PR_SECTION,
  SITE_TAGLINES,
  TOP3_STORY,
  TRANSFORMATION_SECTION,
  TRUST_POINTS,
  USE_CASES,
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
                  {HERO.productSubheadline}
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
              <Panel variant="cyan" padding="lg">
                <p className="ds-label text-electric">What you receive</p>
                <h2 className="mt-3 text-2xl font-semibold text-foreground">
                  One review-ready maintenance delivery
                </h2>
                <ol className="mt-6 space-y-4">
                  {[
                    ["01", "Prioritized findings", "Repository-backed evidence, not generic advice."],
                    ["02", "Approved cleanup scope", "Only the changes the buyer selected."],
                    ["03", "Real GitHub pull request", "An isolated branch ready for repository-owner review."],
                    ["04", "Verification result", "Checks, protected-path status, and delivery evidence."],
                  ].map(([step, title, description]) => (
                    <li key={step} className="flex gap-3 border-b border-border/40 pb-4 last:border-0 last:pb-0">
                      <span className="font-mono text-xs text-electric">{step}</span>
                      <div>
                        <p className="text-sm font-medium text-foreground">{title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Panel>
            </div>
          </Container>
        </section>

        <section className="border-y border-border/60 bg-card/30 py-14 sm:py-16">
          <Container as="section">
            <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
              <div>
                <p className="ds-label">Why teams use RepoDiet</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
                  Most tools stop at recommendations. RepoDiet completes the maintenance job.
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  The result is a bounded, reviewable GitHub pull request backed by repository checks—not a list the buyer must implement alone.
                </p>
                <Button asChild variant="secondary" className="mt-6">
                  <Link href="/how-it-works">
                    See the complete workflow <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Reduce repository bloat", "Find high-value maintenance work using the repository's actual files and dependency graph."],
                  ["Avoid unsafe manual cleanup", "Protected paths and review-only findings stay outside automatic changes."],
                  ["Receive a real pull request", "RepoDiet opens an isolated branch and PR instead of ending with a report."],
                  ["Review evidence before acceptance", "See scope, changed files, checks, and delivery evidence before deciding."],
                ].map(([title, description]) => (
                  <Panel key={title} variant="elevated" padding="md">
                    <CheckCircle2 className="h-5 w-5 text-signal" aria-hidden />
                    <h3 className="mt-3 text-sm font-semibold text-foreground">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
                  </Panel>
                ))}
              </div>
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

        {/* Scan to PR */}
        <section id="product" className="relative py-16 sm:py-20">
          <Container as="section">
            <SectionHeader
              label={SCAN_TO_PR_SECTION.eyebrow}
              title={SCAN_TO_PR_SECTION.title}
              description={SCAN_TO_PR_SECTION.description}
            />
            <div className="mt-10">
              <ScanToPrSection />
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <Panel variant="elevated" padding="md">
                <p className="ds-label mb-2">Before</p>
                <p className="text-sm text-muted-foreground">{TOP3_STORY.before}</p>
              </Panel>
              <Panel variant="cyan" padding="md">
                <p className="ds-label mb-2 text-signal">After</p>
                <p className="text-sm text-foreground">{TOP3_STORY.after}</p>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{TOP3_STORY.asp}</p>
              </Panel>
            </div>
          </Container>
        </section>

        {/* Workflow */}
        <section className="section-alt relative">
          <Container as="section" className="py-16 sm:py-20">
            <SectionHeader
              label="How it works"
              title="Scan the repo. Classify risk. Open the cleanup PR."
              description={SITE_TAGLINES.positioning}
            />
            <div className="mt-10">
              <WorkflowPipeline />
            </div>
          </Container>
        </section>

        {/* Transformation */}
        <section className="relative py-16 sm:py-20">
          <Container as="section">
            <SectionHeader
              label={TRANSFORMATION_SECTION.eyebrow}
              title={TRANSFORMATION_SECTION.title}
            />
            <div className="mt-10">
              <TransformationSection />
            </div>
          </Container>
        </section>

        {/* Use cases */}
        <section className="section-alt relative">
          <Container as="section" className="py-16 sm:py-20">
            <SectionHeader
              label="Operator"
              title="Real automation for real cleanup debt"
              description="RepoDiet Operator creates review-ready cleanup PRs — not reckless auto-delete."
            />
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {USE_CASES.map((item) => (
                <Panel key={item.title} variant="elevated" padding="md">
                  <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                </Panel>
              ))}
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
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
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
