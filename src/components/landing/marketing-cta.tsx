import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SAMPLE_BUNDLE_LABEL } from "@/lib/demo/constants";

interface MarketingCtaProps {
  size?: "default" | "lg";
  className?: string;
  showOkx?: boolean;
}

export function MarketingCta({ size = "default", className, showOkx = false }: MarketingCtaProps) {
  const btnSize = size === "lg" ? "lg" : "default";
  return (
    <div className={`flex flex-wrap gap-3 ${className ?? ""}`}>
      <Button asChild size={btnSize}>
        <Link href="/app?tab=patch&demo=true">Create Cleanup PR</Link>
      </Button>
      <Button asChild variant="secondary" size={btnSize}>
        <Link href="/app?demo=true">Try Demo Repo</Link>
      </Button>
      <Button asChild variant="outline" size={btnSize}>
        <a href="/api/demo/sample-bundle" download title={SAMPLE_BUNDLE_LABEL}>
          See Sample Bundle
        </a>
      </Button>
      <Button asChild variant="outline" size={btnSize}>
        <Link href="/docs">API Docs</Link>
      </Button>
      {showOkx && (
        <Button asChild variant="ghost" size={btnSize}>
          <Link href="/okx">OKX integration</Link>
        </Button>
      )}
    </div>
  );
}
