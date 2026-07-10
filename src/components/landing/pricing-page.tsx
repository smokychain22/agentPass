import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/layout/site-header";
import { MarketingCta } from "@/components/landing/marketing-cta";
import { PricingCard } from "@/components/design-system/pricing-card";
import { SectionHeader } from "@/components/design-system/section-header";
import { Container } from "@/components/design-system/container";
import { Panel } from "@/components/design-system/panel";
import {
  PRICING_SECTION,
  PRICING_TIERS,
  AGENT_API_PRICING,
  CLEANUP_PR_PRICING_NOTE,
  RUNTIME_LIMITS,
  SAFETY_POLICY_PUBLIC,
} from "@/lib/marketing/content";

export function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">
        <Container className="py-12">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to home
          </Link>

          <SectionHeader
            label="Plans"
            title="RepoDiet Pricing"
            description={PRICING_SECTION.description}
          />

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PRICING_TIERS.map((tier) => (
              <PricingCard key={tier.name} tier={tier} />
            ))}
          </div>

          <p className="mt-8 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {PRICING_SECTION.note}
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {CLEANUP_PR_PRICING_NOTE}
          </p>

          <section className="mt-16">
            <h2 className="mb-4 text-lg font-semibold text-foreground">Agent API (launch pricing)</h2>
            <Panel variant="elevated" padding="md">
              <ul className="space-y-2 text-sm text-muted-foreground">
                {AGENT_API_PRICING.map((row) => (
                  <li key={row.operation} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium text-foreground">{row.operation}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{row.tool}</span>
                    </span>
                    <span className="font-mono text-electric">{row.price}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </section>

          <section className="mt-16">
            <h2 className="mb-4 text-lg font-semibold text-foreground">Safety policy</h2>
            <Panel variant="elevated" padding="md">
              <ul className="space-y-2 text-sm text-muted-foreground">
                {SAFETY_POLICY_PUBLIC.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-signal" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </Panel>
          </section>

          <section className="mt-12">
            <h2 className="mb-4 text-lg font-semibold text-foreground">Runtime limits</h2>
            <Panel variant="code" padding="md">
              <ul className="space-y-2 font-mono text-sm text-muted-foreground">
                {RUNTIME_LIMITS.map((item) => (
                  <li key={item}>— {item}</li>
                ))}
              </ul>
            </Panel>
          </section>

          <p className="mt-8 text-xs text-muted-foreground">
            <Link href="/okx" className="text-electric hover:underline">
              View OKX integration
            </Link>{" "}
            for agent marketplace details.
          </p>

          <div className="mt-16">
            <MarketingCta />
          </div>
        </Container>
      </main>
      <SiteFooter />
    </div>
  );
}
