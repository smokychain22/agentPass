import type { FindingsPayload } from "@/lib/findings/types";
import { assertClientGitHubInstallRedirectUrl } from "@/lib/github-app/install-redirect-client";
import type { PatchKitPayload } from "./types";
import { pollJob, startJobOrResult } from "@/lib/jobs/client";

export type CleanupPrMode = "safe_only" | "report_only";

export interface CreateCleanupPrRequest {
  repoUrl: string;
  branch?: string;
  githubToken?: string;
  mode?: CleanupPrMode;
  demo?: boolean;
  findings?: FindingsPayload;
  patchKit?: PatchKitPayload;
}

export interface CreateCleanupPrResponse {
  pullRequest: {
    url: string;
    number: number;
    title: string;
  };
  actionSummary: {
    mode: CleanupPrMode;
    filesDeleted: number;
    artifactsAdded: number;
    safeCandidatesApplied: number;
    reviewFirstSkipped: number;
    doNotTouchSkipped: number;
  };
  repo: {
    owner: string;
    name: string;
    baseBranch: string;
    cleanupBranch: string;
  };
  warnings: string[];
}

export function buildPrSummaryText(result: CreateCleanupPrResponse): string {
  const { repo, actionSummary } = result;
  return `RepoDiet created a review-ready cleanup PR for ${repo.owner}/${repo.name}. It applied ${actionSummary.filesDeleted} safe candidate removals, added ${actionSummary.artifactsAdded} cleanup artifacts, skipped ${actionSummary.reviewFirstSkipped} review-first items, protected ${actionSummary.doNotTouchSkipped} do-not-touch items, and did not mutate main.`;
}

export interface GitHubConnectionStatus {
  ok?: boolean;
  connected: boolean;
  configured: boolean;
  account?: {
    login: string;
    type: string;
  };
  permissions?: {
    contents: string;
    pullRequests: string;
    metadata: string;
  };
}

export type GitHubPreflightResult = import("@/lib/github-app/types").GitHubPreflightResult;

const REPODIET_APP_FALLBACK = "https://skillswap-skillswap7.vercel.app";

export function repodietInstallReturnPath(scanId?: string): string {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    (typeof window !== "undefined" ? window.location.origin : REPODIET_APP_FALLBACK);
  const params = new URLSearchParams({ tab: "patch" });
  if (scanId) params.set("scanId", scanId);
  return `${origin}/app?${params.toString()}`;
}

export async function fetchGitHubConnectionStatus(): Promise<GitHubConnectionStatus> {
  const res = await fetch("/api/github/status", { credentials: "include" });
  const json = (await res.json()) as GitHubConnectionStatus;
  return json;
}

