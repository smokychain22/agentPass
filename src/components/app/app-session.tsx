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
import type { WorkflowA2ATask } from "@/lib/workflow/client";
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
import {
  isFindingsBoundToActiveScan,
  isRepositoryConnected,
  type ScanLifecyclePhase,
} from "@/lib/workflow/step-states";

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

function defaultSafeSelectedIds(payload: FindingsPayload): string[] {
  return defaultSelectedFindingIds(payload);
}

export interface ScanSession {
  repoUrl: string;
  branch: string;
  scanResult: ScanPayload | null;
  scanComplete: boolean;
  scanRecordId?: string;
  selectedProjectRoot?: string;
  projectRootConfirmed: boolean;
  scanPhase: ScanLifecyclePhase;
}

interface AppSessionContextValue {
  session: ScanSession;
  findings: FindingsPayload | null;
  patchKit: PatchKitPayload | null;
  a2aTask: WorkflowA2ATask | null;
  selectedFindingIds: string[];
  scopeReviewed: boolean;
  hydrating: boolean;
  setScanComplete: (repoUrl: string, branch: string, result: ScanPayload) => void;
  setScanPhase: (phase: ScanLifecyclePhase) => void;
  setSelectedProjectRoot: (projectRoot: string) => void;
  setFindings: (findings: FindingsPayload | null) => void;
  setPatchKit: (patchKit: PatchKitPayload | null) => void;
  setA2aTask: (task: WorkflowA2ATask | null) => void;
  setScopeReviewed: (reviewed: boolean) => void;
  toggleFindingSelection: (findingId: string) => void;
  setSelectedFindingIds: (ids: string[]) => void;
  selectAllSafeFindings: () => void;
  clearFindingSelection: () => void;
  resetSession: () => void;
}

const emptySession: ScanSession = {
  repoUrl: "",
  branch: "",
  scanResult: null,
  scanComplete: false,
  projectRootConfirmed: false,
  scanPhase: "idle",
};

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

function persist(
  session: ScanSession,
  findings: FindingsPayload | null,
  selectedFindingIds: string[],
  patchKit: PatchKitPayload | null,
  a2aTaskId?: string,
  scopeReviewed?: boolean
) {
  const data: PersistedSession = {
    repoUrl: session.repoUrl,
    branch: session.branch,
    scanId: findings?.scanId ?? session.scanRecordId,
    scanRecordId: session.scanRecordId ?? findings?.scanId,
    scanComplete: session.scanComplete,
    selectedFindingIds,
    patchKitId: patchKit?.id,
    a2aTaskId,
    scopeReviewed,
    selectedProjectRoot: session.selectedProjectRoot,
    projectRootConfirmed: session.projectRootConfirmed,
  };
  savePersistedSession(data);
}

