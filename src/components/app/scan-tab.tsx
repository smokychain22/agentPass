"use client";

import { useCallback, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FolderTree,
  GitBranch,
  Loader2,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  type ScanPhase,
  SCAN_STEPS,
  isValidGitHubUrl,
  parseRepoLabel,
  runMockScan,
  type ScanResultPlaceholder,
} from "@/lib/scan";
import { cn } from "@/lib/utils";

const DEMO_REPO = "https://github.com/smokychain22/agentPass";

function phaseIndex(phase: ScanPhase): number {
  if (phase === "idle" || phase === "failed") return -1;
  return SCAN_STEPS.findIndex((s) => s.phase === phase);
}

export function ScanTab() {
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResultPlaceholder | null>(null);

  const isLoading = ["validating", "fetching", "unpacking", "detecting", "scanning"].includes(
    phase
  );

  const startScan = useCallback(async (url: string, isDemo = false) => {
    setError(null);
    setResult(null);

    const target = isDemo ? DEMO_REPO : url.trim();

    if (!isValidGitHubUrl(target)) {
      setPhase("failed");
      setError("Enter a valid public GitHub repository URL (e.g. https://github.com/owner/repo).");
      return;
    }

    if (isDemo) setRepoUrl(target);

    const data = await runMockScan(target, setPhase);
    if (data) {
      setResult(data);
      if (branch.trim()) setResult({ ...data, branch: branch.trim() });
    }
  }, [branch]);

  const currentStep = phaseIndex(phase);

  return (
    <div className="space-y-6">
      <Card className="border-border/80 bg-card/80">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Repository</CardTitle>
          <CardDescription>
            Public GitHub repositories only. Private repos are not supported in Day 1.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="repo-url">Repository URL</Label>
              <Input
                id="repo-url"
                placeholder="https://github.com/owner/repository"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2 sm:w-40">
              <Label htmlFor="branch">Branch</Label>
              <Input
                id="branch"
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Scan mode</Label>
            <div className="flex flex-wrap gap-2">
              <Badge variant="electric">Quick</Badge>
              <Badge variant="muted" className="gap-1.5 opacity-60">
                Deep <Lock className="h-3 w-3" />
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Deep scan with Knip integration ships in a later phase.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            <Button
              onClick={() => startScan(repoUrl)}
              disabled={isLoading || !repoUrl.trim()}
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" />
                  Scanning…
                </>
              ) : (
                "Scan Repository"
              )}
            </Button>
            <Button
              variant="secondary"
              onClick={() => startScan(DEMO_REPO, true)}
              disabled={isLoading}
            >
              Try Demo Repo
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/80">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Scan status</CardTitle>
          </CardHeader>
          <CardContent>
            {phase === "idle" && (
              <div className="flex items-start gap-3 rounded-md border border-dashed border-border bg-muted/20 px-4 py-6">
                <FolderTree className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Ready to scan</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Paste a repository URL or run the bundled demo repo to preview the scan flow.
                  </p>
                </div>
              </div>
            )}

            {phase === "failed" && error && (
              <div className="flex items-start gap-3 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <div>
                  <p className="text-sm font-medium text-red-300">Scan failed</p>
                  <p className="mt-1 text-sm text-muted-foreground">{error}</p>
                </div>
              </div>
            )}

            {isLoading && (
              <ul className="space-y-3">
                {SCAN_STEPS.filter((s) => s.phase !== "complete").map((step, i) => {
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
                          active && "text-foreground font-medium",
                          !done && !active && "text-muted-foreground/60"
                        )}
                      >
                        {step.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {phase === "complete" && result && (
              <div className="flex items-start gap-3 rounded-md border border-signal/30 bg-signal/5 px-4 py-4">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-signal" />
                <div>
                  <p className="text-sm font-medium text-signal">Scan complete</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Repository structure captured. Findings analysis ships in Phase 2.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Supported frameworks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Next.js, React, Vite, Express, Node monorepos</p>
            <Separator />
            <p className="text-xs leading-relaxed">
              Day 1 inspects structure and metadata. Bloat detection, duplicate clusters, and patch
              generation activate in later phases.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-border/80">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">What Day 1 detects</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>Repository layout and top-level folders</li>
              <li>Framework and package manager signals</li>
              <li>Config files (package.json, tsconfig, etc.)</li>
              <li>File tree summary for downstream analysis</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Privacy</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">
              RepoDiet fetches public repository archives for analysis. No source code is stored
              permanently in Phase 1. Full retention policy will ship with production scanning.
            </p>
          </CardContent>
        </Card>
      </div>

      {(phase === "complete" || isLoading) && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Result preview
            </h2>
            {isLoading && (
              <Badge variant="electric" className="animate-pulse-subtle">
                Capturing…
              </Badge>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ResultCard
              title="Repository Summary"
              loading={isLoading}
              value={result ? parseRepoLabel(result.repoUrl) : undefined}
              mono
            />
            <ResultCard
              title="Framework Detection"
              loading={isLoading}
              placeholder="Awaiting detection"
            />
            <ResultCard
              title="Package Manager"
              loading={isLoading}
              placeholder="Awaiting detection"
            />
            <ResultCard
              title="File Tree Summary"
              loading={isLoading}
              placeholder="Tree walk in progress"
            />
            <ResultCard
              title="Top-Level Folders"
              loading={isLoading}
              placeholder="Indexing directories"
            />
            <ResultCard
              title="Config Files Found"
              loading={isLoading}
              placeholder="Scanning manifests"
            />
          </div>

          {result && (
            <Card className="border-border/80 bg-muted/10">
              <CardContent className="flex flex-wrap items-center gap-4 py-4 text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <GitBranch className="h-4 w-4" />
                  Branch: <span className="font-mono text-foreground">{result.branch}</span>
                </span>
                <Separator orientation="vertical" className="hidden h-4 sm:block" />
                <span className="font-mono text-xs text-muted-foreground truncate max-w-full">
                  {result.repoUrl}
                </span>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function ResultCard({
  title,
  loading,
  value,
  placeholder = "—",
  mono,
}: {
  title: string;
  loading?: boolean;
  value?: string;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <Card className="border-border/80">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-electric" />
            <span>{placeholder}</span>
          </div>
        ) : (
          <p className={cn("text-sm", mono && "font-mono", !value && "text-muted-foreground")}>
            {value ?? placeholder}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
