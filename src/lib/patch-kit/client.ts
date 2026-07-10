import type { FindingsPayload } from "@/lib/findings/types";
import type { PatchKitPayload } from "./types";

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

export async function fetchGitHubConnectionStatus(): Promise<GitHubConnectionStatus> {
  const res = await fetch("/api/github/status", { credentials: "include" });
  const json = (await res.json()) as GitHubConnectionStatus;
  return json;
}

export function startGitHubAppInstall(): void {
  window.location.href = "/api/github/install";
}

export async function disconnectGitHubApp(): Promise<void> {
  await fetch("/api/github/disconnect", { method: "POST", credentials: "include" });
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

  const json = (await res.json()) as {
    ok: boolean;
    pullRequest?: CreateCleanupPrResponse["pullRequest"];
    actionSummary?: CreateCleanupPrResponse["actionSummary"];
    repo?: CreateCleanupPrResponse["repo"];
    warnings?: string[];
    error?: { code: string; message: string };
  };

  if (!json.ok || !json.pullRequest || !json.actionSummary || !json.repo) {
    throw new Error(json.error?.message ?? "Cleanup PR creation failed.");
  }

  return {
    pullRequest: json.pullRequest,
    actionSummary: json.actionSummary,
    repo: json.repo,
    warnings: json.warnings ?? [],
  };
}

export type PatchKitPhase =
  | "idle"
  | "classifying"
  | "patch"
  | "package"
  | "regression"
  | "cursor"
  | "bundle"
  | "complete"
  | "failed";

export const PATCH_KIT_STEPS: { phase: PatchKitPhase; label: string }[] = [
  { phase: "classifying", label: "Classifying safe deletes" },
  { phase: "patch", label: "Building cleanup patch" },
  { phase: "package", label: "Generating package suggestions" },
  { phase: "regression", label: "Writing regression checklist" },
  { phase: "cursor", label: "Preparing Cursor prompt" },
  { phase: "bundle", label: "Creating ZIP bundle" },
  { phase: "complete", label: "Complete" },
];

const PROGRESS: PatchKitPhase[] = [
  "classifying",
  "patch",
  "package",
  "regression",
  "cursor",
  "bundle",
];

export async function runPatchKitGeneration(
  repoUrl: string,
  branch: string | undefined,
  findings: FindingsPayload,
  onPhase: (phase: PatchKitPhase) => void
): Promise<PatchKitPayload> {
  onPhase("classifying");

  let idx = 0;
  const timer = setInterval(() => {
    if (idx < PROGRESS.length - 1) {
      idx += 1;
      onPhase(PROGRESS[idx]);
    }
  }, 900);

  try {
    const res = await fetch("/api/patch-kit/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoUrl: repoUrl.trim(),
        branch: branch?.trim() || undefined,
        findings,
      }),
    });

    const json = (await res.json()) as {
      success: boolean;
      patchKit?: PatchKitPayload;
      error?: string;
    };

    if (!json.success || !json.patchKit) {
      throw new Error(json.error ?? "Patch kit generation failed.");
    }

    onPhase("complete");
    return json.patchKit;
  } catch (err) {
    onPhase("failed");
    throw err;
  } finally {
    clearInterval(timer);
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

  void fetch(patchKit.downloadUrl)
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
