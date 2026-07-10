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
  fetchPersistedPatchKit,
  fetchPersistedScan,
  loadPersistedSession,
  savePersistedSession,
  type PersistedSession,
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
  scanRecordId?: string;
  selectedProjectRoot?: string;
  projectRootConfirmed: boolean;
}

interface AppSessionContextValue {
  session: ScanSession;
  findings: FindingsPayload | null;
  patchKit: PatchKitPayload | null;
  selectedFindingIds: string[];
  hydrating: boolean;
  setScanComplete: (repoUrl: string, branch: string, result: ScanPayload) => void;
  setSelectedProjectRoot: (projectRoot: string) => void;
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
  projectRootConfirmed: false,
};

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

function persist(
  session: ScanSession,
  findings: FindingsPayload | null,
  selectedFindingIds: string[],
  patchKit: PatchKitPayload | null
) {
  const data: PersistedSession = {
    repoUrl: session.repoUrl,
    branch: session.branch,
    scanId: findings?.scanId ?? session.scanRecordId,
    scanRecordId: session.scanRecordId ?? findings?.scanId,
    scanComplete: session.scanComplete,
    selectedFindingIds,
    patchKitId: patchKit?.id,
    selectedProjectRoot: session.selectedProjectRoot,
    projectRootConfirmed: session.projectRootConfirmed,
  };
  savePersistedSession(data);
}

export function AppSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ScanSession>(emptySession);
  const [findings, setFindings] = useState<FindingsPayload | null>(null);
  const [patchKit, setPatchKit] = useState<PatchKitPayload | null>(null);
  const [selectedFindingIds, setSelectedFindingIdsState] = useState<string[]>([]);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    const stored = loadPersistedSession();
    if (!stored?.scanId && !stored?.scanRecordId) {
      setHydrating(false);
      return;
    }

    const scanKey = stored.scanId ?? stored.scanRecordId!;

    setSession({
      repoUrl: stored.repoUrl,
      branch: stored.branch,
      scanResult: null,
      scanComplete: stored.scanComplete,
      scanRecordId: stored.scanRecordId ?? stored.scanId,
      selectedProjectRoot: stored.selectedProjectRoot,
      projectRootConfirmed: stored.projectRootConfirmed ?? true,
    });
    setSelectedFindingIdsState(stored.selectedFindingIds ?? []);

    void Promise.all([
      fetchPersistedFindings(scanKey).catch(() => null),
      stored.scanRecordId ? fetchPersistedScan(stored.scanRecordId) : fetchPersistedScan(scanKey),
      fetchPersistedPatchKit(scanKey),
    ])
      .then(([findingsPayload, scanPayload, patchPayload]) => {
        if (findingsPayload) {
          setFindings(findingsPayload);
          if (!stored.selectedFindingIds?.length) {
            setSelectedFindingIdsState(defaultSelectedFindingIds(findingsPayload));
          }
        }
        if (scanPayload) {
          const needsSelection = scanPayload.repositoryModel?.needsProjectRootSelection ?? false;
          setSession((prev) => ({
            ...prev,
            scanResult: scanPayload,
            scanComplete: true,
            scanRecordId: scanPayload.id,
            selectedProjectRoot:
              stored.selectedProjectRoot ??
              scanPayload.repositoryModel?.primaryProjectRoot,
            projectRootConfirmed:
              stored.projectRootConfirmed ??
              (!needsSelection || Boolean(stored.selectedProjectRoot)),
          }));
        }
        if (patchPayload) setPatchKit(patchPayload);
      })
      .catch(() => clearPersistedSession())
      .finally(() => setHydrating(false));
  }, []);

  const setFindingsState = useCallback((next: FindingsPayload | null) => {
    setFindings(next);
    if (next) {
      const defaults = defaultSelectedFindingIds(next);
      setSelectedFindingIdsState(defaults);
      setSession((prev) => {
        const updated = {
          ...prev,
          repoUrl: prev.repoUrl || next.repo.url || `https://github.com/${next.repo.owner}/${next.repo.name}`,
          branch: prev.branch || next.repo.branch,
          scanComplete: true,
          scanRecordId: prev.scanRecordId ?? next.scanId,
        };
        persist(updated, next, defaults, null);
        return updated;
      });
      setPatchKit(null);
    }
  }, []);

  const setScanComplete = useCallback(
    (repoUrl: string, branch: string, result: ScanPayload) => {
      const needsSelection = result.repositoryModel?.needsProjectRootSelection ?? false;
      const nextSession = {
        repoUrl,
        branch,
        scanResult: result,
        scanComplete: true,
        scanRecordId: result.id,
        selectedProjectRoot: result.repositoryModel?.primaryProjectRoot,
        projectRootConfirmed: !needsSelection,
      };
      setSession(nextSession);
      setFindings(null);
      setPatchKit(null);
      setSelectedFindingIdsState([]);
      persist(nextSession, null, [], null);
    },
    []
  );

  const setSelectedProjectRoot = useCallback((projectRoot: string) => {
    setSession((prev) => {
      const updated = {
        ...prev,
        selectedProjectRoot: projectRoot,
        projectRootConfirmed: true,
        scanResult: prev.scanResult
          ? {
              ...prev.scanResult,
              repositoryModel: prev.scanResult.repositoryModel
                ? {
                    ...prev.scanResult.repositoryModel,
                    primaryProjectRoot: projectRoot,
                  }
                : prev.scanResult.repositoryModel,
            }
          : prev.scanResult,
      };
      persist(updated, findings, selectedFindingIds, patchKit);
      return updated;
    });
    setFindings(null);
    setPatchKit(null);
  }, [findings, selectedFindingIds, patchKit]);

  const setPatchKitState = useCallback(
    (next: PatchKitPayload | null) => {
      setPatchKit(next);
      setSession((prev) => {
        persist(prev, findings, selectedFindingIds, next);
        return prev;
      });
    },
    [findings, selectedFindingIds]
  );

  const toggleFindingSelection = useCallback(
    (findingId: string) => {
      setSelectedFindingIdsState((prev) => {
        const next = prev.includes(findingId)
          ? prev.filter((id) => id !== findingId)
          : [...prev, findingId];
        persist(session, findings, next, patchKit);
        return next;
      });
    },
    [session, findings, patchKit]
  );

  const setSelectedFindingIds = useCallback(
    (ids: string[]) => {
      setSelectedFindingIdsState(ids);
      persist(session, findings, ids, patchKit);
    },
    [session, findings, patchKit]
  );

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
      setSelectedProjectRoot,
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
      setSelectedProjectRoot,
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
