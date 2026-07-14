"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ScanSearch,
  FileSearch,
  Package,
  ShieldCheck,
  BookOpen,
  Blocks,
  Lock,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusIndicator } from "@/components/design-system/status-indicator";
import { RepodietLogo } from "@/components/layout/repodiet-logo";

const mainNav = [
  {
    href: "/app",
    label: "Scan",
    icon: ScanSearch,
    tab: "scan",
    lockReason: undefined as string | undefined,
    needsScan: false,
    needsFindings: false,
    needsFixPr: false,
    needsVerify: false,
  },
  {
    href: "/app?tab=findings",
    label: "Findings",
    icon: FileSearch,
    tab: "findings",
    lockReason: "Complete repository scan first",
    needsScan: true,
    needsFindings: false,
    needsFixPr: false,
    needsVerify: false,
  },
  {
    href: "/app?tab=patch",
    label: "Fix & PR",
    icon: Package,
    tab: "patch",
    lockReason: "Select safe scope and confirm GitHub access",
    needsScan: true,
    needsFindings: true,
    needsFixPr: true,
    needsVerify: false,
  },
  {
    href: "/app?tab=verify",
    label: "Verify",
    icon: ShieldCheck,
    tab: "verify",
    lockReason: "Paid cleanup execution must start first",
    needsScan: true,
    needsFindings: true,
    needsFixPr: false,
    needsVerify: true,
  },
];

const secondaryNav = [
  { href: "/docs", label: "Docs", icon: BookOpen },
  { href: "/okx", label: "OKX Integration", icon: Blocks },
];

interface AppSidebarProps {
  scanComplete?: boolean;
  findingsUnlocked?: boolean;
  findingsReady?: boolean;
  fixPrUnlocked?: boolean;
  fixPrLockBody?: string;
  verifyUnlocked?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function AppSidebar({
  scanComplete = false,
  findingsUnlocked = false,
  findingsReady = false,
  fixPrUnlocked = false,
  fixPrLockBody,
  verifyUnlocked = false,
  mobileOpen = false,
  onMobileClose,
}: AppSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") || "scan";

  const content = (
    <>
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-4 lg:px-5">
        <Link href="/" className="flex items-center gap-2.5" onClick={onMobileClose}>
          <RepodietLogo />
        </Link>
        {onMobileClose && (
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 lg:hidden"
            onClick={onMobileClose}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 lg:p-5">
        <div>
          <p className="mb-2 px-2 ds-label">Workflow</p>
          <ul className="space-y-0.5">
            {mainNav.map((item) => {
              let locked = false;
              let lockReason = item.lockReason;

              if (item.needsScan && !scanComplete) locked = true;
              else if (item.needsFindings && !findingsUnlocked) {
                locked = true;
                lockReason = scanComplete
                  ? "Select which application RepoDiet should analyze"
                  : item.lockReason;
              }               else if (item.needsFindings && !findingsReady && item.tab === "patch") locked = true;
              else if ("needsFixPr" in item && item.needsFixPr && !fixPrUnlocked) {
                locked = true;
                lockReason = fixPrLockBody ?? item.lockReason;
              } else if (item.needsVerify && !verifyUnlocked) {
                locked = true;
                lockReason = item.lockReason;
              }

              const active = pathname === "/app" && activeTab === item.tab;

              return (
                <li key={item.tab}>
                  {locked ? (
                    <span
                      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground/50"
                      title={lockReason}
                    >
                      <item.icon className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      <Lock className="h-3 w-3 shrink-0" aria-hidden />
                    </span>
                  ) : (
                    <Link
                      href={item.href}
                      onClick={onMobileClose}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                        active
                          ? "border border-electric/30 bg-electric/10 text-electric"
                          : "text-muted-foreground hover:bg-card-elevated hover:text-foreground"
                      )}
                      aria-current={active ? "page" : undefined}
                    >
                      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                      {item.label}
                    </Link>
                  )}
                  {locked && lockReason && (
                    <p className="px-2.5 pb-1 pt-0.5 text-[10px] leading-snug text-muted-foreground/60">
                      {lockReason}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <p className="mb-2 px-2 ds-label">Resources</p>
          <ul className="space-y-0.5">
            {secondaryNav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onMobileClose}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                    pathname === item.href
                      ? "border border-border/60 bg-card-elevated text-foreground"
                      : "text-muted-foreground hover:bg-card-elevated hover:text-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="border-t border-border/60 p-4 lg:p-5">
        <p className="ds-label mb-2">Session</p>
        <StatusIndicator
          label={scanComplete ? "Repository connected" : "Awaiting scan"}
          status={scanComplete ? "complete" : "pending"}
        />
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          Workflow restores after refresh when scan, findings, and patch data are persisted
          server-side.
        </p>
      </div>
    </>
  );

  return (
    <>
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border/60 bg-card/30 lg:flex">
        {content}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            onClick={onMobileClose}
            aria-label="Close navigation overlay"
          />
          <aside className="relative flex h-full w-[min(280px,85vw)] flex-col border-r border-border/60 bg-[#05080D] shadow-xl">
            {content}
          </aside>
        </div>
      )}
    </>
  );
}
