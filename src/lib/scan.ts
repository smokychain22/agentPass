import type { ScanPhase, ScanResult } from "@/lib/scanner/types";

export type { ScanPhase, ScanResult };

export const SCAN_STEPS: { phase: ScanPhase; label: string }[] = [
  { phase: "validating", label: "Validating URL" },
  { phase: "fetching", label: "Fetching repository" },
  { phase: "unpacking", label: "Unpacking ZIP" },
  { phase: "detecting", label: "Detecting framework" },
  { phase: "scanning", label: "Scanning file tree" },
  { phase: "complete", label: "Complete" },
];

/** Small public Next.js example repo for demo scans */
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

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function createScan(url: string, branch?: string): Promise<string> {
  const res = await fetch("/api/scans/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, branch: branch || undefined }),
  });
  const json = (await res.json()) as ApiResponse<{ id: string }>;
  if (!json.ok || !json.data?.id) {
    throw new Error(json.error ?? "Failed to create scan.");
  }
  return json.data.id;
}

export async function runScanById(id: string): Promise<ScanResult> {
  const res = await fetch("/api/scans/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const json = (await res.json()) as ApiResponse<{ result: ScanResult }>;
  if (!json.ok || !json.data?.result) {
    throw new Error(json.error ?? "Scan failed.");
  }
  return json.data.result;
}

export async function runFullScan(
  url: string,
  branch: string | undefined,
  onPhase: (phase: ScanPhase) => void
): Promise<ScanResult> {
  onPhase("validating");
  const id = await createScan(url, branch);

  let polling = true;
  const poller = (async () => {
    while (polling) {
      try {
        const res = await fetch(`/api/scans/${id}`);
        const json = (await res.json()) as ApiResponse<{ status: ScanPhase }>;
        if (json.ok && json.data?.status && json.data.status !== "pending") {
          onPhase(json.data.status);
          if (json.data.status === "complete" || json.data.status === "failed") break;
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  })();

  try {
    const result = await runScanById(id);
    onPhase("complete");
    return result;
  } catch (err) {
    onPhase("failed");
    throw err;
  } finally {
    polling = false;
    await poller;
  }
}