export async function fetchGitHubPreflight(input: {
  repositoryFullName: string;
  branch?: string;
  scanId?: string;
  commitSha?: string;
}): Promise<GitHubPreflightResult> {
  const res = await fetch("/api/github/preflight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as GitHubPreflightResult & { ok: boolean; error?: string };
  if (!json.ok) {
    throw new Error(json.error ?? "GitHub preflight failed.");
  }
  return json;
}

export async function startGitHubGrantAccess(input: {
  repositoryFullName: string;
  scanId?: string;
  returnPath?: string;
}): Promise<void> {
  const res = await fetch("/api/github/install/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    success?: boolean;
    url?: string;
    installUrl?: string;
    flow?: "install" | "configure";
    error?: string;
    repositoryFullName?: string;
    repositoryOwner?: string;
    installationOwner?: string;
    requiresRepositoryOwnerInstall?: boolean;
  };

  const redirectUrl = json.url ?? json.installUrl;
  const succeeded = json.success === true || json.ok === true;

  if (!res.ok || !succeeded || !redirectUrl) {
    throw new Error(json.error ?? "Could not start GitHub installation.");
  }

  assertClientGitHubInstallRedirectUrl(redirectUrl, json.flow);

  window.location.assign(redirectUrl);
}

export function startGitHubAppInstall(repoUrl?: string, scanId?: string): void {
  const params = new URLSearchParams();
  if (repoUrl) params.set("repoUrl", repoUrl);
  if (scanId) params.set("scanId", scanId);
  const qs = params.toString();
  window.location.href = qs ? `/api/github/install?${qs}` : "/api/github/install";
}

export function repositoryFullNameFromRepoUrl(repoUrl: string): string | null {
  try {
    const parsed = new URL(repoUrl.startsWith("http") ? repoUrl : `https://${repoUrl}`);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1].replace(/\.git$/, "")}`;
  } catch {
    return null;
  }
}

export async function disconnectGitHubApp(): Promise<void> {
  await fetch("/api/github/disconnect", { method: "POST", credentials: "include" });
}

export function parseCreateCleanupPrResponse(json: unknown): CreateCleanupPrResponse {
  const body = json as {
    ok?: boolean;
    success?: boolean;
    pullRequest?: CreateCleanupPrResponse["pullRequest"];
    actionSummary?: CreateCleanupPrResponse["actionSummary"];
    repo?: CreateCleanupPrResponse["repo"];
    warnings?: string[];
    result?: {
      pullRequest?: CreateCleanupPrResponse["pullRequest"];
      actionSummary?: CreateCleanupPrResponse["actionSummary"];
      repo?: CreateCleanupPrResponse["repo"];
      warnings?: string[];
    };
    error?: { code: string; message: string } | string;
  };

  const payload = body.result ?? body;
  const pullRequest = payload.pullRequest ?? body.pullRequest;
  const actionSummary = payload.actionSummary ?? body.actionSummary;
  const repo = payload.repo ?? body.repo;
  const warnings = payload.warnings ?? body.warnings ?? [];
  const succeeded = body.ok === true || body.success === true || Boolean(pullRequest?.url);

  if (!succeeded || !pullRequest || !actionSummary || !repo) {
    const message =
      typeof body.error === "string"
        ? body.error
        : body.error?.message ?? "Cleanup PR creation failed.";
    throw new Error(message);
  }

  return { pullRequest, actionSummary, repo, warnings };
}

export async function runCreateCleanupPr(
  request: CreateCleanupPrRequest
): Promise<CreateCleanupPrResponse> {
  const res = await fetch("/api/tools/create_cleanup_pr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(request),
  });

  const json = await res.json();
  return parseCreateCleanupPrResponse(json);
}

export type PatchKitPhase =
  | "idle"
  | "classifying"
  | "patch"
  | "validating"
  | "bundle"
  | "complete"
  | "failed";

export const PATCH_KIT_STEPS: { phase: PatchKitPhase; label: string }[] = [
  { phase: "classifying", label: "Loading supported findings" },
  { phase: "patch", label: "Generating cleanup changes" },
  { phase: "validating", label: "Validating patch (git apply --check)" },
  { phase: "bundle", label: "Building artifact bundle" },
  { phase: "complete", label: "Complete" },
];

const STAGE_TO_PHASE: Record<string, PatchKitPhase> = {
  queued: "classifying",
  loading_findings: "classifying",
  classifying: "classifying",
  generating_patch: "patch",
  validating_patch: "validating",
  building_bundle: "bundle",
  complete: "complete",
};

function mapStageToPhase(stage: string): PatchKitPhase {
  return STAGE_TO_PHASE[stage] ?? "classifying";
}

export async function runPatchKitGeneration(
  repoUrl: string,
  branch: string | undefined,
  findings: FindingsPayload,
  onPhase: (phase: PatchKitPhase) => void,
  selectedFindingIds?: string[]
): Promise<PatchKitPayload> {
  onPhase("classifying");

  try {
    const started = await startJobOrResult<PatchKitPayload>("/api/jobs/patch", {
      repoUrl: repoUrl.trim(),
      branch: branch?.trim() || undefined,
      findings,
      scanId: findings.scanId,
      selectedFindingIds,
    });

    if (started.result) {
      onPhase("complete");
      return started.result;
    }

    const patchKit = await pollJob<PatchKitPayload>("/api/jobs/patch", started.jobId, (stage) => {
      onPhase(mapStageToPhase(stage));
    });

    onPhase("complete");
    return patchKit;
  } catch (err) {
    onPhase("failed");
    throw err;
  }
}

export function patchKitZipFilename(repoName: string, branch: string): string {
  const safeRepo = repoName.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const safeBranch = branch.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `repodiet-${safeRepo}-${safeBranch}.zip`;
}

export function downloadPatchKitZip(
  patchKit: PatchKitPayload,
  repoName: string,
  branch: string
): void {
  if (patchKit.zipBase64) {
    const binary = atob(patchKit.zipBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "application/zip" });
    triggerDownload(blob, patchKitZipFilename(repoName, branch));
    return;
  }

  const downloadUrl = patchKit.downloadUrl.startsWith("/api/patches/")
    ? patchKit.downloadUrl
    : `/api/patches/${patchKit.id}/download`;

  void fetch(downloadUrl)
    .then((res) => {
      if (!res.ok) throw new Error("ZIP download failed.");
      return res.blob();
    })
    .then((blob) => triggerDownload(blob, patchKitZipFilename(repoName, branch)))
    .catch(() => {
      throw new Error("ZIP download failed.");
    });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadTextFile(content: string, filename: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: mime });
  triggerDownload(blob, filename);
}

export async function copyText(content: string): Promise<void> {
  await navigator.clipboard.writeText(content);
}

export interface VerificationResult {
  status: "passed" | "failed" | "partial" | "not_run";
  checks: Array<{
    name: string;
    command: string;
    status: "passed" | "failed" | "not_run" | "skipped";
    exitCode: number | null;
    durationMs: number;
    stdoutSummary: string;
    stderrSummary: string;
  }>;
  limitations: string[];
}

export async function runVerification(patchId: string): Promise<VerificationResult> {
  const res = await fetch("/api/verify/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patchId }),
  });

  const json = (await res.json()) as VerificationResult & { success: boolean; error?: string };
  if (!json.success) {
    throw new Error(json.error ?? "Verification failed.");
  }

  return {
    status: json.status,
    checks: json.checks,
    limitations: json.limitations,
  };
}
