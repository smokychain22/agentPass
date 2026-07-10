"use client";

import Link from "next/link";
import { Check, Lock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkflowStepId = "scan" | "findings" | "patch" | "verify";

export type StepState = "inactive" | "active" | "completed" | "locked" | "failed";

interface WorkflowStep {
  id: WorkflowStepId;
  label: string;
  href: string;
  state: StepState;
  lockReason?: string;
}

interface WorkflowRailProps {
  activeStep: WorkflowStepId;
  scanComplete: boolean;
  findingsReady: boolean;
  patchKitReady: boolean;
  failedStep?: WorkflowStepId;
  className?: string;
}

function resolveState(
  stepId: WorkflowStepId,
  activeStep: WorkflowStepId,
  scanComplete: boolean,
  findingsReady: boolean,
  patchKitReady: boolean,
  failedStep?: WorkflowStepId
): { state: StepState; lockReason?: string } {
  if (failedStep === stepId) return { state: "failed" };

  const order: WorkflowStepId[] = ["scan", "findings", "patch", "verify"];
  const idx = order.indexOf(stepId);
  const activeIdx = order.indexOf(activeStep);

  if (stepId === "scan") {
    if (activeStep === "scan") return { state: scanComplete ? "completed" : "active" };
    return { state: scanComplete ? "completed" : "inactive" };
  }
  if (stepId === "findings") {
    if (!scanComplete) return { state: "locked", lockReason: "Available after repository scan" };
    if (activeStep === "findings") return { state: findingsReady ? "completed" : "active" };
    return { state: findingsReady ? "completed" : "inactive" };
  }
  if (stepId === "patch") {
    if (!findingsReady) return { state: "locked", lockReason: "Available after findings are ready" };
    if (activeStep === "patch") return { state: patchKitReady ? "completed" : "active" };
    return { state: patchKitReady ? "completed" : "inactive" };
  }
  if (stepId === "verify") {
    if (!patchKitReady) return { state: "locked", lockReason: "Available after patch bundle is generated" };
    if (activeStep === "verify") return { state: "active" };
    return { state: idx < activeIdx ? "completed" : "inactive" };
  }
  return { state: "inactive" };
}

export function WorkflowRail({
  activeStep,
  scanComplete,
  findingsReady,
  patchKitReady,
  failedStep,
  className,
}: WorkflowRailProps) {
  const steps: WorkflowStep[] = [
    {
      id: "scan",
      label: "Scan",
      href: "/app",
      ...resolveState("scan", activeStep, scanComplete, findingsReady, patchKitReady, failedStep),
    },
    {
      id: "findings",
      label: "Findings",
      href: "/app?tab=findings",
      ...resolveState("findings", activeStep, scanComplete, findingsReady, patchKitReady, failedStep),
    },
    {
      id: "patch",
      label: "Patch Kit",
      href: "/app?tab=patch",
      ...resolveState("patch", activeStep, scanComplete, findingsReady, patchKitReady, failedStep),
    },
    {
      id: "verify",
      label: "Verify",
      href: "/app?tab=verify",
      ...resolveState("verify", activeStep, scanComplete, findingsReady, patchKitReady, failedStep),
    },
  ];

  return (
    <nav aria-label="Workflow progress" className={cn("w-full", className)}>
      <ol className="flex items-stretch gap-1 overflow-x-auto pb-1 scrollbar-thin sm:gap-0">
        {steps.map((step, i) => (
          <li key={step.id} className="flex min-w-[88px] flex-1 items-stretch sm:min-w-0">
            <WorkflowStepLink step={step} />
            {i < steps.length - 1 && (
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
    step.state === "completed" && "border-signal/30 bg-signal/5 text-signal",
    step.state === "locked" && "border-border/40 bg-card/40 text-muted-foreground cursor-not-allowed",
    step.state === "failed" && "border-danger/40 bg-danger/5 text-danger",
    step.state === "inactive" && "border-border/40 text-muted-foreground hover:border-border hover:bg-card-elevated"
  );

  if (isLocked) {
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
  if (state === "failed") return <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />;
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
