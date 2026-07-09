"use client";

import { useCallback, useMemo, useState } from "react";
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
  PATCH_KIT_STEPS,
  copyText,
  downloadPatchKitZip,
  runPatchKitGeneration,
  type PatchKitPhase,
} from "@/lib/patch-kit/client";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import { PatchKitSummaryCards } from "./patch-kit/summary-cards";
import { SafetyPolicyCard } from "./patch-kit/safety-policy-card";
import { ArtifactCard } from "./patch-kit/artifact-card";
import { SafeDeleteTable } from "./patch-kit/safe-delete-table";
import { DownloadPanel } from "./patch-kit/download-panel";
import {
  ARTIFACT_DEFINITIONS,
  buildSafeDeleteRows,
} from "./patch-kit/patch-kit-utils";
import { cn } from "@/lib/utils";

const LOADING: PatchKitPhase[] = [
  "classifying",
  "patch",
  "package",
  "regression",
  "cursor",
  "bundle",
];

function phaseIndex(phase: PatchKitPhase): number {
  if (phase === "idle" || phase === "failed") return -1;
  return PATCH_KIT_STEPS.findIndex((s) => s.phase === phase);
}

export function PatchKitTab() {
  const { session, findings, patchKit, setPatchKit } = useAppSession();
  const [phase, setPhase] = useState<PatchKitPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);

  const isLoading = LOADING.includes(phase);
  const currentStep = phaseIndex(phase);

  const generate = useCallback(async () => {
    if (!findings || !session.repoUrl) return;
    setError(null);

    try {
      const result = await runPatchKitGeneration(
        session.repoUrl,
        session.branch || undefined,
        findings,
        setPhase
      );
      setPatchKit(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Patch kit generation failed.");
    }
  }, [findings, session, setPatchKit]);

  const safeDeleteRows = useMemo(
    () => (findings ? buildSafeDeleteRows(findings) : []),
    [findings]
  );

  const copyCursorPrompt = async () => {
    if (!patchKit) return;
    await copyText(patchKit.artifacts.cursorPromptMd);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  };

  const downloadZip = () => {
    if (!patchKit) return;
    downloadPatchKitZip(patchKit, patchKit.repo.name, patchKit.repo.branch);
  };

  if (!findings) {
    return (
      <LockedTab
        step="03"
        title="Patch Kit"
        description="Run the Findings Engine first. The Patch Kit tab unlocks after RepoDiet has analysis results to convert into a conservative cleanup bundle."
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Patch Kit</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground leading-relaxed">
            Generate a conservative cleanup bundle from RepoDiet findings: patch plan, dependency
            suggestions, regression checklist, and Cursor cleanup prompt.
          </p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {session.repoUrl}
            {session.branch ? ` · branch: ${session.branch}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button onClick={generate} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" />
                Generating…
              </>
            ) : patchKit ? (
              "Regenerate Patch Bundle"
            ) : (
              "Generate Patch Bundle"
            )}
          </Button>
          <Button variant="secondary" disabled={!patchKit} onClick={downloadZip}>
            Download ZIP
          </Button>
          <Button variant="outline" disabled={!patchKit} onClick={copyCursorPrompt}>
            <Copy className="h-4 w-4" />
            {promptCopied ? "Copied" : "Copy Cursor Prompt"}
          </Button>
          <Button variant="ghost" disabled className="gap-1.5 opacity-60">
            <Lock className="h-3.5 w-3.5" />
            Continue to Verify
            <Badge variant="muted" className="text-[9px] ml-1">
              Phase 4
            </Badge>
          </Button>
        </div>
      </div>

      {isLoading && (
        <Card className="border-border/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Bundle pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {PATCH_KIT_STEPS.filter((s) => s.phase !== "complete").map((step, i) => {
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
            <p className="text-sm font-medium text-red-300">Patch kit failed</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      {!patchKit && !isLoading && !error && (
        <Card className="border-dashed border-border bg-card/30">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm font-medium">Findings ready — generate your patch bundle</p>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              RepoDiet will classify safe deletes, build a conservative cleanup patch, and package
              all deliverables into a downloadable ZIP.
            </p>
            <Button className="mt-6" onClick={generate}>
              Generate Patch Bundle
            </Button>
          </CardContent>
        </Card>
      )}

      {patchKit && (
        <>
          <PatchKitSummaryCards summary={patchKit.summary} />
          <SafetyPolicyCard />

          <div>
            <h3 className="text-sm font-medium mb-3">Artifact previews</h3>
            <div className="grid gap-3 lg:grid-cols-2">
              {ARTIFACT_DEFINITIONS.map((artifact) => (
                <ArtifactCard
                  key={artifact.id}
                  artifact={artifact}
                  content={artifact.getContent(patchKit.artifacts)}
                />
              ))}
            </div>
          </div>

          <SafeDeleteTable rows={safeDeleteRows} />

          <Card className="border-border/80">
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-4">
              <CardTitle className="text-sm font-medium">Cursor Prompt Preview</CardTitle>
              <Button variant="outline" size="sm" onClick={copyCursorPrompt}>
                <Copy className="h-3.5 w-3.5" />
                {promptCopied ? "Copied" : "Copy Prompt"}
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/20 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground scrollbar-thin">
                {patchKit.artifacts.cursorPromptMd}
              </pre>
            </CardContent>
          </Card>

          <DownloadPanel
            fileCount={patchKit.summary.bundleFileCount}
            onDownload={downloadZip}
          />
        </>
      )}
    </div>
  );
}
