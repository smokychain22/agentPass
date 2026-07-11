"use client";

import Link from "next/link";
import { ExternalLink, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/design-system/status-indicator";
import { RiskBadge } from "@/components/design-system/risk-badge";
import { cn } from "@/lib/utils";

interface AppTopBarProps {
  repoUrl?: string;
  branch?: string;
  scanStatus: "idle" | "scanning" | "complete" | "failed";
  isDemo?: boolean;
  onMenuClick?: () => void;
  className?: string;
}

function repoLabel(url?: string): string {
  if (!url) return "No repository connected";
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return url;
  } catch {
    return url;
  }
}

export function AppTopBar({
  repoUrl,
  branch,
  scanStatus,
  isDemo,
  onMenuClick,
  className,
}: AppTopBarProps) {
  const statusMap = {
    idle: { label: "Ready", status: "pending" as const },
    scanning: { label: "Scanning", status: "active" as const },
    complete: { label: "Scan complete", status: "complete" as const },
    failed: { label: "Scan failed", status: "error" as const },
  };
  const status = statusMap[scanStatus];

  return (
    <header
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border/60 bg-[#05080D]/80 px-4 py-2.5 backdrop-blur-sm sm:px-6",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 lg:hidden"
          onClick={onMenuClick}
          aria-label="Open navigation"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-foreground">{repoLabel(repoUrl)}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            {branch && (
              <span className="font-mono text-[10px] text-muted-foreground">branch: {branch}</span>
            )}
            {isDemo && <RiskBadge level="cyan">Demo Repository</RiskBadge>}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <StatusIndicator label={status.label} status={status.status} className="hidden sm:inline-flex" />
        <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
          <Link href="/">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Site
          </Link>
        </Button>
      </div>
    </header>
  );
}
