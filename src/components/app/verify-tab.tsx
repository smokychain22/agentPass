"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design-system/panel";
import { RiskBadge } from "@/components/design-system/risk-badge";
import { MetricCard } from "@/components/design-system/metric-card";
import { useAppSession } from "@/components/app/app-session";
import { LockedTab, WorkspaceSection } from "@/components/app/locked-tab";
import { FeedbackBanner } from "@/components/app/ui/feedback-banner";
import { copyText, runVerification, type VerificationResult } from "@/lib/patch-kit/client";
import { cn } from "@/lib/utils";

type CheckState = "pending" | "ready" | "passed" | "failed" | "manual";

interface ParsedCheck {
  id: string;
  label: string;
  section: "automated" | "routes" | "api" | "protected" | "manual";
  command?: string;
}

function parseRegressionChecklist(markdown: string): ParsedCheck[] {
  const lines = markdown.split("\n");
  const checks: ParsedCheck[] = [];
  let section: ParsedCheck["section"] = "manual";
  let inCommands = false;

  for (const line of lines) {
    if (line.startsWith("## Build checks")) section = "automated";
    else if (line.startsWith("## Route checks")) section = "routes";
    else if (line.startsWith("## API checks")) section = "api";
    else if (line.startsWith("## Protected files")) section = "protected";
    else if (line.startsWith("## Suggested commands")) inCommands = true;
    else if (line.startsWith("##")) inCommands = false;

    const match = line.match(/^- \[ \] (.+)$/);
    if (match) {
      checks.push({
        id: `check-${checks.length}`,
        label: match[1],
        section,
      });
    }
  }

  const cmdBlock = markdown.match(/```bash\n([\s\S]*?)```/);
  if (cmdBlock) {
    const commands = cmdBlock[1].trim().split("\n");
    commands.forEach((cmd, i) => {
      const existing = checks.find((c) => c.label.toLowerCase().includes(cmd.split(" ")[0]));
      if (existing) existing.command = cmd;
      else if (section === "automated" || i < 4) {
        checks.push({ id: `cmd-${i}`, label: cmd, section: "automated", command: cmd });
      }
    });
  }

  return checks;
}