export function AppSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ScanSession>(emptySession);
  const [findings, setFindings] = useState<FindingsPayload | null>(null);
  const [patchKit, setPatchKit] = useState<PatchKitPayload | null>(null);
  const [a2aTask, setA2aTaskState] = useState<WorkflowA2ATask | null>(null);
  const [selectedFindingIds, setSelectedFindingIdsState] = useState<string[]>([]);
  const [scopeReviewed, setScopeReviewedState] = useState(false);
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
      // Wait for a validated scan payload before claiming complete in the UI.
      scanComplete: false,
      scanRecordId: stored.scanRecordId ?? stored.scanId,
      selectedProjectRoot: stored.selectedProjectRoot,
      projectRootConfirmed: stored.projectRootConfirmed ?? false,
      scanPhase: "idle",
    });
    setSelectedFindingIdsState([]);
    setScopeReviewedState(false);

    void Promise.all([
      fetchPersistedFindings(scanKey).catch(() => null),
      stored.scanRecordId ? fetchPersistedScan(stored.scanRecordId) : fetchPersistedScan(scanKey),
      fetchPersistedPatchKit(scanKey),
      stored.a2aTaskId
        ? import("@/lib/workflow/client").then((m) => m.fetchWorkflowA2ATask(stored.a2aTaskId!)).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([findingsPayload, scanPayload, patchPayload, taskPayload]) => {
        const connected =
          Boolean(scanPayload) &&
          isRepositoryConnected({
            scanResult: scanPayload,
            scanComplete: true,
            scanRecordId: scanPayload?.id,
          });

        if (!connected) {
          // Incomplete or inconsistent persisted scan — return to empty truthful state.
          setSession(emptySession);
          setFindings(null);
          setPatchKit(null);
          setA2aTaskState(null);
          setSelectedFindingIdsState([]);
          setScopeReviewedState(false);
          clearPersistedSession();
          return;
        }

        const needsSelection = scanPayload!.repositoryModel?.needsProjectRootSelection ?? false;
        const restoredSession: ScanSession = {
          repoUrl: stored.repoUrl || `https://github.com/${scanPayload!.repo.owner}/${scanPayload!.repo.name}`,
          branch: stored.branch || scanPayload!.repo.branch || "",
          scanResult: scanPayload!,
          scanComplete: true,
          scanRecordId: scanPayload!.id,
          selectedProjectRoot:
            stored.selectedProjectRoot ?? scanPayload!.repositoryModel?.primaryProjectRoot,
          projectRootConfirmed:
            stored.projectRootConfirmed ??
            (!needsSelection || Boolean(stored.selectedProjectRoot)),
          scanPhase: "complete",
        };
        setSession(restoredSession);

        const findingsBound = isFindingsBoundToActiveScan({
          scanResult: scanPayload!,
          scanComplete: true,
          scanRecordId: scanPayload!.id,
          findings: findingsPayload,
        });

        if (findingsBound && findingsPayload) {
          setFindings(findingsPayload);
          // Restore only an explicit saved selection — never invent a bulk selection.
          setSelectedFindingIdsState(stored.selectedFindingIds ?? []);
          setScopeReviewedState(stored.scopeReviewed ?? false);
          if (patchPayload && patchPayload.scanId === findingsPayload.scanId) {
            setPatchKit(patchPayload);
          }
        } else {
          setFindings(null);
          setPatchKit(null);
          setSelectedFindingIdsState([]);
          setScopeReviewedState(false);
        }

        const task = taskPayload?.task ?? null;
        if (
          task &&
          task.repository.owner?.toLowerCase() === scanPayload!.repo.owner.toLowerCase() &&
          task.repository.name?.toLowerCase() === scanPayload!.repo.name.toLowerCase() &&
          (!task.repository.commitSha ||
            !scanPayload!.repo.commitSha ||
            task.repository.commitSha === scanPayload!.repo.commitSha)
        ) {
          setA2aTaskState(task);
        } else {
          setA2aTaskState(null);
        }

        persist(
          restoredSession,
          findingsBound ? findingsPayload : null,
          findingsBound ? stored.selectedFindingIds ?? [] : [],
          findingsBound && patchPayload?.scanId === findingsPayload?.scanId ? patchPayload : null,
          task?.taskId,
          findingsBound ? stored.scopeReviewed ?? false : false
        );
      })
      .catch(() => {
        clearPersistedSession();
        setSession(emptySession);
        setFindings(null);
        setPatchKit(null);
        setA2aTaskState(null);
      })
      .finally(() => setHydrating(false));
  }, []);

  const setFindingsState = useCallback((next: FindingsPayload | null) => {
    setFindings(next);
    if (next) {
      // Do not auto-check dozens of safe findings — user selects scope intentionally.
      setSelectedFindingIdsState([]);
      setScopeReviewedState(false);
      setA2aTaskState(null);
      setSession((prev) => {
        const hasAuthenticScan = Boolean(prev.scanResult?.id || prev.scanRecordId);
        const updated = {
          ...prev,
          repoUrl: prev.repoUrl || next.repo.url || `https://github.com/${next.repo.owner}/${next.repo.name}`,
          branch: prev.branch || next.repo.branch,
          // Findings prove analysis, not a structure scan — keep scanComplete only if scan is attested.
          scanComplete: hasAuthenticScan ? true : prev.scanComplete,
          scanRecordId: prev.scanRecordId ?? next.scanId,
        };
        persist(updated, next, [], null, undefined, false);
        return updated;
      });
      setPatchKit(null);
    }
  }, []);

  const setScanComplete = useCallback(
    (repoUrl: string, branch: string, result: ScanPayload) => {
      const needsSelection = result.repositoryModel?.needsProjectRootSelection ?? false;
      const connected = isRepositoryConnected({
        scanResult: result,
        scanComplete: true,
        scanRecordId: result.id,
      });
      const nextSession: ScanSession = {
        repoUrl,
        branch: branch || result.repo.branch || "",
        scanResult: result,
        // Only mark complete when the scan pinned a real commit SHA and identity.
        scanComplete: connected,
        scanRecordId: result.id,
        selectedProjectRoot: result.repositoryModel?.primaryProjectRoot,
        projectRootConfirmed: !needsSelection,
        scanPhase: connected ? "complete" : "failed",
      };
      // New repository scan invalidates prior findings/task/scope for the active session.
      setSession(nextSession);
      setFindings(null);
      setPatchKit(null);
      setA2aTaskState(null);
      setScopeReviewedState(false);
      setSelectedFindingIdsState([]);
      persist(nextSession, null, [], null, undefined, false);
    },
    []
  );

  const setScanPhase = useCallback((phase: ScanLifecyclePhase) => {
    setSession((prev) => ({ ...prev, scanPhase: phase }));
  }, []);

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
      persist(updated, findings, selectedFindingIds, patchKit, a2aTask?.taskId, scopeReviewed);
      return updated;
    });
    setFindings(null);
    setPatchKit(null);
  }, [findings, selectedFindingIds, patchKit, a2aTask?.taskId, scopeReviewed]);

  const setPatchKitState = useCallback(
    (next: PatchKitPayload | null) => {
      setPatchKit(next);
      setSession((prev) => {
        persist(prev, findings, selectedFindingIds, next, a2aTask?.taskId, scopeReviewed);
        return prev;
      });
    },
    [findings, selectedFindingIds, a2aTask?.taskId, scopeReviewed]
  );

  const setA2aTask = useCallback(
    (next: WorkflowA2ATask | null) => {
      setA2aTaskState(next);
      setSession((prev) => {
        persist(prev, findings, selectedFindingIds, patchKit, next?.taskId, scopeReviewed);
        return prev;
      });
    },
    [findings, selectedFindingIds, patchKit, scopeReviewed]
  );

  const setScopeReviewed = useCallback(
    (reviewed: boolean) => {
      setScopeReviewedState(reviewed);
      setSession((prev) => {
        persist(prev, findings, selectedFindingIds, patchKit, a2aTask?.taskId, reviewed);
        return prev;
      });
    },
    [findings, selectedFindingIds, patchKit, a2aTask?.taskId]
  );

  const toggleFindingSelection = useCallback(
    (findingId: string) => {
      setSelectedFindingIdsState((prev) => {
        const next = prev.includes(findingId)
          ? prev.filter((id) => id !== findingId)
          : [...prev, findingId];
        setScopeReviewedState(false);
        persist(session, findings, next, patchKit, a2aTask?.taskId, false);
        return next;
      });
    },
    [session, findings, patchKit, a2aTask?.taskId]
  );

  const setSelectedFindingIds = useCallback(
    (ids: string[]) => {
      setSelectedFindingIdsState(ids);
      setScopeReviewedState(false);
      persist(session, findings, ids, patchKit, a2aTask?.taskId, false);
    },
    [session, findings, patchKit, a2aTask?.taskId]
  );

  const selectAllSafeFindings = useCallback(() => {
    if (!findings) return;
    const ids = defaultSafeSelectedIds(findings);
    setSelectedFindingIdsState(ids);
    setScopeReviewedState(false);
    persist(session, findings, ids, patchKit, a2aTask?.taskId, false);
  }, [findings, session, patchKit, a2aTask?.taskId]);

  const clearFindingSelection = useCallback(() => {
    setSelectedFindingIdsState([]);
    setScopeReviewedState(false);
    persist(session, findings, [], patchKit, a2aTask?.taskId, false);
  }, [a2aTask?.taskId, findings, patchKit, session]);

  const resetSession = useCallback(() => {
    setSession(emptySession);
    setFindings(null);
    setPatchKit(null);
    setA2aTaskState(null);
    setScopeReviewedState(false);
    setSelectedFindingIdsState([]);
    clearPersistedSession();
  }, []);

  const value = useMemo(
    () => ({
      session,
      findings,
      patchKit,
      a2aTask,
      selectedFindingIds,
      scopeReviewed,
      hydrating,
      setScanComplete,
      setScanPhase,
      setSelectedProjectRoot,
      setFindings: setFindingsState,
      setPatchKit: setPatchKitState,
      setA2aTask,
      setScopeReviewed,
      toggleFindingSelection,
      setSelectedFindingIds,
      selectAllSafeFindings,
      clearFindingSelection,
      resetSession,
    }),
    [
      session,
      findings,
      patchKit,
      a2aTask,
      selectedFindingIds,
      scopeReviewed,
      hydrating,
      setScanComplete,
      setScanPhase,
      setSelectedProjectRoot,
      setFindingsState,
      setPatchKitState,
      setA2aTask,
      setScopeReviewed,
      toggleFindingSelection,
      setSelectedFindingIds,
      selectAllSafeFindings,
      clearFindingSelection,
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
