"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Shield } from "lucide-react";
import { DEMO_SCAN_STATS } from "@/lib/marketing/content";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import { cn } from "@/lib/utils";

const MESSY_ITEMS = [
  { path: "ButtonCopy.tsx", label: "duplicate", level: "review" as const },
  { path: "ButtonFinal.tsx", label: "duplicate", level: "review" as const },
  { path: "archive/OldDashboard.tsx", label: "unused", level: "safe" as const },
  { path: "lib/utils-old.ts", label: "orphan", level: "danger" as const },
  { path: "lodash", label: "drift", level: "review" as const },
  { path: "TODO markers", label: "AI-slop", level: "danger" as const },
];

const BUNDLE_ITEMS = [
  { label: "Auto-fixes applied", value: "imports · deps · temp files", level: "safe" as const },
  { label: "Review-first", value: `${DEMO_SCAN_STATS.reviewFirst} items`, level: "review" as const },
  { label: "Protected", value: `${DEMO_SCAN_STATS.doNotTouch} files`, level: "protected" as const },
  { label: "Cleanup PR", value: "review branch", level: "cyan" as const },
  { label: "Regression checks", value: "prepared", level: "cyan" as const },
];

const SCAN_STAGES = ["Index", "Find", "Fix", "PR"];

export function HeroCleanupEngine() {
  const [activeStage, setActiveStage] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => {
      setActiveStage((s) => (s + 1) % (SCAN_STAGES.length + 1));
    }, 2200);
    return () => clearInterval(timer);
  }, [reducedMotion]);

  return (
    <Panel variant="elevated" padding="none" className="relative overflow-hidden shadow-mcc-glow">
      <div className="terminal-scanline" aria-hidden />

      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        <p className="ds-label">Repo Cleanup Engine</p>
        <span className="rounded border border-signal/30 bg-signal/10 px-2 py-0.5 font-mono text-[9px] text-signal">
          live demo
        </span>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1fr_auto_1fr]">
        {/* Left: messy repo */}
        <div className="border-b border-border/60 p-4 lg:border-b-0 lg:border-r">
          <p className="ds-label mb-3 text-danger/80">Before — repository debt</p>
          <div className="space-y-1.5">
            {MESSY_ITEMS.map((item) => (
              <div
                key={item.path}
                className="flex items-center justify-between gap-2 rounded border border-border/40 bg-[#05080D]/60 px-2.5 py-1.5"
              >
                <span className="truncate font-mono text-[10px] text-muted-foreground">{item.path}</span>
                <RiskBadge level={item.level}>{item.label}</RiskBadge>
              </div>
            ))}
          </div>
        </div>

        {/* Center: scan path */}
        <div className="flex flex-col items-center justify-center border-b border-border/60 bg-electric/[0.03] px-4 py-6 lg:border-b-0 lg:px-5">
          <div className="relative flex flex-col items-center gap-3">
            {SCAN_STAGES.map((stage, i) => (
              <div key={stage} className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border font-mono text-[10px] transition-all duration-500",
                    activeStage > i
                      ? "border-electric/50 bg-electric/15 text-electric"
                      : "border-border/60 bg-card text-muted-foreground"
                  )}
                >
                  {i + 1}
                </div>
                <span
                  className={cn(
                    "mt-1 font-mono text-[9px] uppercase tracking-wide",
                    activeStage > i ? "text-electric" : "text-muted-foreground"
                  )}
                >
                  {stage}
                </span>
                {i < SCAN_STAGES.length - 1 && (
                  <div
                    className={cn(
                      "my-1 h-4 w-px transition-colors duration-500",
                      activeStage > i ? "bg-electric/40" : "bg-border/40"
                    )}
                    aria-hidden
                  />
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-1 text-electric">
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            <span className="font-mono text-[9px] uppercase tracking-wider">scan path</span>
          </div>
        </div>

        {/* Right: structured bundle */}
        <div className="p-4">
          <p className="ds-label mb-3 text-signal/90">After — patch bundle</p>
          <div className="space-y-1.5">
            {BUNDLE_ITEMS.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between gap-2 rounded border border-border/40 bg-[#05080D]/60 px-2.5 py-1.5"
              >
                <span className="font-mono text-[10px] text-foreground">{item.label}</span>
                <RiskBadge level={item.level}>{item.value}</RiskBadge>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded border border-signal/25 bg-signal/5 px-2.5 py-2">
            <Shield className="h-3.5 w-3.5 text-signal" aria-hidden />
            <span className="font-mono text-[10px] text-signal">review-first · no auto-delete</span>
          </div>
        </div>
      </div>

      <p className="border-t border-border/60 px-4 py-2 font-mono text-[10px] text-muted-foreground">
        {DEMO_SCAN_STATS.framework} · {DEMO_SCAN_STATS.filesIndexed} files ·{" "}
        {DEMO_SCAN_STATS.duplicateClusters} duplicate clusters · demo scan output
      </p>
    </Panel>
  );
}
