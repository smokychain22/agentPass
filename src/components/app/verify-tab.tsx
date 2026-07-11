"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Circle,
  Loader2,
  MinusCircle,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import { MetricCard } from "@/components/design-system/metric-card";
import { useAppSession } from "@/components/app/app-session";
import { LockedTab, WorkspaceSection } from "@/components/app/locked-tab";
import { FeedbackBanner } from "@/components/app/ui/feedback-banner";
import { RepoDietOperatorSection } from "@/components/app/patch-kit/repodiet-operator-section";
import { computeWorkflowGates } from "@/lib/workflow/gates";
import { runVerification, type VerificationResult } from "@/lib/patch-kit/client";
import { cn } from "@/lib/utils";

function checkStatusIcon(status: string) {
  if (status === "passed") {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />;
  }
  if (status === "failed") {
    return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />;
  }
  if (status === "skipped" || status === "not_run" || status === "not_available") {
    return <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
  }
  return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
}

function overallStatusLabel(status: VerificationResult["status"]): string {
  switch (status) {
    case "passed":
      return "Verified";
    case "partial":
      return "Partial verification";
    case "failed":
      return "Verification failed";
    default:
      return "Not run";
  }
}

export function VerifyTab() {
  const searchParams = useSearchParams();
  const demoMode =
    searchParams.get("demo") === "true" || searchParams.get("demo") === "1";
  const { session, findings, patchKit } = useAppSession();
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const gates = useMemo(
    () =>
      computeWorkflowGates({
        scanComplete: session.scanComplete,
        findings,
        patchKit,
      }),
    [session.scanComplete, findings, patchKit]
  );

  const runServerVerification = useCallback(async () => {
    if (!patchKit) return;
    setVerifyLoading(true);
    setVerifyError(null);
    try {
      const result = await runVerification(patchKit.id);
      setVerification(result);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifyLoading(false);
    }
  }, [patchKit]);

  if (!gates.verifyUnlocked || !patchKit) {
    return (
      <LockedTab
        step="04"
        title="Verification"
        description={
          !patchKit
            ? "Generate cleanup changes in Quick Cleanup and pass patch validation first."
            : "Verify unlocks after validated changes are generated."
        }
      />
    );
  }

  const manifest = patchKit.changeManifest ?? [];
  const filesEdited = manifest.filter((e) => e.operation === "edit").length;
  const filesDeleted = manifest.filter((e) => e.operation === "delete").length;
  const filesAdded = manifest.filter((e) => e.operation === "add").length;

  const requiredPassed = verification?.checks.filter((c) => c.status === "passed").length ?? 0;
  const requiredFailed = verification?.checks.filter((c) => c.status === "failed").length ?? 0;
  const optionalSkipped =
    verification?.checks.filter((c) => c.status === "skipped" || c.status === "not_run").length ??
    0;

  return (
    <WorkspaceSection
      label="Repository integrity"
      title="Verification"
      description="RepoDiet applies the validated patch in an isolated workspace and runs allowlisted package scripts. Results come from real command exit codes — skipped checks are not shown as passed."
      actions={
        <>
          <Button onClick={runServerVerification} disabled={verifyLoading}>
            {verifyLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Running checks…
              </>
            ) : verification ? (
              "Re-run verification"
            ) : (
              "Run verification"
            )}
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/app?tab=patch">Return to Quick Cleanup</Link>
          </Button>
        </>
      }
    >
      {verifyError && (
        <FeedbackBanner
          variant="error"
          message={verifyError}
          dismissible
          onDismiss={() => setVerifyError(null)}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Repository"
          value={`${patchKit.repo.owner}/${patchKit.repo.name}`}
          accent="neutral"
          hint={patchKit.repo.branch}
        />
        <MetricCard label="Validated changes" value={patchKit.summary.validatedChanges} accent="mint" />
        <MetricCard label="Files edited" value={filesEdited} accent="neutral" />
        <MetricCard label="Files deleted" value={filesDeleted} accent="neutral" />
      </div>

      <Panel variant="elevated" padding="md">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Patch ID</dt>
            <dd className="font-mono text-xs">{patchKit.id}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Patch validation</dt>
            <dd className="font-mono text-xs">{patchKit.patchValidation?.status ?? "unknown"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Files added</dt>
            <dd className="font-mono text-xs">{filesAdded}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Protected findings</dt>
            <dd className="font-mono text-xs">{patchKit.summary.doNotTouchItems}</dd>
          </div>
        </dl>
      </Panel>

      {verification && (
        <Panel variant="elevated" padding="md">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Verification summary</p>
            <RiskBadge
              level={
                verification.status === "passed"
                  ? "safe"
                  : verification.status === "partial"
                    ? "review"
                    : "protected"
              }
            >
              {overallStatusLabel(verification.status)}
            </RiskBadge>
          </div>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <p className="text-muted-foreground">
              Passed: <span className="font-mono text-foreground">{requiredPassed}</span>
            </p>
            <p className="text-muted-foreground">
              Failed: <span className="font-mono text-foreground">{requiredFailed}</span>
            </p>
            <p className="text-muted-foreground">
              Skipped / unavailable:{" "}
              <span className="font-mono text-foreground">{optionalSkipped}</span>
            </p>
          </div>
          {verification.limitations.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Limitations: {verification.limitations.join(" ")}
            </p>
          )}
        </Panel>
      )}

      {verification ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {verification.checks.map((check) => (
            <Panel key={`${check.name}-${check.command}`} variant="elevated" padding="md">
              <div className="flex items-start gap-3">
                {checkStatusIcon(check.status)}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{check.name}</p>
                    <span
                      className={cn(
                        "font-mono text-[9px] uppercase",
                        check.status === "passed"
                          ? "text-signal"
                          : check.status === "failed"
                            ? "text-red-400"
                            : "text-muted-foreground"
                      )}
                    >
                      {check.status}
                    </span>
                  </div>
                  {check.command !== "n/a" && (
                    <code className="mt-1 block font-mono text-[10px] text-electric">
                      {check.command}
                    </code>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Exit {check.exitCode ?? "—"} · {check.durationMs}ms
                  </p>
                  {check.stderrSummary && (
                    <pre className="mt-2 max-h-32 overflow-auto rounded border border-border/40 bg-background/50 p-2 font-mono text-[10px] text-red-300">
                      {check.stderrSummary}
                    </pre>
                  )}
                  {check.stdoutSummary && check.status === "passed" && (
                    <pre className="mt-2 max-h-24 overflow-auto rounded border border-border/40 bg-background/50 p-2 font-mono text-[10px] text-muted-foreground">
                      {check.stdoutSummary}
                    </pre>
                  )}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      ) : (
        <Panel variant="elevated" padding="md">
          <p className="text-sm text-muted-foreground">
            Run verification to apply the validated patch in an isolated workspace and execute
            allowlisted checks (patch integrity, install, typecheck, lint, build when available).
          </p>
        </Panel>
      )}

      <RepoDietOperatorSection
        repoUrl={session.repoUrl}
        branch={session.branch || undefined}
        findings={findings}
        patchKit={patchKit}
        demoMode={demoMode}
        requireVerificationForCleanupPr
        verificationStatus={verification?.status ?? null}
      />
    </WorkspaceSection>
  );
}
