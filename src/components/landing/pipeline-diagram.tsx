import { ArrowRight } from "lucide-react";
import { PIPELINE_STEPS } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

const accentStyles = {
  muted: "border-border/80 bg-muted/20",
  electric: "border-electric/25 bg-electric/5",
  signal: "border-signal/25 bg-signal/5",
};

const dotStyles = {
  muted: "bg-muted-foreground/40",
  electric: "bg-electric",
  signal: "bg-signal",
};

export function PipelineDiagram() {
  return (
    <div className="relative">
      {/* Desktop: horizontal pipeline */}
      <div className="hidden lg:block">
        <div className="grid grid-cols-6 gap-3">
          {PIPELINE_STEPS.map((step, i) => (
            <div key={step.id} className="relative">
              {i < PIPELINE_STEPS.length - 1 && (
                <div
                  className="absolute left-full top-1/2 z-0 h-px w-3 -translate-y-1/2 bg-gradient-to-r from-border to-electric/40"
                  aria-hidden
                />
              )}
              <PipelineNode step={step} />
            </div>
          ))}
        </div>
      </div>

      {/* Mobile / tablet: vertical pipeline */}
      <div className="flex flex-col gap-3 lg:hidden">
        {PIPELINE_STEPS.map((step, i) => (
          <div key={step.id} className="relative flex flex-col items-stretch">
            <PipelineNode step={step} expanded />
            {i < PIPELINE_STEPS.length - 1 && (
              <div className="flex justify-center py-1" aria-hidden>
                <ArrowRight className="h-4 w-4 rotate-90 text-muted-foreground/50" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineNode({
  step,
  expanded = false,
}: {
  step: (typeof PIPELINE_STEPS)[number];
  expanded?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative z-10 flex h-full flex-col rounded-lg border p-4 transition-colors",
        accentStyles[step.accent]
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotStyles[step.accent])} />
        <h3 className="font-mono text-xs font-medium uppercase tracking-wide text-foreground">
          {step.title}
        </h3>
      </div>
      <ul className={cn("space-y-1", expanded ? "text-sm" : "text-[11px]")}>
        {step.outputs.map((output) => (
          <li key={output} className="text-muted-foreground leading-snug">
            {output}
          </li>
        ))}
      </ul>
    </div>
  );
}
