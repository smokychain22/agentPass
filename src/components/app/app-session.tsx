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
  setSelectedProjectRoot: (projectRoot: string) => void;
  setFindings: (findings: FindingsPayload | null) => void;
  setPatchKit: (patchKit: PatchKitPayload | null) => void;
  setA2aTask: (task: WorkflowA2ATask | null) => void;
  setScopeReviewed: (reviewed: boolean) => void;
  toggleFindingSelection: (findingId: string) => void;
  setSelectedFindingIds: (ids: string[]) => void;
  selectAllSafeFindings: () => void;
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
      scanComplete: stored.scanComplete,
      scanRecordId: stored.scanRecordId ?? stored.scanId,
      selectedProjectRoot: stored.selectedProjectRoot,
      projectRootConfirmed: stored.projectRootConfirmed ?? true,
    });
    setSelectedFindingIdsState(stored.selectedFindingIds ?? []);
    setScopeReviewedState(stored.scopeReviewed ?? false);

    void Promise.all([
      fetchPersistedFindings(scanKey).catch(() => null),
      stored.scanRecordId ? fetchPersistedScan(stored.scanRecordId) : fetchPersistedScan(scanKey),
      fetchPersistedPatchKit(scanKey),
      stored.a2aTaskId
        ? import("@/lib/workflow/client").then((m) => m.fetchWorkflowA2ATask(stored.a2aTaskId!)).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([findingsPayload, scanPayload, patchPayload, taskPayload]) => {
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
        if (taskPayload?.task) setA2aTaskState(taskPayload.task);
      })
      .catch(() => clearPersistedSession())
      .finally(() => setHydrating(false));
  }, []);

  const setFindingsState = useCallback((next: FindingsPayload | null) => {
    setFindings(next);
    if (next) {
      const defaults = defaultSafeSelectedIds(next);
      setSelectedFindingIdsState(defaults);
      setScopeReviewedState(false);
      setA2aTaskState(null);
      setSession((prev) => {
        const updated = {
          ...prev,
          repoUrl: prev.repoUrl || next.repo.url || `https://github.com/${next.repo.owner}/${next.repo.name}`,
          branch: prev.branch || next.repo.branch,
          scanComplete: true,
          scanRecordId: prev.scanRecordId ?? next.scanId,
        };
        persist(updated, next, defaults, null, undefined, false);
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
      setA2aTaskState(null);
      setScopeReviewedState(false);
      setSelectedFindingIdsState([]);
      persist(nextSession, null, [], null, undefined, false);
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
      setSelectedProjectRoot,
      setFindings: setFindingsState,
      setPatchKit: setPatchKitState,
      setA2aTask,
      setScopeReviewed,
      toggleFindingSelection,
      setSelectedFindingIds,
      selectAllSafeFindings,
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
      setSelectedProjectRoot,
      setFindingsState,
      setPatchKitState,
      setA2aTask,
      setScopeReviewed,
      toggleFindingSelection,
      setSelectedFindingIds,
      selectAllSafeFindings,
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
