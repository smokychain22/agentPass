import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SAMPLE_BUNDLE_LABEL } from "@/lib/demo/constants";
import { cn } from "@/lib/utils";

interface HeroCtaProps {
  className?: string;
}

export function HeroCta({ className }: HeroCtaProps) {
  return (
    <div className={cn("flex flex-wrap gap-3", className)}>
      <Button asChild size="lg">
        <Link href="/app">
          Scan a Repository
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </Button>
      <Button asChild variant="secondary" size="lg">
        <Link href="/app?tab=patch&demo=true">Create Cleanup PR</Link>
      </Button>
      <Button asChild variant="outline" size="lg">
        <Link href="/app?demo=true">Watch Live Demo</Link>
      </Button>
      <Button asChild variant="ghost" size="lg">
        <a href="/api/demo/sample-bundle" download title={SAMPLE_BUNDLE_LABEL}>
          See Sample Bundle
        </a>
      </Button>
    </div>
  );
}
