"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  ScanSearch,
  FileSearch,
  Package,
  ShieldCheck,
  BookOpen,
  Blocks,
} from "lucide-react";

const mainNav = [
  { href: "/app", label: "Scan", icon: ScanSearch, tab: "scan" },
  { href: "/app?tab=findings", label: "Findings", icon: FileSearch, tab: "findings" },
  { href: "/app?tab=patch", label: "Patch Kit", icon: Package, tab: "patch" },
  { href: "/app?tab=verify", label: "Verify", icon: ShieldCheck, tab: "verify" },
];

const secondaryNav = [
  { href: "/docs", label: "Docs", icon: BookOpen },
  { href: "/okx", label: "OKX ASP", icon: Blocks },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-full flex-col border-b border-border bg-card/30 lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-4 lg:px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded border border-electric/30 bg-electric/10 text-xs font-mono font-semibold text-electric">
            RD
          </span>
          <span className="text-sm font-semibold tracking-tight">RepoDiet</span>
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-6 p-4 lg:p-5">
        <div>
          <p className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Workflow
          </p>
          <ul className="space-y-0.5">
            {mainNav.map((item) => {
              const active = pathname === "/app";
              return (
                <li key={item.tab}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                      active && item.tab === "scan"
                        ? "bg-accent text-foreground border border-border"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0 opacity-70" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <p className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Resources
          </p>
          <ul className="space-y-0.5">
            {secondaryNav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                    pathname === item.href
                      ? "bg-accent text-foreground border border-border"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0 opacity-70" />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </aside>
  );
}
