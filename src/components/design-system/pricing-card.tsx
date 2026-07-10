import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export interface PricingPlan {
  name: string;
  price: string;
  description: string;
  features: string[];
  cta: string;
  href: string;
  highlighted?: boolean;
}

interface PricingCardProps {
  tier: PricingPlan;
}

export function PricingCard({ tier }: PricingCardProps) {
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-lg border p-5",
        tier.highlighted
          ? "ds-card-highlight border-electric/30 shadow-mcc-glow"
          : "ds-card-elevated"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="ds-label">Plan</p>
        {tier.highlighted && (
          <span className="rounded border border-electric/30 bg-electric/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-electric">
            Recommended
          </span>
        )}
      </div>
      <h3 className="mt-2 text-base font-semibold text-foreground">{tier.name}</h3>
      <p className="mt-2 font-mono text-2xl font-semibold text-electric">{tier.price}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{tier.description}</p>
      <ul className="mb-5 mt-4 flex-1 space-y-2 text-xs text-muted-foreground">
        {tier.features.map((feature) => (
          <li key={feature} className="flex gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal" aria-hidden />
            <span>{feature}</span>
          </li>
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
  );
}
