"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { PIPELINE_STEPS } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

const accentBorder = {
  muted: "border-[#64748B]/30",
  electric: "border-electric/30",
  signal: "border-signal/30",
};

const accentDot = {
  muted: "bg-[#64748B]",
  electric: "bg-electric",
  signal: "bg-signal",
};

export function RepoDietPipeline() {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveStep((s) => (s + 1) % PIPELINE_STEPS.length);
    }, 2800);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative">
      {/* Desktop horizontal */}
      <div className="hidden lg:block">
        <div className="relative flex items-stretch gap-0">
          {/* Animated connector line behind nodes */}
          <div
            className="pipeline-connector absolute left-[8%] right-[8%] top-[2.75rem] z-0 h-px"
            aria-hidden
          />
          {PIPELINE_STEPS.map((step, i) => (
            <div key={step.id} className="relative z-10 flex flex-1 flex-col items-center px-1">
              <PipelineNode step={step} active={activeStep === i} />
              {i < PIPELINE_STEPS.length - 1 && (
                <ArrowRight
                  className="absolute -right-2 top-[2.35rem] z-20 h-3.5 w-3.5 text-[#64748B]/50"
                  aria-hidden
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile vertical stepper */}
      <div className="flex flex-col gap-0 lg:hidden">
        {PIPELINE_STEPS.map((step, i) => (
          <div key={step.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-mono",
                  activeStep === i
                    ? "border-electric/50 bg-electric/10 text-electric"
                    : "mcc-border bg-[#0C1118] text-[#64748B]"
                )}
              >
                {i + 1}
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <div className="my-1 w-px flex-1 min-h-[24px] bg-gradient-to-b from-[#64748B]/30 to-electric/20" />
              )}
            </div>
            <div className="mb-4 flex-1 pb-2">
              <PipelineNode step={step} active={activeStep === i} expanded />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineNode({
  step,
  active,
  expanded = false,
}: {
  step: (typeof PIPELINE_STEPS)[number];
  active?: boolean;
  expanded?: boolean;
}) {
  return (
    <div
      className={cn(
        "w-full rounded-lg border p-3 transition-all duration-500",
        accentBorder[step.accent],
        active ? "bg-[#111821] shadow-mcc-glow scale-[1.02]" : "bg-[#0C1118]/90",
        expanded && "p-4"
      )}
    >
      <div className="mb-2 flex items-center justify-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", accentDot[step.accent])} />
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#F8FAFC] sm:text-[11px]">
          {step.title}
        </h3>
      </div>
      <div className="flex flex-wrap justify-center gap-1">
        {step.chips.map((chip) => (
          <span
            key={chip}
            className="rounded border mcc-border bg-[#05070A]/80 px-1.5 py-0.5 font-mono text-[9px] text-secondary sm:text-[10px]"
          >
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}