export function VerifyTab() {
  const { session, findings, patchKit } = useAppSession();
  const [checkStates, setCheckStates] = useState<Record<string, CheckState>>({});
  const [copied, setCopied] = useState(false);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const checks = useMemo(() => {
    if (!patchKit) return [];
    return parseRegressionChecklist(patchKit.artifacts.regressionChecklistMd);
  }, [patchKit]);

  const toggleCheck = useCallback((id: string) => {
    setCheckStates((prev) => {
      const current = prev[id] ?? "ready";
      const next: CheckState =
        current === "ready" ? "passed" : current === "passed" ? "manual" : "ready";
      return { ...prev, [id]: next };
    });
  }, []);

  const copyCommands = async () => {
    if (!patchKit) return;
    const cmdMatch = patchKit.artifacts.regressionChecklistMd.match(/```bash\n([\s\S]*?)```/);
    const commands = cmdMatch?.[1]?.trim() ?? "";
    await copyText(commands || patchKit.artifacts.regressionChecklistMd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadChecklist = () => {
    if (!patchKit) return;
    const blob = new Blob([patchKit.artifacts.regressionChecklistMd], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "regression-checklist.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const runServerVerification = async () => {
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
  };

  if (!patchKit) {
    return (
      <LockedTab
        step="04"
        title="Verification Plan"
        description={
          findings
            ? "Generate a patch bundle first. Automated verification unlocks after the bundle is ready."
            : "Available after findings and patch bundle are ready."
        }
      />
    );
  }

  const passedCount = Object.values(checkStates).filter((s) => s === "passed").length;
  const reviewItems = findings?.summary.reviewRequired ?? patchKit.summary.reviewFirstItems;

  return (
    <WorkspaceSection
      label="Regression-first"
      title="Verification plan"
      description="RepoDiet generates a regression checklist and can run limited automated checks (git apply --check and allowlisted package scripts). Full build verification may still require local review."
      actions={
        <>
          <Button variant="secondary" onClick={runServerVerification} disabled={verifyLoading}>
            {verifyLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Running checks…
              </>
            ) : (
              "Run automated checks"
            )}
          </Button>
          <Button variant="secondary" onClick={downloadChecklist}>
            <Download className="h-4 w-4" aria-hidden />
            Download Checklist
          </Button>
          <Button variant="outline" onClick={copyCommands}>
            <Copy className="h-4 w-4" aria-hidden />
            {copied ? "Copied" : "Copy Commands"}
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/app?tab=patch">Return to Quick Cleanup</Link>
          </Button>
        </>
      }
    >
      <FeedbackBanner
        variant="info"
        message="Automated verification is limited on serverless infrastructure. Use the checklist for full local build, lint, and route testing."
        dismissible={false}
      />

      {verifyError && (
        <FeedbackBanner variant="error" message={verifyError} dismissible onDismiss={() => setVerifyError(null)} />
      )}

      {verification && (
        <Panel variant="elevated" padding="md">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Automated verification result</p>
            <RiskBadge level={verification.status === "passed" ? "safe" : verification.status === "partial" ? "review" : "protected"}>
              {verification.status}
            </RiskBadge>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {verification.checks.map((check) => (
              <li key={`${check.name}-${check.command}`} className="flex items-start gap-2 text-muted-foreground">
                {check.status === "passed" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-signal" aria-hidden />
                ) : check.status === "failed" ? (
                  <XCircle className="mt-0.5 h-4 w-4 text-red-400" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4" aria-hidden />
                )}
                <span>
                  <span className="font-medium text-foreground">{check.name}</span>
                  {check.command !== "n/a" && (
                    <code className="mt-0.5 block font-mono text-[10px] text-electric">{check.command}</code>
                  )}
                  {check.stderrSummary && (
                    <span className="mt-1 block text-[11px] text-red-300">{check.stderrSummary}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {verification.limitations.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Limitations: {verification.limitations.join(" ")}
            </p>
          )}
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Readiness" value="Developer review" accent="amber" hint="Not auto-verified" />
        <MetricCard label="Protected files" value={patchKit.summary.doNotTouchItems} accent="neutral" />
        <MetricCard label="Review items" value={reviewItems} accent="amber" />
        <MetricCard label="Checks tracked" value={`${passedCount}/${checks.length}`} accent="mint" />
      </div>

      <div className="flex flex-wrap gap-2">
        <RiskBadge level="safe">Patch safety: review-first</RiskBadge>
        <RiskBadge level="cyan">Checklist generated</RiskBadge>
        {reviewItems > 0 && <RiskBadge level="review">{reviewItems} unresolved review items</RiskBadge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChecklistSection
          title="Automated verification (recommended)"
          subtitle="Run these locally after applying cleanup"
          checks={checks.filter((c) => c.section === "automated")}
          checkStates={checkStates}
          onToggle={toggleCheck}
        />
        <ChecklistSection
          title="Route checks"
          subtitle="Confirm routes respond after cleanup"
          checks={checks.filter((c) => c.section === "routes")}
          checkStates={checkStates}
          onToggle={toggleCheck}
        />
        <ChecklistSection
          title="API handler checks"
          subtitle="Verify API endpoints still resolve"
          checks={checks.filter((c) => c.section === "api")}
          checkStates={checkStates}
          onToggle={toggleCheck}
        />
        <ChecklistSection
          title="Manual review"
          subtitle="Protected files and policy reminders"
          checks={checks.filter((c) => c.section === "protected")}
          checkStates={checkStates}
          onToggle={toggleCheck}
        />
      </div>

      <Panel variant="elevated" padding="md">
        <p className="text-sm font-medium text-foreground">Ready for developer review</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Repository: <span className="font-mono">{session.repoUrl}</span>
          {session.branch && <> · branch: <span className="font-mono">{session.branch}</span></>}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild variant="secondary">
            <Link href="/app">Start New Scan</Link>
          </Button>
          <Button variant="outline" onClick={() => setCheckStates({})}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Reset checklist
          </Button>
        </div>
      </Panel>
    </WorkspaceSection>
  );
}

function ChecklistSection({
  title,
  subtitle,
  checks,
  checkStates,
  onToggle,
}: {
  title: string;
  subtitle: string;
  checks: ParsedCheck[];
  checkStates: Record<string, CheckState>;
  onToggle: (id: string) => void;
}) {
  if (checks.length === 0) return null;

  return (
    <Panel variant="elevated" padding="md">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      <ul className="mt-4 space-y-2">
        {checks.map((check) => {
          const state = checkStates[check.id] ?? "ready";
          return (
            <li key={check.id}>
              <button
                type="button"
                onClick={() => onToggle(check.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  state === "passed"
                    ? "border-signal/30 bg-signal/5"
                    : "border-border/40 hover:border-border/60"
                )}
              >
                {state === "passed" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="flex-1 text-muted-foreground">
                  {check.label}
                  {check.command && (
                    <code className="mt-1 block font-mono text-[10px] text-electric">{check.command}</code>
                  )}
                </span>
                <span className="font-mono text-[9px] uppercase text-muted-foreground">
                  {state === "passed" ? "done" : "ready"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
