"use client";

import { useEffect, useRef, useState } from "react";
import { WORKFLOW_STEPS } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

const accentStyles = {
  muted: {
    border: "border-border/60",
    active: "border-electric/40 bg-electric/5",
    dot: "bg-muted-foreground",
  },
  electric: {
    border: "border-electric/30",
    active: "border-electric/50 bg-electric/10 shadow-mcc-glow",
    dot: "bg-electric",
  },
  signal: {
    border: "border-signal/30",
    active: "border-signal/50 bg-signal/10",
    dot: "bg-signal",
  },
};

export function WorkflowPipeline() {
  const [activeStep, setActiveStep] = useState(0);
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;
    const timer = setInterval(() => {
      setActiveStep((s) => (s + 1) % WORKFLOW_STEPS.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [inView]);

  return (
    <div ref={ref} className="relative">
      {/* Desktop horizontal pipeline */}
      <div className="hidden lg:block">
        <div className="relative flex items-stretch">
          <div
            className="pipeline-connector absolute left-[6%] right-[6%] top-8 z-0 h-px"
            aria-hidden
          />
          {WORKFLOW_STEPS.map((step, i) => {
            const styles = accentStyles[step.accent];
            const active = activeStep === i;

            return (
              <div key={step.id} className="relative z-10 flex flex-1 flex-col items-center px-1">
                <WorkflowStepCard step={step} active={active} styles={styles} />
                {i < WORKFLOW_STEPS.length - 1 && (
                  <div
                    className={cn(
                      "absolute -right-0.5 top-8 z-20 h-px w-4",
                      active ? "bg-electric/50" : "bg-border/30"
                    )}
                    aria-hidden
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile vertical stepped flow */}
      <ol className="flex flex-col gap-0 lg:hidden">
        {WORKFLOW_STEPS.map((step, i) => {
          const styles = accentStyles[step.accent];
          const active = activeStep === i;

          return (
            <li key={step.id} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-mono text-xs",
                    active
                      ? "border-electric/50 bg-electric/10 text-electric"
                      : "border-border/60 bg-card text-muted-foreground"
                  )}
                >
                  {step.step}
                </div>
                {i < WORKFLOW_STEPS.length - 1 && (
                  <div className="my-1 min-h-[20px] w-px flex-1 bg-gradient-to-b from-border/40 to-electric/20" />
                )}
              </div>
              <div className="mb-4 flex-1">
                <WorkflowStepCard step={step} active={active} styles={styles} expanded />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function WorkflowStepCard({
  step,
  active,
  styles,
  expanded = false,
}: {
  step: (typeof WORKFLOW_STEPS)[number];
  active: boolean;
  styles: (typeof accentStyles)[keyof typeof accentStyles];
  expanded?: boolean;
}) {
  return (
    <div
      className={cn(
        "w-full rounded-lg border p-3 transition-all duration-500",
        styles.border,
        active ? styles.active : "bg-card",
        expanded && "p-4",
        active && "scale-[1.01]"
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", styles.dot)} aria-hidden />
        <span className="font-mono text-[10px] text-muted-foreground">{step.step}</span>
      </div>
      <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground">
        {step.title}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">{step.subtitle}</p>
      <p className="mt-2 font-mono text-[10px] text-electric/80">{step.meta}</p>
    </div>
  );
}
