import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { MarketingCta } from "@/components/landing/marketing-cta";
import {
  PRICING_SECTION,
  PRICING_TIERS,
  RUNTIME_LIMITS,
  SAFETY_POLICY_PUBLIC,
} from "@/lib/marketing/content";

export function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#05070A]">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-secondary transition-colors hover:text-[#F8FAFC]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <p className="mono-label">Plans</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#F8FAFC] sm:text-4xl">
          RepoDiet Pricing
        </h1>
        <p className="mt-4 max-w-2xl leading-relaxed text-secondary">
          {PRICING_SECTION.description}
        </p>

        <div className="mt-14 space-y-10">
          <div>
            <p className="mono-label mb-4">For builders</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {PRICING_TIERS.slice(0, 2).map((tier) => (
                <PricingCard key={tier.name} tier={tier} />
              ))}
            </div>
          </div>

          <div>
            <p className="mono-label mb-4">For agent workflows</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:max-w-sm">
              <PricingCard tier={PRICING_TIERS[2]} />
            </div>
          </div>

          <div>
            <p className="mono-label mb-4">For custom cleanup</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:max-w-sm">
              <PricingCard tier={PRICING_TIERS[3]} />
            </div>
          </div>
        </div>

        <p className="mt-10 max-w-2xl text-sm leading-relaxed text-[#64748B]">
          {PRICING_SECTION.note}
        </p>

        <section className="mt-16">
          <h2 className="mb-4 text-lg font-semibold text-[#F8FAFC]">Safety policy</h2>
          <div className="mcc-panel rounded-lg p-5">
            <ul className="space-y-2 text-sm text-secondary">
              {SAFETY_POLICY_PUBLIC.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-signal" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="mb-4 text-lg font-semibold text-[#F8FAFC]">Runtime limits</h2>
          <div className="mcc-panel rounded-lg p-5">
            <ul className="space-y-2 font-mono text-sm text-[#64748B]">
              {RUNTIME_LIMITS.map((item) => (
                <li key={item}>— {item}</li>
              ))}
            </ul>
          </div>
        </section>

        <p className="mt-8 text-xs text-[#64748B]">
          <Link href="/okx" className="text-electric hover:underline">
            View OKX integration
          </Link>{" "}
          for agent marketplace details.
        </p>

        <div className="mt-16">
          <MarketingCta />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function PricingCard({
  tier,
}: {
  tier: (typeof PRICING_TIERS)[number];
}) {
  return (
    <div
      className={
        tier.highlighted
          ? "cta-gradient-border rounded-lg bg-[#111821] p-6 shadow-mcc-glow"
          : "bento-glow mcc-panel rounded-lg p-6"
      }
    >
      <h3 className="text-lg font-semibold text-[#F8FAFC]">{tier.name}</h3>
      <p className="mt-2 font-mono text-3xl font-semibold text-electric">{tier.price}</p>
      <p className="mt-2 text-sm leading-relaxed text-secondary">{tier.description}</p>
      <ul className="mb-6 mt-4 space-y-2 text-sm text-[#64748B]">
        {tier.features.map((feature) => (
          <li key={feature} className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
            {feature}
          </li>
        ))}
      </ul>
      <Button
        asChild
        variant={tier.highlighted ? "default" : "secondary"}
        className="w-full"
      >
        <Link href={tier.href}>{tier.cta}</Link>
      </Button>
    </div>
  );
}
