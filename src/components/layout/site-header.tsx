"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOOTER_OKX_COPY } from "@/lib/marketing/content";
import { Button } from "@/components/ui/button";
import { RepodietLogo } from "@/components/layout/repodiet-logo";

const navLinks = [
  { href: "/#product", label: "Product" },
  { href: "/app?demo=true", label: "Demo" },
  { href: "/docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
];

const footerLinks = [
  { href: "/#product", label: "Product" },
  { href: "/app?demo=true", label: "Demo" },
  { href: "/docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "API" },
  { href: "/okx", label: "OKX integration" },
  { href: "/app", label: "App" },
];

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-[#05080D]/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <RepodietLogo className="group-hover:[&_span]:text-electric" />
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/app">Scan a Repo</Link>
          </Button>

          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/60 text-foreground md:hidden"
            onClick={() => setMobileOpen((o) => !o)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav
          className="border-t border-border/60 bg-[#05080D]/95 px-4 py-4 md:hidden"
          aria-label="Mobile navigation"
        >
          <ul className="space-y-1">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-card-elevated hover:text-foreground"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <Button asChild className="mt-4 w-full" onClick={() => setMobileOpen(false)}>
            <Link href="/app">Scan a Repo</Link>
          </Button>
        </nav>
      )}
    </header>
  );
}

interface SiteFooterProps {
  variant?: "default" | "product";
}

export function SiteFooter({ variant = "default" }: SiteFooterProps) {
  return (
    <footer className="relative z-10 mt-auto border-t border-border/60">
      {variant === "product" && (
        <div className="border-b border-border/60 bg-[#07121A]/60">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">{FOOTER_OKX_COPY}</p>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href="/okx">View OKX Integration</Link>
            </Button>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <RepodietLogo size="sm" showWordmark={false} />
              <p className="text-sm font-semibold text-foreground">RepoDiet</p>
            </div>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">
              Review-first cleanup intelligence for AI-built repositories.
            </p>
          </div>

          <nav aria-label="Footer navigation">
            <ul className="flex flex-wrap gap-x-5 gap-y-2">
              {footerLinks.map((link) => (
                <li key={`${link.href}-${link.label}`}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <p className={cn("mt-6 text-xs text-muted-foreground")}>
          © {new Date().getFullYear()} RepoDiet — scan, classify, review, merge.
        </p>
      </div>
    </footer>
  );
}
