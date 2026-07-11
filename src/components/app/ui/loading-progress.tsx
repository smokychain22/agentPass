"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { Panel } from "@/components/design-system/panel";
import { cn } from "@/lib/utils";

export interface ProgressStep {
  id: string;
  label: string;
}

interface LoadingProgressProps {
  title: string;
  steps: ProgressStep[];
  currentIndex: number;
  ariaLive?: "polite" | "assertive";
  className?: string;
}

export function LoadingProgress({
  title,
  steps,
  currentIndex,
  ariaLive = "polite",
  className,
}: LoadingProgressProps) {
  return (
    <Panel variant="elevated" padding="md" className={className}>
      <p className="ds-label mb-3">{title}</p>
      <ul className="space-y-2.5" aria-live={ariaLive} aria-busy={currentIndex >= 0}>
        {steps.map((step, i) => {
          const done = currentIndex > i;
          const active = currentIndex === i;
          return (
            <li key={step.id} className="flex items-center gap-3 text-sm">
              {done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-signal" aria-hidden />
              ) : active ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-electric" aria-hidden />
              ) : (
                <span className="h-4 w-4 shrink-0 rounded-full border border-border/60" aria-hidden />
              )}
              <span
                className={cn(
                  done && "text-muted-foreground",
                  active && "font-medium text-foreground",
                  !done && !active && "text-muted-foreground/60"
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
