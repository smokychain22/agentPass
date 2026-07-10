"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Github,
  GitPullRequest,
  Loader2,
  Lock,
  Shield,
  Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import {
  buildPrSummaryText,
  copyText,
  disconnectGitHubApp,
  fetchGitHubConnectionStatus,
  runCreateCleanupPr,
  startGitHubAppInstall,
  type CleanupPrMode,
  type CreateCleanupPrResponse,
  type GitHubConnectionStatus,
} from "@/lib/patch-kit/client";
import type { FindingsPayload } from "@/lib/findings/types";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import { cn } from "@/lib/utils";

interface RepoDietOperatorSectionProps {
  repoUrl: string;
  branch?: string;
  findings: FindingsPayload | null;
  patchKit: PatchKitPayload | null;
  demoMode: boolean;
}

function InfoCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("border-border/80 bg-card/40", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground leading-relaxed space-y-2">
        {children}
      </CardContent>
    </Card>
  );
}

export function RepoDietOperatorSection({
  repoUrl,
  branch,
  findings,
  patchKit,
  demoMode,
}: RepoDietOperatorSectionProps) {
  const searchParams = useSearchParams();
  const isDemoRepo = useMemo(() => isDemoRepoUrl(repoUrl), [repoUrl]);
  const useDemoAuth = demoMode && isDemoRepo;

  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<CleanupPrMode | null>(null);
  const [githubToken, setGithubToken] = useState("");
  const [showAdvancedToken, setShowAdvancedToken] = useState(false);
  const [githubStatus, setGithubStatus] = useState<GitHubConnectionStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateCleanupPrResponse | null>(null);
  const [summaryCopied, setSummaryCopied] = useState(false);

  const safeCount = patchKit?.summary.safeDeleteCandidates ?? 0;
  const locked = !findings || !patchKit;
  const canCreateSafePr = !locked && safeCount > 0;
  const canCreateReportPr = !locked;
  const githubConnected = Boolean(githubStatus?.connected);

  const refreshGitHubStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const status = await fetchGitHubConnectionStatus();
      setGithubStatus(status);
    } catch {
      setGithubStatus({ connected: false, configured: false });
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshGitHubStatus();
  }, [refreshGitHubStatus]);

  useEffect(() => {
    if (searchParams.get("github_connected") === "true") {
      void refreshGitHubStatus();
    }
  }, [searchParams, refreshGitHubStatus]);

  const submit = async (mode: CleanupPrMode) => {
    if (!findings || !patchKit) return;

    setLoading(true);
    setLoadingMode(mode);
    setError(null);

    try {
      const response = await runCreateCleanupPr({
        repoUrl,
        branch,
        mode,
        demo: useDemoAuth,
        githubToken: showAdvancedToken && githubToken.trim() ? githubToken : undefined,
        findings,
        patchKit,
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cleanup PR creation failed.");
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  };

  const copySummary = async () => {
    if (!result) return;
    await copyText(buildPrSummaryText(result));
    setSummaryCopied(true);
    setTimeout(() => setSummaryCopied(false), 2000);
  };

  const disconnect = async () => {
    await disconnectGitHubApp();
    await refreshGitHubStatus();
  };

  const needsAuth =
    !useDemoAuth && !githubConnected && !(showAdvancedToken && githubToken.trim());

  return (
    <section className="space-y-6 rounded-lg border border-electric/20 bg-electric/5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight">RepoDiet Operator</h3>
            <Badge variant="electric" className="font-mono text-[9px] uppercase tracking-wider">
              GitHub App
            </Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground leading-relaxed">
            Install RepoDiet on the repo you want to clean. RepoDiet uses minimum GitHub
            permissions and creates a review-ready PR. It never pushes to main and never merges.
          </p>
          {!locked && !useDemoAuth && (
            <p className="mt-2 text-xs text-amber-400/90">
              RepoDiet only opens pull requests. You stay in control of review and merge.
            </p>
          )}
        </div>
        {locked && (
          <Badge variant="muted" className="gap-1.5 font-mono text-[10px]">
            <Lock className="h-3 w-3" />
            Locked
          </Badge>
        )}
      </div>

      {locked ? (
        <Card className="border-dashed border-border bg-card/30">
          <CardContent className="flex items-start gap-3 py-6">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Run Findings + Patch Kit first</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Generate your patch bundle above. RepoDiet Operator unlocks after findings and Patch
                Kit artifacts are ready.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-border/80 bg-card/50">
            <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Github className="h-4 w-4" />
                  GitHub connection
                </p>
                {statusLoading ? (
                  <p className="text-sm text-muted-foreground">Checking connection…</p>
                ) : useDemoAuth ? (
                  <p className="text-sm text-muted-foreground">
                    Demo mode — server token for{" "}
                    <span className="font-mono text-xs">repodiet/demo-slop-app</span>
                  </p>
                ) : githubConnected ? (
                  <p className="text-sm text-signal">
                    GitHub App connected
                    {githubStatus?.account?.login
                      ? ` · ${githubStatus.account.login}`
                      : ""}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Not connected</p>
                )}
                {!useDemoAuth && (
                  <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
                    Install RepoDiet on the repo you want to clean. RepoDiet uses minimum GitHub
                    permissions and creates a review-ready PR. It never pushes to main and never
                    merges.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                {!useDemoAuth && !githubConnected && githubStatus?.configured !== false && (
                  <Button onClick={startGitHubAppInstall}>
                    <Github className="h-4 w-4" />
                    Connect GitHub
                  </Button>
                )}
                {!useDemoAuth && githubConnected && (
                  <Button variant="outline" size="sm" onClick={disconnect}>
                    <Unplug className="h-4 w-4" />
                    Disconnect
                  </Button>
                )}
                {!useDemoAuth && githubStatus?.configured === false && (
                  <Badge variant="muted" className="text-xs">
                    GitHub App not configured on server
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <InfoCard title="Cleanup Mode">
              <p>
                <span className="text-foreground font-medium">Safe-only PR</span> — deletes safe
                candidates and adds RepoDiet artifacts.
              </p>
              <p>
                <span className="text-foreground font-medium">Report-only PR</span> — adds cleanup
                artifacts without deleting code.
              </p>
            </InfoCard>

            <InfoCard title="GitHub Access">
              {useDemoAuth ? (
                <>
                  <p>Demo mode uses the configured demo repo token.</p>
                  <p className="font-mono text-xs">repodiet/demo-slop-app</p>
                </>
              ) : githubConnected ? (
                <>
                  <p>GitHub App installation connected.</p>
                  <p>Short-lived installation tokens are generated server-side on demand.</p>
                </>
              ) : (
                <>
                  <p>Install the RepoDiet GitHub App on your repository.</p>
                  <p>No personal token required for the primary flow.</p>
                </>
              )}
            </InfoCard>

            <InfoCard title="Safe Candidates">
              <p className="font-mono text-2xl font-semibold text-signal">{safeCount}</p>
              {safeCount > 0 ? (
                <p className="text-signal">Ready to create cleanup PR.</p>
              ) : (
                <p>Safe cleanup PR unavailable. Create a report-only PR instead.</p>
              )}
              {safeCount > 0 && (
                <p className="font-mono text-[11px]">archive/** · backup/** · tmp/** · old/**</p>
              )}
            </InfoCard>

            <InfoCard title="PR Safety Policy">
              <p className="text-xs text-foreground font-medium mb-2">
                RepoDiet creates a branch and PR. You review and merge.
              </p>
              <ul className="space-y-1.5 text-xs">
                <li className="flex gap-2">
                  <Shield className="mt-0.5 h-3 w-3 shrink-0 text-signal" />
                  Never pushes to main
                </li>
                <li className="flex gap-2">
                  <Shield className="mt-0.5 h-3 w-3 shrink-0 text-signal" />
                  Never merges PRs
                </li>
                <li className="flex gap-2">
                  <Shield className="mt-0.5 h-3 w-3 shrink-0 text-signal" />
                  Never deletes protected files
                </li>
                <li className="flex gap-2">
                  <Shield className="mt-0.5 h-3 w-3 shrink-0 text-signal" />
                  Review First findings documented, not changed
                </li>
              </ul>
            </InfoCard>
          </div>

          {!useDemoAuth && (
            <Card className="border-signal/20 bg-signal/5">
              <CardContent className="py-4">
                <p className="text-sm font-medium text-signal">Minimum permissions</p>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <li>Contents: write</li>
                  <li>Pull requests: write</li>
                  <li>Metadata: read</li>
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  No access to secrets, actions, admin settings, or organization members.
                </p>
              </CardContent>
            </Card>
          )}

          {!useDemoAuth && (
            <details
              className="rounded-md border border-border bg-card/40 p-4"
              open={showAdvancedToken}
              onToggle={(e) => setShowAdvancedToken((e.target as HTMLDetailsElement).open)}
            >
              <summary className="cursor-pointer text-sm font-medium">
                Advanced manual token mode
              </summary>
              <div className="mt-4 space-y-2">
                <Label htmlFor="operator-github-token">Fine-grained GitHub token</Label>
                <Input
                  id="operator-github-token"
                  type="password"
                  autoComplete="off"
                  placeholder="Optional fallback token"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Emergency hackathon fallback only. Required: Contents Read/Write and Pull Requests
                  Read/Write. Prefer the GitHub App install flow.
                </p>
              </div>
            </details>
          )}

          {safeCount === 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-muted-foreground">
              No safe candidates found. RepoDiet can create a report-only PR with cleanup artifacts
              instead.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => submit("safe_only")}
              disabled={loading || !canCreateSafePr || needsAuth}
            >
              {loading && loadingMode === "safe_only" ? (
                <>
                  <Loader2 className="animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <GitPullRequest className="h-4 w-4" />
                  Create Cleanup PR
                </>
              )}
            </Button>
            <Button
              variant="secondary"
              onClick={() => submit("report_only")}
              disabled={loading || !canCreateReportPr || needsAuth}
            >
              {loading && loadingMode === "report_only" ? (
                <>
                  <Loader2 className="animate-spin" />
                  Creating…
                </>
              ) : (
                "Create Report-Only PR"
              )}
            </Button>
            <Button
              variant="outline"
              disabled={!result?.pullRequest?.url}
              asChild={Boolean(result?.pullRequest?.url)}
            >
              {result?.pullRequest?.url ? (
                <a href={result.pullRequest.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Open PR
                </a>
              ) : (
                <>
                  <ExternalLink className="h-4 w-4" />
                  Open PR
                </>
              )}
            </Button>
            <Button variant="ghost" disabled={!result} onClick={copySummary}>
              <Copy className="h-4 w-4" />
              {summaryCopied ? "Copied" : "Copy PR Summary"}
            </Button>
          </div>
        </>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div>
            <p className="text-sm font-medium text-red-300">Cleanup PR failed</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            {!useDemoAuth && !githubConnected && error.toLowerCase().includes("install") && (
              <Button className="mt-3" size="sm" onClick={startGitHubAppInstall}>
                <Github className="h-4 w-4" />
                Install GitHub App
              </Button>
            )}
          </div>
        </div>
      )}

      {result?.pullRequest && (
        <Card className="border-signal/30 bg-signal/5">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-signal" />
              <CardTitle className="text-sm font-medium text-signal">Cleanup PR created</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <InfoCard title="PR Output" className="bg-transparent">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">PR URL</p>
                  <a
                    href={result.pullRequest.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate font-mono text-xs text-electric hover:underline"
                  >
                    {result.pullRequest.url}
                  </a>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Branch</p>
                  <p className="mt-1 font-mono text-xs">{result.repo.cleanupBranch}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Files deleted
                  </p>
                  <p className="mt-1 font-mono text-xs">{result.actionSummary.filesDeleted}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Artifacts added
                  </p>
                  <p className="mt-1 font-mono text-xs">{result.actionSummary.artifactsAdded}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Review first skipped
                  </p>
                  <p className="mt-1 font-mono text-xs">
                    {result.actionSummary.reviewFirstSkipped}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Do not touch protected
                  </p>
                  <p className="mt-1 font-mono text-xs">
                    {result.actionSummary.doNotTouchSkipped}
                  </p>
                </div>
              </div>
            </InfoCard>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <a href={result.pullRequest.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open GitHub PR #{result.pullRequest.number}
                </a>
              </Button>
              <Button variant="outline" size="sm" onClick={copySummary}>
                <Copy className="h-3.5 w-3.5" />
                {summaryCopied ? "Copied" : "Copy PR Summary"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
