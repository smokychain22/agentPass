import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOOTER_OKX_COPY } from "@/lib/marketing/content";
import { Button } from "@/components/ui/button";

const navLinks = [
  { href: "/app", label: "App" },
  { href: "/docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded border border-electric/30 bg-electric/10 text-xs font-mono font-semibold text-electric">
            RD
          </span>
          <span className="text-sm font-semibold tracking-tight transition-colors group-hover:text-electric">
            RepoDiet
          </span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/app"
            className={cn(
              "hidden h-9 items-center rounded-md px-4 text-sm font-medium sm:inline-flex",
              "bg-electric text-background transition-colors hover:bg-electric/90"
            )}
          >
            Scan a Repo
          </Link>
        </div>
      </div>
    </header>
  );
}

interface SiteFooterProps {
  variant?: "default" | "product";
}

export function SiteFooter({ variant = "default" }: SiteFooterProps) {
  return (
    <footer className="relative z-10 mt-auto border-t border-border/80">
      {variant === "product" && (
        <div className="border-b border-border/60 bg-panel/40">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="max-w-lg text-sm text-muted-foreground leading-relaxed">
              {FOOTER_OKX_COPY}
            </p>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href="/okx">
                View OKX integration
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      )}

      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="text-sm font-medium">RepoDiet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Review-first cleanup for AI-built codebases
          </p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Link href="/docs" className="transition-colors hover:text-foreground">
            Docs
          </Link>
          <Link href="/pricing" className="transition-colors hover:text-foreground">
            Pricing
          </Link>
          <Link href="/okx" className="transition-colors hover:text-foreground">
            Integrations
          </Link>
          <Link href="/app" className="transition-colors hover:text-foreground">
            App
          </Link>
        </div>
      </div>
    </footer>
  );
}
