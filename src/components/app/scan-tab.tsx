"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FolderTree,
  GitBranch,
  Info,
  Loader2,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { ScanPayload } from "@/lib/scanner/run-scan";
import { DEMO_NOTICE } from "@/lib/demo/constants";
import {
  type ScanPhase,
  SCAN_STEPS,
  DEMO_REPO,
  isValidGitHubUrl,
  runScan,
} from "@/lib/scan";
import { cn } from "@/lib/utils";
import { useAppSession } from "@/components/app/app-session";

const LOADING_PHASES: ScanPhase[] = [
  "validating",
  "fetching",
  "unpacking",
  "detecting",
  "scanning",
  "pending",
];

function phaseIndex(phase: ScanPhase | "idle"): number {
  if (phase === "idle" || phase === "failed" || phase === "pending") return -1;
  return SCAN_STEPS.findIndex((s) => s.phase === phase);
}

export function ScanTab() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { setScanComplete } = useAppSession();
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [phase, setPhase] = useState<ScanPhase | "idle">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanPayload | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const demoAutoStarted = useRef(false);

  const isLoading = LOADING_PHASES.includes(phase as ScanPhase);

  const startScan = useCallback(
    async (url: string, isDemo = false) => {
      setError(null);
      setResult(null);
      setIsDemoMode(isDemo);

      const target = isDemo ? DEMO_REPO : url.trim();

      if (!isValidGitHubUrl(target)) {
        setPhase("failed");
        setError(
          "Enter a valid public GitHub repository URL (e.g. https://github.com/owner/repo)."
        );
        return;
      }

      if (isDemo) setRepoUrl(target);

      try {
        const data = await runScan(
          target,
          isDemo ? undefined : branch.trim() || undefined,
          setPhase
        );
        setResult(data);
        setScanComplete(target, data.repo.branch || branch.trim(), data);
        if (isDemo) {
          router.push("/app?tab=findings&demo=true");
        }
      } catch (err) {
        setPhase("failed");
        setError(err instanceof Error ? err.message : "Scan failed unexpectedly.");
      }
    },
    [branch, router, setScanComplete]
  );

  useEffect(() => {
    const demo = searchParams.get("demo");
    if (demo === "1" || demo === "true") {
      setIsDemoMode(true);
      setRepoUrl(DEMO_REPO);
      if (!demoAutoStarted.current) {
        demoAutoStarted.current = true;
        void startScan(DEMO_REPO, true);
      }
    }
  }, [searchParams, startScan]);

  const currentStep = phaseIndex(phase as ScanPhase);
  const showResults = phase === "complete" || isLoading;

  return (
    <div className="space-y-6">
      {isDemoMode && (
        <Card className="border-electric/30 bg-electric/5">
          <CardContent className="flex items-start gap-3 py-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-electric" />
            <p className="text-sm text-muted-foreground leading-relaxed">{DEMO_NOTICE}</p>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/80 bg-card/80">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Repository</CardTitle>
          <CardDescription>
            Public GitHub repositories only. RepoDiet downloads the archive ZIP and inspects
            structure — no clone required.
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
              Deep scan with Knip integration ships in Phase 3.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            <Button onClick={() => startScan(repoUrl)} disabled={isLoading || !repoUrl.trim()}>
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
                    Paste a repository URL or try the demo — scans the seeded{" "}
                    <span className="font-mono text-xs">repodiet-demo-slop-app</span> workspace
                    with intentional AI-code-bloat patterns.
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
                    {result.repo.owner}/{result.repo.name} on{" "}
                    <span className="font-mono">{result.repo.branch}</span>
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
            <p>Next.js, React, Vite, Remix, Astro, Node/Express</p>
            <Separator />
            <p className="text-xs leading-relaxed">
              Phase 2 inspects real repository structure. Duplicate clusters, dead files, and patch
              generation ship in Phase 3.
            </p>
          </CardContent>
        </Card>
      </div>

      {showResults && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Scan results
            </h2>
            {isLoading && (
              <Badge variant="electric" className="animate-pulse-subtle">
                Analyzing…
              </Badge>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ResultCard title="Repository Summary" loading={isLoading && !result}>
              {result && (
                <dl className="space-y-2 text-sm">
                  <Row label="Owner / repo">
                    <span className="font-mono">
                      {result.repo.owner}/{result.repo.name}
                    </span>
                  </Row>
                  <Row label="Branch">
                    <span className="font-mono">{result.repo.branch}</span>
                  </Row>
                  <Row label="Total files">{result.summary.totalFiles.toLocaleString()}</Row>
                  <Row label="Total folders">{result.summary.totalFolders.toLocaleString()}</Row>
                  <Row label="Total size">
                    {result.summary.totalSizeKb.toLocaleString()} KB
                  </Row>
                </dl>
              )}
            </ResultCard>

            <ResultCard title="Framework Detection" loading={isLoading && !result}>
              {result && (
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Detected: </span>
                    <span className="font-medium">{result.framework.name}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Confidence: </span>
                    <span className="font-mono text-electric">
                      {Math.round(result.framework.confidence * 100)}%
                    </span>
                  </div>
                  {result.framework.signals.length > 0 && (
                    <div>
                      <p className="text-muted-foreground mb-1.5">Signals</p>
                      <ul className="space-y-1 font-mono text-xs text-muted-foreground">
                        {result.framework.signals.map((s) => (
                          <li key={s} className="flex gap-2">
                            <span className="text-electric">—</span>
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </ResultCard>

            <ResultCard title="Package Manager" loading={isLoading && !result}>
              {result && (
                <dl className="space-y-2 text-sm">
                  <Row label="Manager">
                    <span className="font-mono uppercase">{result.packageManager}</span>
                  </Row>
                  {result.packageManagerLockfile && (
                    <Row label="Lockfile">
                      <span className="font-mono text-xs">{result.packageManagerLockfile}</span>
                    </Row>
                  )}
                </dl>
              )}
            </ResultCard>

            <ResultCard title="File Tree Summary" loading={isLoading && !result}>
              {result && (
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-muted-foreground mb-1.5">Top extensions</p>
                    <ul className="space-y-1 font-mono text-xs">
                      {Object.entries(result.summary.topExtensions).map(([ext, count]) => (
                        <li key={ext} className="flex justify-between gap-4">
                          <span className="text-muted-foreground">{ext}</span>
                          <span>{count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {result.largestFiles && result.largestFiles.length > 0 && (
                    <div>
                      <p className="text-muted-foreground mb-1.5">Largest files</p>
                      <ul className="space-y-1 font-mono text-xs text-muted-foreground">
                        {result.largestFiles.map((f) => (
                          <li key={f.path} className="truncate">
                            {f.path}{" "}
                            <span className="text-foreground">({f.sizeKb} KB)</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </ResultCard>

            <ResultCard title="Top-Level Folders" loading={isLoading && !result}>
              {result && (
                <div className="flex flex-wrap gap-2">
                  {result.topLevelFolders.map((folder) => (
                    <Badge key={folder} variant="default" className="font-mono text-xs">
                      {folder}
                    </Badge>
                  ))}
                  {result.topLevelFolders.length === 0 && (
                    <span className="text-sm text-muted-foreground">No folders detected</span>
                  )}
                </div>
              )}
            </ResultCard>

            <ResultCard title="Config Files" loading={isLoading && !result}>
              {result && (
                <ul className="space-y-1 font-mono text-xs text-muted-foreground">
                  {result.configFiles.map((file) => (
                    <li key={file} className="flex gap-2">
                      <span className="text-electric">—</span>
                      {file}
                    </li>
                  ))}
                  {result.configFiles.length === 0 && (
                    <li className="text-sm">No config files detected</li>
                  )}
                </ul>
              )}
            </ResultCard>
          </div>

          {result && result.warnings.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-amber-200">
                  <AlertTriangle className="h-4 w-4" />
                  Warnings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {result && (
            <Card className="border-border/80 bg-muted/10">
              <CardContent className="flex flex-wrap items-center gap-4 py-4 text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <GitBranch className="h-4 w-4" />
                  Branch: <span className="font-mono text-foreground">{result.repo.branch}</span>
                </span>
                <Separator orientation="vertical" className="hidden h-4 sm:block" />
                <span className="font-mono text-xs text-muted-foreground truncate max-w-full">
                  {result.repo.url}
                </span>
              </CardContent>
            </Card>
          )}

          {phase === "complete" && (
            <Card className="border-electric/30 bg-electric/5">
              <CardContent className="flex flex-col items-center gap-4 py-6 sm:flex-row sm:justify-between">
                <div className="text-center sm:text-left">
                  <p className="text-sm font-medium">Structure scan complete</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Run the Findings Engine to detect duplicates, unused code, and AI-slop signals.
                  </p>
                </div>
                <Button asChild>
                  <Link href="/app?tab=findings">Run Findings Engine</Link>
                </Button>
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
  children,
}: {
  title: string;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/80">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-electric" />
            <span>Capturing…</span>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
