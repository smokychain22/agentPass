import Link from "next/link";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/app", label: "App" },
  { href: "/docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
  { href: "/okx", label: "OKX ASP" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 group">
          <span className="flex h-7 w-7 items-center justify-center rounded border border-electric/30 bg-electric/10 text-xs font-mono font-semibold text-electric">
            RD
          </span>
          <span className="text-sm font-semibold tracking-tight group-hover:text-electric transition-colors">
            RepoDiet
          </span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/app"
            className={cn(
              "hidden sm:inline-flex h-9 items-center rounded-md px-4 text-sm font-medium",
              "bg-electric text-background hover:bg-electric/90 transition-colors"
            )}
          >
            Run Scan
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border mt-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="text-sm font-medium">RepoDiet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Software Utility ASP for OKX.AI
          </p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Link href="/docs" className="hover:text-foreground transition-colors">
            Docs
          </Link>
          <Link href="/pricing" className="hover:text-foreground transition-colors">
            Pricing
          </Link>
          <Link href="/okx" className="hover:text-foreground transition-colors">
            OKX ASP
          </Link>
          <Link href="/app" className="hover:text-foreground transition-colors">
            App
          </Link>
        </div>
      </div>
    </footer>
  );
}
