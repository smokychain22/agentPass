"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Github, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOOTER_OKX_COPY } from "@/lib/marketing/content";
import { Button } from "@/components/ui/button";
import { RepodietLogo } from "@/components/layout/repodiet-logo";

const navLinks = [
  { href: "/#product", label: "Product" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/#green-pr-protocol", label: "Green PR Protocol" },
  { href: "/#proof", label: "Proof" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
];

const footerGroups = [
  {
    title: "Product",
    links: [
      { href: "/app", label: "Scan Repository" },
      { href: "/app", label: "Workspace" },
      { href: "/how-it-works", label: "How It Works" },
      { href: "/#green-pr-protocol", label: "Green PR Protocol" },
      { href: "/#proof", label: "Proof" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/okx", label: "Agent Card" },
      { href: "/docs", label: "API" },
      { href: "https://github.com/smokychain22/agentPass", label: "GitHub" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/how-it-works", label: "Security" },
      { href: "/okx", label: "Contact" },
    ],
  },
];

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-[background-color,backdrop-filter,height] duration-200",
        scrolled
          ? "border-[rgba(139,164,190,0.2)] bg-[#05090F]/85 backdrop-blur-md"
          : "border-[rgba(139,164,190,0.14)] bg-[#05090F]/75 backdrop-blur-sm"
      )}
    >
      <div className="mx-auto flex h-[70px] max-w-[1360px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-12">
        <Link href="/" className="group flex items-center gap-2.5">
          <RepodietLogo className="group-hover:[&_span]:text-electric" />
        </Link>

        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main navigation">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-2.5 py-1.5 text-sm text-[#8FA2B7] transition-colors hover:bg-[#0F1A25] hover:text-[#F2F6FA]"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="https://github.com/smokychain22/agentPass"
            className="hidden h-9 w-9 items-center justify-center rounded-md border border-[rgba(139,164,190,0.2)] text-[#8FA2B7] transition-colors hover:border-[rgba(32,191,255,0.35)] hover:text-[#46D1FF] sm:inline-flex"
            aria-label="RepoDiet on GitHub"
          >
            <Github className="h-4 w-4" aria-hidden />
          </Link>
          <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
            <Link href="/app">Workspace</Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex rounded-[0.75rem]">
            <Link href="/app">Scan a Repository</Link>
          </Button>

          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[rgba(139,164,190,0.2)] text-[#F2F6FA] lg:hidden"
            onClick={() => setMobileOpen((o) => !o)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <nav
          className="border-t border-[rgba(139,164,190,0.2)] bg-[#05090F]/98 px-5 py-5 lg:hidden"
          aria-label="Mobile navigation"
        >
          <ul className="space-y-1">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="block rounded-md px-3 py-3 text-base text-[#8FA2B7] hover:bg-[#0F1A25] hover:text-[#F2F6FA]"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <Button asChild className="mt-4 w-full" onClick={() => setMobileOpen(false)}>
            <Link href="/app">Scan a Repository</Link>
          </Button>
        </nav>
      ) : null}
    </header>
  );
}

interface SiteFooterProps {
  variant?: "default" | "product";
}

export function SiteFooter({ variant = "default" }: SiteFooterProps) {
  return (
    <footer className="relative z-10 mt-auto border-t border-[rgba(139,164,190,0.2)] bg-[#05090F]">
      {variant === "product" ? (
        <div className="border-b border-[rgba(139,164,190,0.2)] bg-[#08111A]/60">
          <div className="mx-auto flex max-w-[1360px] flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
            <p className="max-w-lg text-sm leading-relaxed text-[#8FA2B7]">{FOOTER_OKX_COPY}</p>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href="/okx">View OKX Integration</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-[1360px] px-5 py-10 sm:px-8 lg:px-12">
        <div className="grid gap-8 md:grid-cols-[1.1fr_2fr]">
          <div>
            <div className="flex items-center gap-2">
              <RepodietLogo size="sm" showWordmark={false} />
              <p className="text-sm font-semibold text-[#F2F6FA]">RepoDiet</p>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-[#8FA2B7]">
              Proof-carrying maintenance for AI-built repositories.
            </p>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.1em] text-[#66788D]">
              Status · Production · OKX listing under review
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            {footerGroups.map((group) => (
              <nav key={group.title} aria-label={`${group.title} links`}>
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#66788D]">
                  {group.title}
                </p>
                <ul className="mt-3 space-y-2">
                  {group.links.map((link) => (
                    <li key={`${group.title}-${link.label}`}>
                      <Link
                        href={link.href}
                        className="text-sm text-[#8FA2B7] transition-colors hover:text-[#F2F6FA]"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <p className="mt-8 text-xs text-[#66788D]">
          © {new Date().getFullYear()} RepoDiet — verified cleanup, buyer-controlled merge.
        </p>
      </div>
    </footer>
  );
}
