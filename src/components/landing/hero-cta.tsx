import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HeroCtaProps {
  className?: string;
}

export function HeroCta({ className }: HeroCtaProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <Button asChild size="lg" className="rounded-[0.8rem]">
        <Link href="/app">
          Scan a Repository
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </Button>
      <Button asChild variant="secondary" size="lg" className="rounded-[0.8rem]">
        <Link href="/#product-engine">Watch Live Execution</Link>
      </Button>
    </div>
  );
}
