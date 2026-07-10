const STORAGE_KEY = "repodiet.session.v1";

export interface PersistedSession {
  repoUrl: string;
  branch: string;
  scanId?: string;
  scanComplete: boolean;
  selectedFindingIds: string[];
}

export function loadPersistedSession(): PersistedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

export function savePersistedSession(session: PersistedSession): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearPersistedSession(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
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
