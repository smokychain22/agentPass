import {
  TRANSFORMATION_AFTER_ITEMS,
  TRANSFORMATION_BEFORE_LABELS,
  TRANSFORMATION_BEFORE_TREE,
  TRANSFORMATION_PROCESSING_STEPS,
  DEMO_SCAN_STATS,
} from "@/lib/marketing/content";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import { MetricCard } from "@/components/design-system/metric-card";
import { ArrowRight } from "lucide-react";

export function TransformationSection() {
  return (
    <div className="space-y-8">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr]">
        {/* Before */}
        <Panel variant="danger" padding="none" className="overflow-hidden">
          <div className="border-b border-danger/20 bg-danger/5 px-4 py-2.5">
            <p className="ds-label text-danger">Before — Repository Debt</p>
          </div>
          <div className="p-4">
            <pre className="font-mono text-[11px] leading-relaxed text-muted-foreground">
              {TRANSFORMATION_BEFORE_TREE.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </pre>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {TRANSFORMATION_BEFORE_LABELS.map((item) => (
                <RiskBadge key={item.path} level={item.level}>
                  {item.label}
                </RiskBadge>
              ))}
            </div>
          </div>
        </Panel>

        {/* Processing rail */}
        <div className="flex flex-col items-center justify-center gap-3 px-2 py-4 lg:py-0">
          <p className="ds-label text-electric">RepoDiet Processing</p>
          <div className="flex flex-col items-center gap-2">
            {TRANSFORMATION_PROCESSING_STEPS.map((step, i) => (
              <div key={step} className="flex flex-col items-center">
                <span className="rounded border border-electric/30 bg-electric/10 px-3 py-1.5 font-mono text-[10px] text-electric">
                  {step}
                </span>
                {i < TRANSFORMATION_PROCESSING_STEPS.length - 1 && (
                  <ArrowRight
                    className="my-1 h-3.5 w-3.5 rotate-90 text-electric/50 lg:rotate-90"
                    aria-hidden
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* After */}
        <Panel variant="safe" padding="none" className="overflow-hidden">
          <div className="border-b border-signal/20 bg-signal/5 px-4 py-2.5">
            <p className="ds-label text-signal">After — Review-Ready Cleanup</p>
          </div>
          <div className="space-y-2 p-4">
            {TRANSFORMATION_AFTER_ITEMS.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between gap-2 rounded border border-border/40 bg-[#05080D]/50 px-3 py-2"
              >
                <span className="text-xs text-foreground">{item.label}</span>
                <RiskBadge level={item.level}>{item.value}</RiskBadge>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Duplicate clusters"
          value={DEMO_SCAN_STATS.duplicateClusters}
          accent="amber"
        />
        <MetricCard label="Unused files" value={DEMO_SCAN_STATS.unusedFiles} accent="danger" />
        <MetricCard label="AI-slop signals" value={DEMO_SCAN_STATS.aiSlopSignals} accent="amber" />
        <MetricCard label="Risk visibility" value="classified" accent="mint" hint="Safe · Review · Protected" />
      </div>
    </div>
  );
}
