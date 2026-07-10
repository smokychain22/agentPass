import Link from "next/link";
import { cn } from "@/lib/utils";
import { FOOTER_OKX_COPY } from "@/lib/marketing/content";
import { Button } from "@/components/ui/button";

const navLinks = [
  { href: "/#product", label: "Product" },
  { href: "/app?demo=true", label: "Demo" },
  { href: "/docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b mcc-border bg-[#05070A]/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded border border-electric/25 bg-electric/10 text-xs font-mono font-semibold text-electric">
            RD
          </span>
          <span className="text-sm font-semibold tracking-tight text-[#F8FAFC] transition-colors group-hover:text-electric">
            RepoDiet
          </span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-[#111821] hover:text-[#F8FAFC]"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/app"
            className={cn(
              "cta-gradient-border hidden h-9 items-center rounded-md px-4 text-sm font-medium sm:inline-flex",
              "bg-electric text-[#05070A] hover:bg-electric/90 transition-colors"
            )}
          >
            Scan Repo
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
    <footer className="relative z-10 mt-auto border-t mcc-border">
      {variant === "product" && (
        <div className="border-b mcc-border bg-[#070A0F]/60">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="max-w-lg text-sm leading-relaxed text-secondary">{FOOTER_OKX_COPY}</p>
            <Button asChild variant="outline" size="sm" className="shrink-0 mcc-border">
              <Link href="/okx">View OKX integration</Link>
            </Button>
          </div>
        </div>
      )}

      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="text-sm font-medium text-[#F8FAFC]">RepoDiet</p>
          <p className="mt-1 text-sm text-secondary">
            Review-first cleanup for AI-built codebases
          </p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-secondary">
          <Link href="/docs" className="transition-colors hover:text-[#F8FAFC]">
            Docs
          </Link>
          <Link href="/pricing" className="transition-colors hover:text-[#F8FAFC]">
            Pricing
          </Link>
          <Link href="/okx" className="transition-colors hover:text-[#F8FAFC]">
            Integrations
          </Link>
          <Link href="/app" className="transition-colors hover:text-[#F8FAFC]">
            App
          </Link>
        </div>
      </div>
    </footer>
  );
}
