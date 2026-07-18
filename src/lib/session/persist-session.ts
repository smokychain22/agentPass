const STORAGE_KEY = "repodiet.session.v1";

export interface PersistedSession {
  repoUrl: string;
  branch: string;
  /** Pinned repository commit from the findings scan. */
  pinnedCommitSha?: string;
  scanId?: string;
  scanRecordId?: string;
  scanComplete: boolean;
  /** Cleanup selection only — cleanup-eligible SAFE finding IDs. */
  selectedFindingIds: string[];
  /** Alias persisted for clarity; mirrors selectedFindingIds when present. */
  cleanupSelectedFindingIds?: string[];
  /** Human-readable paths for the cleanup selection (for Fix & PR restore). */
  selectedFiles?: string[];
  /** REVIEW FIRST IDs selected for deeper verification — never cleanup. */
  reviewSelectedFindingIds?: string[];
  /** DO NOT TOUCH IDs selected for inspection/reporting only. */
  inspectionSelectedFindingIds?: string[];
  patchKitId?: string;
  cleanupRunId?: string;
  a2aTaskId?: string;
  /** Bound quote for the in-progress Fix & PR delivery. */
  quoteId?: string;
  /** OKX A2A order / escrow binding for Fix & PR. */
  okxOrderId?: string;
  okxAspAgentId?: string;
  okxA2aServiceId?: string;
  a2mcpPaymentId?: string;
  escrowReference?: string;
  acceptanceState?: string;
  disputeState?: string;
  prUrl?: string;
  scopeReviewed?: boolean;
  selectedProjectRoot?: string;
  projectRootConfirmed?: boolean;
}

function readStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function loadPersistedSession(): PersistedSession | null {
  const storage = readStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

export function savePersistedSession(session: PersistedSession): void {
  const storage = readStorage();
  if (!storage) return;
  // Preserve quoteId across partial session writes that omit it.
  const previous = loadPersistedSession();
  const merged: PersistedSession = {
    ...session,
    quoteId: session.quoteId ?? previous?.quoteId,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(merged));
}

export function clearPersistedSession(): void {
  const storage = readStorage();
  if (!storage) return;
  storage.removeItem(STORAGE_KEY);
}

export async function fetchPersistedPatchKit(scanId: string) {
  const res = await fetch(`/api/patches/by-scan/${scanId}`);
  const json = (await res.json()) as {
    success: boolean;
    patchKit?: import("@/lib/patch-kit/types").PatchKitPayload;
    error?: string;
  };
  if (!json.success || !json.patchKit) return null;
  return json.patchKit;
}

export async function fetchPersistedScan(scanId: string) {
  const res = await fetch(`/api/scans/${scanId}`);
  const json = (await res.json()) as {
    success: boolean;
    scan?: import("@/lib/scanner/run-scan").ScanPayload;
    error?: string;
  };
  if (!json.success || !json.scan) return null;
  return json.scan;
}
export async function fetchPersistedFindings(scanId: string) {
  const res = await fetch(`/api/findings/${scanId}`, { credentials: "same-origin" });
  let json: {
    success?: boolean;
    findings?: import("@/lib/findings/types").FindingsPayload;
    error?: string;
    code?: string;
    message?: string;
    requestId?: string;
  };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new Error("Failed to restore findings (invalid JSON response).");
  }
  if (!json.success || !json.findings) {
    throw new Error(json.message ?? json.error ?? "Failed to restore findings.");
  }
  return json.findings;
}
