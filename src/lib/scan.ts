export type ScanPhase =
  | "idle"
  | "validating"
  | "fetching"
  | "unpacking"
  | "detecting"
  | "scanning"
  | "complete"
  | "failed";

export const SCAN_STEPS: { phase: ScanPhase; label: string }[] = [
  { phase: "validating", label: "Validating URL" },
  { phase: "fetching", label: "Fetching repository" },
  { phase: "unpacking", label: "Unpacking ZIP" },
  { phase: "detecting", label: "Detecting framework" },
  { phase: "scanning", label: "Scanning file tree" },
  { phase: "complete", label: "Complete" },
];

export interface ScanResultPlaceholder {
  repoUrl: string;
  branch: string;
}

export function isValidGitHubUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return (
      parsed.hostname === "github.com" &&
      parsed.pathname.split("/").filter(Boolean).length >= 2
    );
  } catch {
    return false;
  }
}

export function parseRepoLabel(url: string): string {
  try {
    const parts = new URL(url.trim()).pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return url;
  } catch {
    return url;
  }
}

const STEP_DELAY_MS = 650;

export async function runMockScan(
  repoUrl: string,
  onPhase: (phase: ScanPhase) => void,
  options?: { forceFail?: boolean }
): Promise<ScanResultPlaceholder | null> {
  const phases: ScanPhase[] = [
    "validating",
    "fetching",
    "unpacking",
    "detecting",
    "scanning",
  ];

  for (const phase of phases) {
    onPhase(phase);
    await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
    if (options?.forceFail && phase === "fetching") {
      onPhase("failed");
      return null;
    }
  }

  onPhase("complete");
  return {
    repoUrl,
    branch: "main",
  };
}
