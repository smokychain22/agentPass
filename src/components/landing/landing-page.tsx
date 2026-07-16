import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/layout/site-header";
import { HeroCta } from "@/components/landing/hero-cta";
import { LiveExecutionEngine } from "@/components/landing/live-execution/live-execution-engine";
import {
  A2aDeliverySection,
  AgentComparisonSection,
  CleanupCapabilitiesSection,
  CredibilityStrip,
  FinalCtaSection,
  GreenPrProtocolSection,
  LiveProofSection,
  ProblemDebtSection,
  ProductWorkflowSection,
  SafetyBoundariesSection,
} from "@/components/landing/landing-sections";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/design-system/container";
import { GridBackground } from "@/components/design-system/grid-background";
import { HERO } from "@/lib/marketing/content";

const HERO_TRUST = [
  "No direct main pushes",
  "Scope locked before execution",
  "Independent verification",
  "Owner controls merge",
] as const;

export function LandingPage() {
  return (
    <div className="landing-shell relative flex min-h-screen flex-col bg-[#05090F]">
      <GridBackground variant="hero" className="fixed inset-0 z-0 opacity-70" />

      <SiteHeader />

      <main className="relative z-10">
        <section className="relative overflow-hidden pb-10 pt-8 sm:pb-12 sm:pt-10 lg:pt-9">
          <Container>
            <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,0.44fr)_minmax(0,0.56fr)] lg:items-center lg:gap-9">
              <div className="min-w-0">
                <Badge
                  variant="cyan"
                  className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em]"
                >
                  {HERO.badge}
                </Badge>
                <h1 className="ds-hero-title max-w-[16ch] text-[#F2F6FA]">
                  Turn repository debt into a verified cleanup pull request.
                </h1>
                <p className="mt-4 max-w-[650px] text-base leading-relaxed text-[#8FA2B7] sm:text-lg">
                  {HERO.productSubheadline}
                </p>
                <p className="mt-3 max-w-[650px] text-sm font-medium text-[#F2F6FA] sm:text-base">
                  Coding agents write code. RepoDiet proves the cleanup is safe.
                </p>
                <HeroCta className="mt-6" />
                <ul
                  className="mt-5 flex flex-wrap gap-x-4 gap-y-2"
                  aria-label="Trust points"
                >
                  {HERO_TRUST.map((point) => (
                    <li
                      key={point}
                      className="flex items-center gap-1.5 font-mono text-[11px] text-[#8FA2B7]"
                    >
                      <span className="h-1 w-1 rounded-full bg-[#21D9A0]" aria-hidden />
                      {point}
                    </li>
                  ))}
                </ul>
                <p className="mt-4">
                  <Link
                    href="/#green-pr-protocol"
                    className="inline-flex items-center gap-1 font-mono text-[12px] text-[#66788D] transition-colors hover:text-[#46D1FF]"
                  >
                    Open Green PR Proof
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </p>
              </div>
              <div id="product-engine" className="min-w-0 scroll-mt-24 lg:self-center">
                <LiveExecutionEngine />
              </div>
            </div>
          </Container>
        </section>

        <CredibilityStrip />
        <ProblemDebtSection />
        <AgentComparisonSection />
        <GreenPrProtocolSection />
        <LiveProofSection />
        <CleanupCapabilitiesSection />
        <ProductWorkflowSection />
        <SafetyBoundariesSection />
        <A2aDeliverySection />
        <FinalCtaSection />
      </main>

      <SiteFooter variant="product" />
    </div>
  );
}
