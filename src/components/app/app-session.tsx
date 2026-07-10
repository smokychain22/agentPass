"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ScanPayload } from "@/lib/scanner/run-scan";
import type { FindingsPayload } from "@/lib/findings/types";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import {
  clearPersistedSession,
  fetchPersistedFindings,
  loadPersistedSession,
  savePersistedSession,
} from "@/lib/session/persist-session";
import { isActionableFinding } from "@/lib/findings/actionability-signals";

function defaultSelectedFindingIds(payload: FindingsPayload): string[] {
  return [
    ...payload.duplicates,
    ...payload.unused.files,
    ...payload.unused.dependencies,
    ...payload.unused.exports,
    ...payload.orphans,
    ...payload.slopSignals,
  ]
    .filter(isActionableFinding)
    .map((f) => f.id);
}

export interface ScanSession {
  repoUrl: string;
  branch: string;
  scanResult: ScanPayload | null;
  scanComplete: boolean;
}

interface AppSessionContextValue {
  session: ScanSession;
  findings: FindingsPayload | null;
  patchKit: PatchKitPayload | null;
  selectedFindingIds: string[];
  hydrating: boolean;
  setScanComplete: (repoUrl: string, branch: string, result: ScanPayload) => void;
  setFindings: (findings: FindingsPayload | null) => void;
  setPatchKit: (patchKit: PatchKitPayload | null) => void;
  toggleFindingSelection: (findingId: string) => void;
  setSelectedFindingIds: (ids: string[]) => void;
  resetSession: () => void;
}

const emptySession: ScanSession = {
  repoUrl: "",
  branch: "",
  scanResult: null,
  scanComplete: false,
};

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

function persist(
  session: ScanSession,
  findings: FindingsPayload | null,
  selectedFindingIds: string[]
) {
  savePersistedSession({
    repoUrl: session.repoUrl,
    branch: session.branch,
    scanId: findings?.scanId,
    scanComplete: session.scanComplete,
    selectedFindingIds,
  });
}

export function AppSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ScanSession>(emptySession);
  const [findings, setFindings] = useState<FindingsPayload | null>(null);
  const [patchKit, setPatchKit] = useState<PatchKitPayload | null>(null);
  const [selectedFindingIds, setSelectedFindingIdsState] = useState<string[]>([]);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    const stored = loadPersistedSession();
    if (!stored?.scanId) {
      setHydrating(false);
      return;
    }

    setSession({
      repoUrl: stored.repoUrl,
      branch: stored.branch,
      scanResult: null,
      scanComplete: stored.scanComplete,
    });
    setSelectedFindingIdsState(stored.selectedFindingIds ?? []);

    void fetchPersistedFindings(stored.scanId)
      .then((payload) => {
        setFindings(payload);
        if (!stored.selectedFindingIds?.length) {
          setSelectedFindingIdsState(defaultSelectedFindingIds(payload));
        }
      })
      .catch(() => {
        clearPersistedSession();
      })
      .finally(() => setHydrating(false));
  }, []);

  const setFindingsState = useCallback((next: FindingsPayload | null) => {
    setFindings(next);
    setPatchKit(null);
    if (next) {
      const defaults = defaultSelectedFindingIds(next);
      setSelectedFindingIdsState(defaults);
      setSession((prev) => {
        const updated = {
          ...prev,
          repoUrl: prev.repoUrl || next.repo.url || `https://github.com/${next.repo.owner}/${next.repo.name}`,
          branch: prev.branch || next.repo.branch,
          scanComplete: true,
        };
        persist(updated, next, defaults);
        return updated;
      });
    }
  }, []);

  const setScanComplete = useCallback(
    (repoUrl: string, branch: string, result: ScanPayload) => {
      const nextSession = {
        repoUrl,
        branch,
        scanResult: result,
        scanComplete: true,
      };
      setSession(nextSession);
      setFindings(null);
      setPatchKit(null);
      setSelectedFindingIdsState([]);
      persist(nextSession, null, []);
    },
    []
  );

  const setPatchKitState = useCallback(
    (next: PatchKitPayload | null) => {
      setPatchKit(next);
    },
    []
  );

  const toggleFindingSelection = useCallback((findingId: string) => {
    setSelectedFindingIdsState((prev) => {
      const next = prev.includes(findingId)
        ? prev.filter((id) => id !== findingId)
        : [...prev, findingId];
      persist(session, findings, next);
      return next;
    });
  }, [session, findings]);

  const setSelectedFindingIds = useCallback((ids: string[]) => {
    setSelectedFindingIdsState(ids);
    persist(session, findings, ids);
  }, [session, findings]);

  const resetSession = useCallback(() => {
    setSession(emptySession);
    setFindings(null);
    setPatchKit(null);
    setSelectedFindingIdsState([]);
    clearPersistedSession();
  }, []);

  const value = useMemo(
    () => ({
      session,
      findings,
      patchKit,
      selectedFindingIds,
      hydrating,
      setScanComplete,
      setFindings: setFindingsState,
      setPatchKit: setPatchKitState,
      toggleFindingSelection,
      setSelectedFindingIds,
      resetSession,
    }),
    [
      session,
      findings,
      patchKit,
      selectedFindingIds,
      hydrating,
      setScanComplete,
      setFindingsState,
      setPatchKitState,
      toggleFindingSelection,
      setSelectedFindingIds,
      resetSession,
    ]
  );

  return (
    <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>
  );
}

export function useAppSession() {
  const ctx = useContext(AppSessionContext);
  if (!ctx) {
    throw new Error("useAppSession must be used within AppSessionProvider");
  }
  return ctx;
}
