"use client";

import Link from "next/link";
import { Check, Lock, AlertCircle, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowStepState, WorkflowTabId } from "@/lib/workflow/step-states";

export type WorkflowStepId = WorkflowTabId;

export type StepState = "inactive" | "active" | "completed" | "locked" | "failed" | "blocked" | "running";

interface WorkflowStep {
  id: WorkflowStepId;
  label: string;
  href: string;
  state: StepState;
  lockReason?: string;
}

interface WorkflowRailProps {
  steps: WorkflowStepState[];
  className?: string;
}

function toRailState(status: WorkflowStepState["status"]): StepState {
  switch (status) {
    case "complete":
      return "completed";
    case "current":
      return "active";
    case "running":
      return "running";
    case "locked":
      return "locked";
    case "failed":
      return "failed";
    case "inactive":
      return "inactive";
    default:
      return "inactive";
  }
}

const HREF: Record<WorkflowTabId, string> = {
  scan: "/app",
  findings: "/app?tab=findings",
  patch: "/app?tab=patch",
  verify: "/app?tab=verify",
};

export function WorkflowRail({ steps, className }: WorkflowRailProps) {
  const railSteps: WorkflowStep[] = steps.map((step) => ({
    id: step.tabId,
    label: step.title,
    href: HREF[step.tabId],
    state: toRailState(step.status),
    lockReason: step.explanation,
  }));

  return (
    <nav aria-label="Workflow progress" className={cn("w-full", className)}>
      <ol className="flex items-stretch gap-1 overflow-x-auto pb-1 scrollbar-thin sm:gap-0">
        {railSteps.map((step, i) => (
          <li key={step.id} className="flex min-w-[88px] flex-1 items-stretch sm:min-w-0">
            <WorkflowStepLink step={step} />
            {i < railSteps.length - 1 && (
              <div
                className={cn(
                  "mx-1 hidden w-6 shrink-0 self-center border-t sm:block",
                  step.state === "completed" ? "border-signal/40" : "border-border/60"
                )}
                aria-hidden
              />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function WorkflowStepLink({ step }: { step: WorkflowStep }) {
  const isLocked = step.state === "locked";
  const isBlocked = step.state === "blocked";
  const content = (
    <>
      <StepIcon state={step.state} />
      <span className="truncate font-mono text-[10px] uppercase tracking-wide sm:text-[11px]">
        {step.label}
      </span>
    </>
  );

  const className = cn(
    "flex w-full flex-col items-center gap-1.5 rounded-md border px-2 py-2.5 text-center transition-colors sm:flex-row sm:justify-center sm:px-3",
    step.state === "active" && "border-electric/40 bg-electric/10 text-electric",
    step.state === "running" && "border-electric/40 bg-electric/10 text-electric",
    step.state === "completed" && "border-signal/30 bg-signal/5 text-signal",
    step.state === "locked" && "border-border/40 bg-card/40 text-muted-foreground cursor-not-allowed",
    step.state === "blocked" && "border-amber-500/30 bg-amber-500/5 text-amber-200 cursor-not-allowed",
    step.state === "failed" && "border-danger/40 bg-danger/5 text-danger",
    step.state === "inactive" && "border-border/40 text-muted-foreground hover:border-border hover:bg-card-elevated"
  );

  if (isLocked || isBlocked) {
    return (
      <span className={className} title={step.lockReason}>
        {content}
      </span>
    );
  }

  return (
    <Link href={step.href} className={className} aria-current={step.state === "active" ? "step" : undefined}>
      {content}
    </Link>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "completed") return <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />;
  if (state === "locked") return <Lock className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />;
  if (state === "blocked") return <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />;
  if (state === "failed") return <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />;
  if (state === "running") return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />;
  return (
    <span
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        state === "active" ? "bg-electric animate-pulse-subtle" : "bg-muted-foreground/40"
      )}
      aria-hidden
    />
  );
}
