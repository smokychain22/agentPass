import type { ScanPhase } from "@/lib/scanner/types";
import type { ScanPayload } from "@/lib/scanner/run-scan";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import { pollJob, startJob } from "@/lib/jobs/client";

export type ScanResult = Omit<ScanPayload, "id">;

export type { ScanPhase, ScanPayload };

export const SCAN_STEPS: { phase: ScanPhase; label: string }[] = [
  { phase: "validating", label: "Validating URL" },
  { phase: "fetching", label: "Fetching repository" },
  { phase: "unpacking", label: "Unpacking ZIP" },
  { phase: "detecting", label: "Detecting framework" },
  { phase: "scanning", label: "Scanning file tree" },
  { phase: "complete", label: "Complete" },
];

export { DEMO_REPO_URL as DEMO_REPO } from "@/lib/demo/constants";
export { isDemoRepoUrl } from "@/lib/demo/constants";

export function isValidGitHubUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (isDemoRepoUrl(trimmed)) return true;
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(normalized);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return parsed.hostname.replace(/^www\./, "") === "github.com" && segments.length >= 2;
  } catch {
    return false;
  }
}

const STAGE_TO_PHASE: Record<string, ScanPhase> = {
  queued: "validating",
  fetching_repo: "fetching",
  extracting: "unpacking",
  framework_detection: "detecting",
  file_tree: "scanning",
  complete: "complete",
};

function mapStageToPhase(stage: string): ScanPhase | "idle" {
  return STAGE_TO_PHASE[stage] ?? "scanning";
}

export async function runScan(
  repoUrl: string,
  branch: string | undefined,
  onPhase: (phase: ScanPhase | "idle") => void
): Promise<ScanPayload> {
  onPhase("validating");

  try {
    const jobId = await startJob("/api/jobs/scan", {
      repoUrl: repoUrl.trim(),
      branch: branch?.trim() || undefined,
    });

    const scan = await pollJob<ScanPayload>("/api/jobs/scan", jobId, (stage) => {
      onPhase(mapStageToPhase(stage));
    });

    onPhase("complete");
    return scan;
  } catch (err) {
    onPhase("failed");
    throw err;
  }
}

/** Legacy direct scan for backwards compatibility. */
export async function runScanDirect(
  repoUrl: string,
  branch: string | undefined,
  onPhase: (phase: ScanPhase | "idle") => void
): Promise<ScanPayload> {
  onPhase("fetching");
  const res = await fetch("/api/scans/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoUrl: repoUrl.trim(),
      branch: branch?.trim() || undefined,
    }),
  });
  const json = (await res.json()) as { success: boolean; scan?: ScanPayload; error?: string };
  if (!json.success || !json.scan) {
    onPhase("failed");
    throw new Error(json.error ?? "Scan failed.");
  }
  onPhase("complete");
  return json.scan;
}
