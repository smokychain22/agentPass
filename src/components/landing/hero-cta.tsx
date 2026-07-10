import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SAMPLE_BUNDLE_LABEL } from "@/lib/demo/constants";
import { cn } from "@/lib/utils";

interface HeroCtaProps {
  className?: string;
}

export function HeroCta({ className }: HeroCtaProps) {
  return (
    <div className={cn("flex flex-wrap gap-3", className)}>
      <Button asChild size="lg" className="cta-gradient-border bg-electric text-[#05070A] hover:bg-electric/90">
        <Link href="/app?tab=patch&demo=true">Create Cleanup PR</Link>
      </Button>
      <Button
        asChild
        variant="secondary"
        size="lg"
        className="mcc-border bg-[#0C1118] text-[#F8FAFC] hover:bg-[#111821]"
      >
        <Link href="/app?demo=true">Try Demo Repo</Link>
      </Button>
      <Button asChild variant="outline" size="lg" className="mcc-border bg-transparent text-secondary">
        <a href="/api/demo/sample-bundle" download title={SAMPLE_BUNDLE_LABEL}>
          See Sample Bundle
        </a>
      </Button>
      <Button asChild variant="ghost" size="lg" className="text-secondary hover:text-[#F8FAFC]">
        <Link href="/docs">API Docs</Link>
      </Button>
    </div>
  );
}
