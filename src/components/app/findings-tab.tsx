"use client";

import { useCallback, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAppSession } from "@/components/app/app-session";
import { LockedTab } from "@/components/app/locked-tab";
import {
  FINDINGS_STEPS,
  buildCleanupPrompt,
  flattenFindings,
  runFindingsAnalysis,
  type FindingsPhase,
} from "@/lib/findings/client";
import { SummaryCards } from "./findings/summary-cards";
import { RiskBuckets } from "./findings/risk-buckets";
import { FindingsTable } from "./findings/findings-table";
import { CategoryPanels } from "./findings/category-panels";
import { JsonExportCard } from "./findings/json-export";
import { cn } from "@/lib/utils";

const LOADING: FindingsPhase[] = [
  "preparing",
  "duplicates",
  "unused",
  "graph",
  "slop",
  "normalizing",
];

function phaseIndex(phase: FindingsPhase): number {
  if (phase === "idle" || phase === "failed") return -1;
  return FINDINGS_STEPS.findIndex((s) => s.phase === phase);
}

export function FindingsTab() {
  const { session, findings, setFindings } = useAppSession();
  const [phase, setPhase] = useState<FindingsPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);

  const isLoading = LOADING.includes(phase);
  const currentStep = phaseIndex(phase);

  const runFindings = useCallback(async () => {
    if (!session.scanComplete || !session.repoUrl) return;
    setError(null);

    try {
      const result = await runFindingsAnalysis(
        session.repoUrl,
        session.branch || undefined,
        setPhase
      );
      setFindings(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Findings analysis failed.");
    }
  }, [session, setFindings]);

  const copyPrompt = async () => {
    if (!findings) return;
    await navigator.clipboard.writeText(buildCleanupPrompt(findings));
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  };

  if (!session.scanComplete) {
    return (
      <LockedTab
        step="02"
        title="Findings Engine"
        description="Complete a repository scan first. The Findings tab unlocks after RepoDiet captures structure metadata from the Scan tab."
      />
    );
  }

  const allFindings = findings ? flattenFindings(findings) : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Findings Engine</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground leading-relaxed">
            RepoDiet maps duplicate code, unused files, unused dependencies, orphan patterns, and
            AI-slop signals before generating a cleanup patch.
          </p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {session.repoUrl}
            {session.branch ? ` · branch: ${session.branch}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button onClick={runFindings} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" />
                Analyzing…
              </>
            ) : findings ? (
              "Re-run Findings"
            ) : (
              "Run Findings"
            )}
          </Button>
          <Button
            variant="secondary"
            size="default"
            disabled={!findings}
            onClick={() => findings && downloadFindingsJson(findings)}
          >
            Export findings.json
          </Button>
          <Button variant="outline" disabled={!findings} onClick={copyPrompt}>
            <Copy className="h-4 w-4" />
            {promptCopied ? "Copied" : "Copy Cleanup Prompt"}
          </Button>
          <Button variant="ghost" disabled className="gap-1.5 opacity-60">
            <Lock className="h-3.5 w-3.5" />
            Continue to Patch Kit
            <Badge variant="muted" className="text-[9px] ml-1">
              Phase 3
            </Badge>
          </Button>
        </div>
      </div>

      {isLoading && (
        <Card className="border-border/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Analysis pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {FINDINGS_STEPS.filter((s) => s.phase !== "complete").map((step, i) => {
                const done = currentStep > i;
                const active = currentStep === i;
                return (
                  <li key={step.phase} className="flex items-center gap-3 text-sm">
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 text-signal" />
                    ) : active ? (
                      <Loader2 className="h-4 w-4 animate-spin text-electric" />
                    ) : (
                      <span className="h-4 w-4 rounded-full border border-border" />
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
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div>
            <p className="text-sm font-medium text-red-300">Findings failed</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      {findings && (
        <>
          {(!findings.rawToolReports.knipAvailable ||
            !findings.rawToolReports.jscpdAvailable ||
            !findings.rawToolReports.madgeAvailable) && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="py-3 text-sm text-muted-foreground">
                Partial results — tools:{" "}
                <span className="font-mono text-xs">
                  knip={findings.rawToolReports.knipAvailable ? "ok" : "unavailable"} · jscpd=
                  {findings.rawToolReports.jscpdAvailable ? "ok" : "unavailable"} · madge=
                  {findings.rawToolReports.madgeAvailable ? "ok" : "unavailable"}
                </span>
              </CardContent>
            </Card>
          )}

          <SummaryCards summary={findings.summary} />
          <RiskBuckets findings={findings} />
          <FindingsTable findings={allFindings} />
          <CategoryPanels payload={findings} />
          <JsonExportCard payload={findings} />
        </>
      )}

      {!findings && !isLoading && !error && (
        <Card className="border-dashed border-border bg-card/30">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm font-medium">Scan complete — ready for deep analysis</p>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Run the Findings Engine to detect duplicates, unused code, orphan patterns, and
              AI-slop signals.
            </p>
            <Button className="mt-6" onClick={runFindings}>
              Run Findings Engine
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function downloadFindingsJson(findings: import("@/lib/findings/types").FindingsPayload) {
  const json = JSON.stringify(findings, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `repodiet-findings-${findings.scanId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
