"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { accessCopyForState } from "@/lib/github-app/access-states";
import {
  buildPrSummaryText,
  copyText,
  disconnectGitHubApp,
  fetchGitHubConnectionStatus,
  fetchGitHubPreflight,
  runCreateCleanupPr,
  repodietInstallReturnPath,
  startGitHubGrantAccess,
  repositoryFullNameFromRepoUrl,
  type CleanupPrMode,
  type CreateCleanupPrResponse,
  type GitHubConnectionStatus,
  type GitHubPreflightResult,
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
  requireVerificationForCleanupPr?: boolean;
  verificationStatus?: "passed" | "failed" | "partial" | "not_run" | null;
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

function githubErrorMessage(code: string | null, repoName: string): string | null {
  if (!code) return null;
  switch (code) {
    case "repo_not_granted":
      return `GitHub saved the installation, but ${repoName} was not included. Click Grant Access again, select that repository on GitHub, then click Save.`;
    case "state_expired":
      return accessCopyForState("state_expired", repoName).body;
    case "wrong_account":
      return accessCopyForState(
        "wrong_account",
        repoName,
        repoName.includes("/") ? repoName.split("/")[0] : undefined
      ).body;
    case "state_reused":
    case "invalid_state":
      return "GitHub finished installation, but RepoDiet could not verify the request. Click Install RepoDiet again. Use https://skillswap-skillswap7.vercel.app (not a preview URL) for the most reliable install flow.";
    case "invalid_setup_action":
    case "missing_setup_action":
      return "GitHub returned an unexpected installation action. Try again.";
    default:
      return "GitHub connection did not complete. Try again.";
  }
}

export function RepoDietOperatorSection({
  repoUrl,
  branch,
  findings,
  patchKit,
  demoMode,
  requireVerificationForCleanupPr = false,
  verificationStatus = null,
}: RepoDietOperatorSectionProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const isDemoRepo = useMemo(() => isDemoRepoUrl(repoUrl), [repoUrl]);
  const useDemoAuth = demoMode && isDemoRepo;
  const repositoryFullName = useMemo(
    () => repositoryFullNameFromRepoUrl(repoUrl) ?? "",
    [repoUrl]
  );
  const repoShortName = repositoryFullName.split("/")[1] ?? repositoryFullName;

  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<CleanupPrMode | null>(null);
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [githubToken, setGithubToken] = useState("");
  const [showAdvancedToken, setShowAdvancedToken] = useState(false);
  const [githubStatus, setGithubStatus] = useState<GitHubConnectionStatus | null>(null);
  const [preflight, setPreflight] = useState<GitHubPreflightResult | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateCleanupPrResponse | null>(null);
  const [summaryCopied, setSummaryCopied] = useState(false);

  const safeCount = patchKit?.summary.safeDeleteCandidates ?? 0;
  const validatedChanges = patchKit?.summary.validatedChanges ?? 0;
  const locked = !findings || !patchKit;
  const patchValidated = patchKit?.patchValidation?.status === "passed";
  const githubAccountConnected = Boolean(githubStatus?.connected);
  const repositoryReady = Boolean(preflight?.repositoryAuthorized);
  const canCreateReportPr =
    !locked &&
    repositoryReady &&
    Boolean(preflight?.canCreateBranch) &&
    Boolean(preflight?.canCreatePullRequest);
  const canCreateSafePr =
    canCreateReportPr &&
    (validatedChanges > 0 || safeCount > 0) &&
    patchValidated &&
    (!requireVerificationForCleanupPr || verificationStatus === "passed");

  const githubReturnError = githubErrorMessage(
    searchParams.get("github_error"),
    repoShortName || repositoryFullName
  );

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

  const runPreflight = useCallback(async () => {
    if (!repositoryFullName || useDemoAuth) {
      setPreflight(null);
      return;
    }
    setPreflightLoading(true);
    try {
      const result = await fetchGitHubPreflight({
        repositoryFullName,
        branch,
        scanId: findings?.scanId,
        commitSha: findings?.repo.commitSha,
      });
      setPreflight(result);
    } catch {
      setPreflight(null);
    } finally {
      setPreflightLoading(false);
    }
  }, [repositoryFullName, branch, findings, useDemoAuth]);

  useEffect(() => {
    void refreshGitHubStatus();
  }, [refreshGitHubStatus]);

  useEffect(() => {
    void runPreflight();
  }, [runPreflight]);

  useEffect(() => {
    const githubConnected =
      searchParams.get("github") === "connected" ||
      searchParams.get("github_connected") === "true";
    const githubRecovered = searchParams.get("github_recovered") === "installation_only";
    const githubRepoPending = searchParams.get("github_repo_pending") === "true";

    if (!githubConnected && !githubRecovered && !githubRepoPending) return;

    void refreshGitHubStatus()
      .then(() => runPreflight())
      .finally(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("github");
        params.delete("github_connected");
        params.delete("github_recovered");
        params.delete("github_repo_pending");
        params.delete("setup_action");
        const qs = params.toString();
        router.replace(qs ? `/app?${qs}` : "/app?tab=patch", { scroll: false });
      });
  }, [searchParams, refreshGitHubStatus, runPreflight, router]);

  const grantAccess = async () => {
    if (!repositoryFullName) return;
    setGrantLoading(true);
    setGrantError(null);
    setError(null);
    try {
      await startGitHubGrantAccess({
        repositoryFullName,
        scanId: findings?.scanId,
        returnPath: repodietInstallReturnPath(findings?.scanId),
      });
    } catch (err) {
      setGrantLoading(false);
      const message =
        err instanceof Error ? err.message : "Could not start GitHub access flow.";
      setGrantError(message);
    }
  };

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
      void runPreflight();
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
    await runPreflight();
  };

  const needsManualToken =
    !useDemoAuth && !repositoryReady && showAdvancedToken && githubToken.trim();

  const repositoryOwner = preflight?.repositoryOwner ?? repositoryFullName.split("/")[0] ?? "";
  const installationOwner = preflight?.installationOwner ?? githubStatus?.account?.login;
  const requiresOwnerInstall = Boolean(preflight?.requiresRepositoryOwnerInstall);
  const githubAppInstalled = Boolean(githubStatus?.connected && githubStatus?.account?.login);

  const accessMessages =
    preflight?.messages ??
    accessCopyForState(
      preflight?.accessState ?? (githubAccountConnected ? "installed_repo_missing" : "not_installed"),
      repoShortName || repositoryFullName,
      repositoryFullName.split("/")[0]
    );

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
            RepoDiet opens review-ready pull requests on your repository. You review and merge —
            RepoDiet never pushes to main.
          </p>
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
              <p className="text-sm font-medium">Run Findings + Quick Cleanup first</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Generate your cleanup bundle above. RepoDiet Operator unlocks after findings and
                artifacts are ready.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-border/80 bg-card/50">
            <CardContent className="flex flex-col gap-4 py-4">
              <div className="space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Github className="h-4 w-4" />
                  GitHub access
                </p>
                {statusLoading || preflightLoading ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking repository access…
                  </p>
                ) : useDemoAuth ? (
                  <p className="text-sm text-muted-foreground">
                    Demo mode — server token for{" "}
                    <span className="font-mono text-xs">repodiet/demo-slop-app</span>
                  </p>
                ) : repositoryReady ? (
                  <div className="space-y-1 text-sm text-signal">
                    <p>GitHub connected</p>
                    <p>{repositoryFullName} authorized</p>
                    <p>Permissions verified</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">{accessMessages.title}</p>
                    <p className="text-sm text-muted-foreground">{accessMessages.body}</p>
                    <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
                      <p>
                        <span className="text-foreground">Target repository:</span>{" "}
                        <span className="font-mono">{repositoryFullName}</span>
                      </p>
                      {githubAppInstalled && installationOwner && (
                        <p>
                          <span className="text-foreground">Current installation:</span>{" "}
                          <span className="font-mono">{installationOwner}</span>
                        </p>
                      )}
                      {requiresOwnerInstall && repositoryOwner && (
                        <p>
                          RepoDiet must be installed on{" "}
                          <span className="font-mono text-foreground">{repositoryOwner}</span> to
                          open pull requests for this repository.
                        </p>
                      )}
                    </div>
                    {githubAppInstalled && !requiresOwnerInstall && (
                      <p className="text-xs text-muted-foreground">
                        RepoDiet installed on{" "}
                        <span className="font-mono">{installationOwner}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {grantError && !repositoryReady && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
                  {grantError}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {!useDemoAuth && !repositoryReady && githubStatus?.configured !== false && (
                  <Button onClick={grantAccess} disabled={grantLoading || !repositoryFullName}>
                    {grantLoading ? (
                      <>
                        <Loader2 className="animate-spin" />
                        Opening GitHub…
                      </>
                    ) : (
                      <>
                        <Github className="h-4 w-4" />
                        {accessMessages.primaryAction ??
                          `Grant Access to ${repoShortName || "Repository"}`}
                      </>
                    )}
                  </Button>
                )}
                {!useDemoAuth && repositoryReady && (
                  <Button variant="outline" size="sm" onClick={disconnect}>
                    <Unplug className="h-4 w-4" />
                    Disconnect
                  </Button>
                )}
                {!useDemoAuth && accessMessages.secondaryAction && !repositoryReady && (
                  <Button variant="ghost" size="sm" onClick={() => router.push("/app?tab=scan")}>
                    {accessMessages.secondaryAction}
                  </Button>
                )}
                {githubReturnError && !repositoryReady && (
                  <Button variant="secondary" size="sm" onClick={grantAccess}>
                    Try Again
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {githubReturnError && !repositoryReady && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-muted-foreground">
              {githubReturnError}
            </div>
          )}

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

            <InfoCard title="Repository">
              <p className="font-mono text-xs">{repositoryFullName || repoUrl}</p>
              {repositoryReady ? (
                <p className="text-signal">Ready for pull requests</p>
              ) : (
                <p>Grant repository access to enable PR actions.</p>
              )}
            </InfoCard>

            <InfoCard title="Validated Changes">
              <p className="font-mono text-2xl font-semibold text-signal">{validatedChanges}</p>
              {validatedChanges > 0 && patchValidated ? (
                <p className="text-signal">Ready to create cleanup PR.</p>
              ) : (patchKit?.summary.eligibleFindings ?? patchKit?.summary.transformerCompatible) ? (
                <p>
                  {patchKit.summary.eligibleFindings ?? patchKit.summary.transformerCompatible}{" "}
                  eligible; {patchKit.summary.attemptedTransformations ?? 0} attempted;{" "}
                  {patchKit.summary.generatedChanges ?? 0} generated;{" "}
                  {validatedChanges > 0
                    ? "patch validation must pass before cleanup PR."
                    : "none verified yet."}
                </p>
              ) : (
                <p>Safe cleanup PR unavailable. Create a report-only PR instead.</p>
              )}
            </InfoCard>

            <InfoCard title="File Deletions">
              <p className="font-mono text-2xl font-semibold text-muted-foreground">{safeCount}</p>
              <p>Conservative delete-only candidates (archive/backup paths).</p>
            </InfoCard>

            <InfoCard title="PR Safety Policy">
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
                  Protected files are never deleted
                </li>
              </ul>
            </InfoCard>
          </div>

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
                  Emergency fallback only. Prefer the one-click Grant Access flow.
                </p>
              </div>
            </details>
          )}

          {validatedChanges === 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-muted-foreground">
              {patchKit?.summary.blockerSummary
                ? patchKit.summary.blockerSummary
                : (patchKit?.summary.eligibleFindings ?? patchKit?.summary.transformerCompatible ?? 0) > 0
                  ? `${patchKit.summary.eligibleFindings ?? patchKit.summary.transformerCompatible} eligible finding(s); ${patchKit.summary.attemptedTransformations ?? 0} attempted; ${patchKit.summary.generatedChanges ?? 0} generated; 0 verified changes retained. You can create a report-only PR with cleanup artifacts.`
                  : "No validated code changes were generated. RepoDiet can create a report-only PR with cleanup artifacts instead."}
            </div>
          )}

          {requireVerificationForCleanupPr && validatedChanges > 0 && patchValidated && verificationStatus !== "passed" && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-muted-foreground">
              Cleanup PR requires verification to pass on the Verify tab before code changes can be delivered.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => submit("safe_only")}
              disabled={loading || (!canCreateSafePr && !needsManualToken)}
              title={
                requireVerificationForCleanupPr && verificationStatus !== "passed"
                  ? "Run verification on the Verify tab first"
                  : undefined
              }
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
              disabled={loading || (!canCreateReportPr && !needsManualToken)}
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
            {!useDemoAuth && !repositoryReady && (
              <Button className="mt-3" size="sm" onClick={grantAccess}>
                <Github className="h-4 w-4" />
                {accessMessages.primaryAction ??
                  `Grant Access to ${repoShortName || "Repository"}`}
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
