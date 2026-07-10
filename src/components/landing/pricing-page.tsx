import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/layout/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarketingCta } from "@/components/landing/marketing-cta";
import { A2MCP_READINESS_COPY, PRICING_TIERS, RUNTIME_LIMITS, SAFETY_POLICY_PUBLIC } from "@/lib/marketing/content";

export function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <Badge variant="electric" className="mb-4 font-mono text-[10px] uppercase tracking-wider">
          ASP Pricing
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">RepoDiet Pricing</h1>
        <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
          Proposed micropayment tiers for OKX.AI listing. Public demo deployment is open — x402
          payment enforcement is not live today.
        </p>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PRICING_TIERS.map((tier) => (
            <Card
              key={tier.name}
              className={
                tier.highlighted
                  ? "border-electric/40 bg-electric/5 ring-1 ring-electric/20"
                  : "border-border/80 bg-card/60"
              }
            >
              <CardHeader>
                <CardTitle className="text-lg">{tier.name}</CardTitle>
                <p className="font-mono text-3xl font-semibold text-electric mt-2">{tier.price}</p>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  {tier.description}
                </p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground mb-6">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <Check className="h-4 w-4 shrink-0 text-signal mt-0.5" />
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
              </CardContent>
            </Card>
          ))}
        </div>

        <section className="mt-16">
          <h2 className="text-lg font-semibold mb-4">Safety policy</h2>
          <Card className="border-signal/20 bg-signal/5">
            <CardContent className="py-4">
              <ul className="space-y-2 text-sm text-muted-foreground">
                {SAFETY_POLICY_PUBLIC.map((item) => (
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
          <h2 className="text-lg font-semibold mb-4">Runtime limits</h2>
          <Card className="border-border/80">
            <CardContent className="py-4">
              <ul className="space-y-2 text-sm font-mono text-muted-foreground">
                {RUNTIME_LIMITS.map((item) => (
                  <li key={item}>— {item}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="mt-12">
          <Card className="border-electric/20 bg-electric/5">
            <CardContent className="py-4 text-sm text-muted-foreground leading-relaxed">
              {A2MCP_READINESS_COPY}
            </CardContent>
          </Card>
        </section>

        <div className="mt-16 text-center">
          <MarketingCta className="justify-center" />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
