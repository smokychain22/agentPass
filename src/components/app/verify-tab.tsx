"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design-system/panel";
import { useAppSession } from "@/components/app/app-session";
import { LockedTab, WorkspaceSection } from "@/components/app/locked-tab";
import { computeWorkflowGates } from "@/lib/workflow/gates";
import { cn } from "@/lib/utils";

const TIMELINE_STEPS = [
  "Payment verified",
  "Scope locked",
  "Isolated branch created",
  "Approved changes applied",
  "Patch validated",
  "Verification completed",
  "Pull request created",
  "Delivery receipt signed",
] as const;

function stepDone(status: string, index: number): boolean {
  const order = [
    "awaiting_payment",
    "funded",
    "generating_changes",
    "validating_patch",
    "verifying",
    "creating_pull_request",
    "awaiting_approval",
    "completed",
  ];
  const pos = order.indexOf(status);
  if (status === "completed") return true;
  return pos >= index + 1;
}

export function VerifyTab() {
  const { session, findings, patchKit, a2aTask } = useAppSession();

  const gates = useMemo(
    () =>
      computeWorkflowGates({
        scanComplete: session.scanComplete,
        findings,
        patchKit,
        a2aTask: a2aTask ? { id: a2aTask.taskId, status: a2aTask.status } : null,
      }),
    [session.scanComplete, findings, patchKit, a2aTask]
  );

  if (!gates.verifyUnlocked) {
    return (
      <LockedTab
        step="04"
        title="Verification"
        description="Verify unlocks after paid cleanup execution starts or a previous delivery exists."
      />
    );
  }

  const task = a2aTask;
  const receipt = (task?.receipt ?? {}) as Record<string, unknown>;
  const failed = task?.status === "verification_failed" || task?.status === "delivery_failed";

  return (
    <div className="space-y-6">
      <WorkspaceSection
        label="Delivery evidence"
        title="Verify"
        description="Chronological execution timeline for the paid A2A cleanup delivery."
      />

      <Panel variant="elevated" padding="md">
        <p className="ds-label mb-3">Execution timeline</p>
        <ol className="space-y-2 text-sm">
          {TIMELINE_STEPS.map((label, index) => {
            const done = task ? stepDone(task.status, index) : false;
            const failedHere = failed && index === 5;
            return (
              <li key={label} className="flex items-start gap-2">
                {failedHere ? (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
                ) : done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className={cn(done && !failedHere && "text-signal")}>{label}</span>
              </li>
            );
          })}
        </ol>
      </Panel>

      {task && (
        <Panel variant="elevated" padding="md">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Task ID</dt>
              <dd className="font-mono text-xs">{task.taskId}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-mono">{task.status}</dd>
            </div>
            {task.pullRequest?.url && (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Pull request</dt>
                <dd>
                  <a href={task.pullRequest.url} className="text-electric underline" target="_blank" rel="noreferrer">
                    {task.pullRequest.url}
                  </a>
                </dd>
              </div>
            )}
            {task.pullRequest?.branch && (
              <div>
                <dt className="text-muted-foreground">Branch</dt>
                <dd className="font-mono text-xs">{task.pullRequest.branch}</dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">Source commit</dt>
              <dd className="font-mono text-xs">{task.repository.commitSha?.slice(0, 12) ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">ASP Agent ID</dt>
              <dd className="font-mono">5283</dd>
            </div>
            {typeof receipt.receiptId === "string" && (
              <div>
                <dt className="text-muted-foreground">Receipt ID</dt>
                <dd className="font-mono text-xs">{receipt.receiptId}</dd>
              </div>
            )}
          </dl>
          {task.error && (
            <p className="mt-3 text-sm text-red-300">Failed check: {task.error}</p>
          )}
        </Panel>
      )}

      <Button variant="secondary" asChild>
        <Link href="/app?tab=patch">Back to Fix & PR</Link>
      </Button>
    </div>
  );
}
