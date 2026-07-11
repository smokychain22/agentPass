"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEMO_PROGRESS_STEPS,
  DEMO_SCAN_STATS,
  DEMO_SECTION,
} from "@/lib/marketing/content";
import { DEMO_REPO_URL } from "@/lib/demo/constants";
import { Panel } from "@/components/design-system/panel";
import { MetricCard } from "@/components/design-system/metric-card";
import { RiskBadge } from "@/components/design-system/risk-badge";
import { cn } from "@/lib/utils";

export function DemoRepoSection() {
  const [progressStep, setProgressStep] = useState(0);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setProgressStep(DEMO_PROGRESS_STEPS.length);
      return;
    }
    const timer = setInterval(() => {
      setProgressStep((s) => Math.min(s + 1, DEMO_PROGRESS_STEPS.length));
    }, 1200);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
      <div>
        <p className="ds-label">{DEMO_SECTION.eyebrow}</p>
        <h2 className="ds-section-title mt-2">{DEMO_SECTION.title}</h2>
        <p className="mt-4 leading-relaxed text-muted-foreground">{DEMO_SECTION.description}</p>
        <p className="mt-3 font-mono text-xs text-muted-foreground">{DEMO_REPO_URL}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/app?demo=true">
              <FlaskConical className="h-4 w-4" aria-hidden />
              Run full demo flow
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <a href="/api/demo/sample-bundle" download>
              See Sample Bundle
            </a>
          </Button>
        </div>
      </div>

      <Panel variant="elevated" padding="lg">
        <div className="mb-4 flex items-center justify-between gap-2">
          <p className="ds-label text-electric">Live demo scan</p>
          <RiskBadge level="cyan">{DEMO_SCAN_STATS.framework}</RiskBadge>
        </div>

        <div className="mb-4 rounded border border-border/40 bg-[#05080D]/50 px-3 py-2">
          <p className="font-mono text-[10px] text-muted-foreground">Repository</p>
          <p className="font-mono text-xs text-foreground">repodiet-demo-slop-app</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-signal animate-pulse-subtle" aria-hidden />
            <span className="font-mono text-[10px] text-signal">
              {progressStep >= DEMO_PROGRESS_STEPS.length ? "scan complete" : "scanning…"}
            </span>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3">
          <MetricCard label="Duplicate clusters" value={DEMO_SCAN_STATS.duplicateClusters} accent="amber" />
          <MetricCard label="Unused files" value={DEMO_SCAN_STATS.unusedFiles} accent="danger" />
          <MetricCard label="Safe candidates" value={DEMO_SCAN_STATS.safeCandidates} accent="mint" />
          <MetricCard label="AI-slop signals" value={DEMO_SCAN_STATS.aiSlopSignals} accent="amber" />
        </div>

        <div className="space-y-2">
          <p className="ds-label">Progress sequence</p>
          <ol className="space-y-1.5">
            {DEMO_PROGRESS_STEPS.map((step, i) => {
              const done = progressStep > i;
              return (
                <li
                  key={step}
                  className={cn(
                    "flex items-center gap-2 rounded border px-2.5 py-1.5 font-mono text-[10px]",
                    done
                      ? "border-signal/25 bg-signal/5 text-signal"
                      : "border-border/40 text-muted-foreground"
                  )}
                >
                  {done ? (
                    <Check className="h-3 w-3 shrink-0" aria-hidden />
                  ) : (
                    <span className="h-3 w-3 shrink-0 rounded-full border border-border/60" aria-hidden />
                  )}
                  {step}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <RiskBadge level={DEMO_SCAN_STATS.patchBundleReady ? "safe" : "review"}>
            Bundle {DEMO_SCAN_STATS.patchBundleReady ? "generated" : "pending"}
          </RiskBadge>
          <RiskBadge level="cyan">Verification prepared</RiskBadge>
        </div>

        <Link
          href="/app?demo=true"
          className="mt-4 inline-flex items-center gap-1 text-sm text-electric hover:underline"
        >
          Open full demo workspace
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </Panel>
    </div>
  );
}
