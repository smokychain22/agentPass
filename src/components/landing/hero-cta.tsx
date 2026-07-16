import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HeroCtaProps {
  className?: string;
}

export function HeroCta({ className }: HeroCtaProps) {
  return (
    <div className={cn("flex flex-wrap gap-3", className)}>
      <Button asChild size="lg">
        <Link href="/app">
          Analyze a Repository
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </Button>
      <Button asChild variant="secondary" size="lg">
        <Link href="/how-it-works">How RepoDiet Works</Link>
      </Button>
    </div>
  );
}
