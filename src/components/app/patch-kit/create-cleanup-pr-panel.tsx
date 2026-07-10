"use client";

import { useMemo, useState } from "react";
import { AlertCircle, ExternalLink, GitPullRequest, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import {
  runCreateCleanupPr,
  type CleanupPrMode,
  type CreateCleanupPrResponse,
} from "@/lib/patch-kit/client";
import type { FindingsPayload } from "@/lib/findings/types";
import type { PatchKitPayload } from "@/lib/patch-kit/types";

interface CreateCleanupPrPanelProps {
  repoUrl: string;
  branch?: string;
  findings: FindingsPayload;
  patchKit: PatchKitPayload;
}

export function CreateCleanupPrPanel({
  repoUrl,
  branch,
  findings,
  patchKit,
}: CreateCleanupPrPanelProps) {
  const isDemoRepo = useMemo(() => isDemoRepoUrl(repoUrl), [repoUrl]);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CleanupPrMode>("safe_only");
  const [demo, setDemo] = useState(isDemoRepo);
  const [githubToken, setGithubToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateCleanupPrResponse | null>(null);

  const safeCount = patchKit.summary.safeDeleteCandidates;

  const submit = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await runCreateCleanupPr({
        repoUrl,
        branch,
        mode,
        demo: demo && isDemoRepo,
        githubToken: demo && isDemoRepo ? undefined : githubToken,
        findings,
        patchKit,
      });
      setResult(response);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cleanup PR creation failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setOpen((v) => !v)} disabled={loading}>
          <GitPullRequest className="h-4 w-4" />
          Create Cleanup PR
        </Button>
        <Badge variant="muted" className="font-mono text-[10px]">
          RepoDiet Operator
        </Badge>
      </div>

      {open && (
        <Card className="border-electric/20 bg-card/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Open review-ready cleanup PR</CardTitle>
            <p className="text-sm text-muted-foreground leading-relaxed">
              RepoDiet creates a cleanup branch, applies safe deletions only, adds report artifacts
              under <code className="text-xs">repodiet/</code>, and opens a GitHub PR for human
              review. Tokens are used once and never stored.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cleanup-mode">Mode</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "safe_only" ? "default" : "outline"}
                  onClick={() => setMode("safe_only")}
                >
                  Safe only ({safeCount})
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "report_only" ? "default" : "outline"}
                  onClick={() => setMode("report_only")}
                >
                  Report only
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {mode === "safe_only"
                  ? "Deletes safe candidates and adds RepoDiet artifacts."
                  : "Adds RepoDiet artifacts only — no code deletions."}
              </p>
            </div>

            {isDemoRepo && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={demo}
                  onChange={(e) => setDemo(e.target.checked)}
                />
                <span>
                  Use demo mode for <span className="font-mono text-xs">repodiet/demo-slop-app</span>
                </span>
              </label>
            )}

            {(!demo || !isDemoRepo) && (
              <div className="space-y-2">
                <Label htmlFor="github-token">GitHub token</Label>
                <Input
                  id="github-token"
                  type="password"
                  autoComplete="off"
                  placeholder="Fine-grained token with Contents + Pull requests access"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Paste a token with access to this repo. RepoDiet uses it once server-side and
                  never stores or logs it.
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={submit} disabled={loading || ((!demo || !isDemoRepo) && !githubToken.trim())}>
                {loading ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Creating PR…
                  </>
                ) : (
                  "Create Cleanup PR"
                )}
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div>
            <p className="text-sm font-medium text-red-300">Cleanup PR failed</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      {result?.pullRequest && (
        <Card className="border-signal/30 bg-signal/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-signal">Cleanup PR opened</p>
              <p className="mt-1 text-sm text-muted-foreground">{result.pullRequest.title}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {result.actionSummary?.safeCandidatesApplied ?? 0} safe deletes ·{" "}
                {result.actionSummary?.artifactsAdded ?? 5} artifacts
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <a href={result.pullRequest.url} target="_blank" rel="noreferrer">
                View PR #{result.pullRequest.number}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
