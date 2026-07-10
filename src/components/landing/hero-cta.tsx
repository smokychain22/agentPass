import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SAMPLE_BUNDLE_LABEL } from "@/lib/demo/constants";

interface HeroCtaProps {
  className?: string;
}

export function HeroCta({ className }: HeroCtaProps) {
  return (
    <div className={`flex flex-wrap gap-3 ${className ?? ""}`}>
      <Button asChild size="lg">
        <Link href="/app">Scan a Repo</Link>
      </Button>
      <Button asChild variant="secondary" size="lg">
        <Link href="/app?demo=true">Try Messy Demo Repo</Link>
      </Button>
      <Button asChild variant="outline" size="lg">
        <a href="/api/demo/sample-bundle" download title={SAMPLE_BUNDLE_LABEL}>
          See Sample Bundle
        </a>
      </Button>
      <Button asChild variant="ghost" size="lg">
        <Link href="/docs">API Docs</Link>
      </Button>
    </div>
  );
}
