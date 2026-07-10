import Link from "next/link";
import { Button } from "@/components/ui/button";

interface MarketingCtaProps {
  size?: "default" | "lg";
  className?: string;
}

export function MarketingCta({ size = "default", className }: MarketingCtaProps) {
  const btnSize = size === "lg" ? "lg" : "default";
  return (
    <div className={`flex flex-wrap gap-3 ${className ?? ""}`}>
      <Button asChild size={btnSize}>
        <Link href="/app">Run Scan</Link>
      </Button>
      <Button asChild variant="secondary" size={btnSize}>
        <Link href="/app?demo=true">Try Demo Repo</Link>
      </Button>
      <Button asChild variant="outline" size={btnSize}>
        <Link href="/app?tab=patch">Download Sample Bundle</Link>
      </Button>
      <Button asChild variant="outline" size={btnSize}>
        <Link href="/docs">View API Docs</Link>
      </Button>
      <Button asChild variant="ghost" size={btnSize}>
        <Link href="/okx">OKX ASP</Link>
      </Button>
    </div>
  );
}
