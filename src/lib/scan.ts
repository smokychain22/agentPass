import type { ScanPhase } from "@/lib/scanner/types";
import type { ScanPayload } from "@/lib/scanner/run-scan";

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

export const DEMO_REPO =
  "https://github.com/vercel/next.js/tree/canary/examples/hello-world";

export function isValidGitHubUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(normalized);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return parsed.hostname.replace(/^www\./, "") === "github.com" && segments.length >= 2;
  } catch {
    return false;
  }
}

const PROGRESS_PHASES: ScanPhase[] = [
  "validating",
  "fetching",
  "unpacking",
  "detecting",
  "scanning",
];

interface RunScanResponse {
  success: boolean;
  scan?: ScanPayload;
  error?: string;
}

export async function runScan(
  repoUrl: string,
  branch: string | undefined,
  onPhase: (phase: ScanPhase | "idle") => void
): Promise<ScanPayload> {
  onPhase("validating");

  let phaseIdx = 0;
  const timer = setInterval(() => {
    if (phaseIdx < PROGRESS_PHASES.length - 1) {
      phaseIdx += 1;
      onPhase(PROGRESS_PHASES[phaseIdx]);
    }
  }, 700);

  try {
    const res = await fetch("/api/scans/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoUrl: repoUrl.trim(),
        branch: branch?.trim() || undefined,
      }),
    });

    const json = (await res.json()) as RunScanResponse;

    if (!json.success || !json.scan) {
      throw new Error(json.error ?? "Scan failed.");
    }

    onPhase("complete");
    return json.scan;
  } catch (err) {
    onPhase("failed");
    throw err;
  } finally {
    clearInterval(timer);
  }
}
