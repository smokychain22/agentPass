const STORAGE_KEY = "repodiet.session.v1";

export interface PersistedSession {
  repoUrl: string;
  branch: string;
  scanId?: string;
  scanRecordId?: string;
  scanComplete: boolean;
  selectedFindingIds: string[];
  patchKitId?: string;
  cleanupRunId?: string;
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
  storage.setItem(STORAGE_KEY, JSON.stringify(session));
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
  const res = await fetch(`/api/findings/${scanId}`);
  const json = (await res.json()) as {
    success: boolean;
    findings?: import("@/lib/findings/types").FindingsPayload;
    error?: string;
  };
  if (!json.success || !json.findings) {
    throw new Error(json.error ?? "Failed to restore findings.");
  }
  return json.findings;
}
