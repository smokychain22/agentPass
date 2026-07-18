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
import { isCleanupEligible } from "@/lib/findings/cleanup-eligibility";
import {
  flattenFindingsPayload,
  sanitizeSelectedFindingIds,
  sanitizeSelectedFindingIdsFromPayload,
} from "@/lib/findings/selection";
import {
  sanitizeInspectionSelectedFindingIds,
  sanitizeInspectionSelectedFindingIdsFromPayload,
  sanitizeReviewSelectedFindingIds,
  sanitizeReviewSelectedFindingIdsFromPayload,
  selectionPurposeOf,
} from "@/lib/findings/selection-purposes";
import {
  isFindingsBoundToActiveScan,
  isRepositoryConnected,
  type ScanLifecyclePhase,
} from "@/lib/workflow/step-states";

function defaultSafeSelectedIds(payload: FindingsPayload): string[] {
  return flattenFindingsPayload(payload)
    .filter(isCleanupEligible)
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
  scanPhase: ScanLifecyclePhase;
}

interface AppSessionContextValue {
  session: ScanSession;
  findings: FindingsPayload | null;
  patchKit: PatchKitPayload | null;
  a2aTask: WorkflowA2ATask | null;
  /** @deprecated Prefer cleanupSelectedFindingIds — cleanup-eligible SAFE only. */
  selectedFindingIds: string[];
  cleanupSelectedFindingIds: string[];
  reviewSelectedFindingIds: string[];
  inspectionSelectedFindingIds: string[];
  scopeReviewed: boolean;
  hydrating: boolean;
  setScanComplete: (repoUrl: string, branch: string, result: ScanPayload) => void;
  setScanPhase: (phase: ScanLifecyclePhase) => void;
  setSelectedProjectRoot: (projectRoot: string) => void;
  setFindings: (findings: FindingsPayload | null) => void;
  setPatchKit: (patchKit: PatchKitPayload | null) => void;
  setA2aTask: (task: WorkflowA2ATask | null) => void;
  setScopeReviewed: (reviewed: boolean) => void;
  /** Routes to cleanup / review / inspection buckets by finding purpose. */
  toggleFindingSelection: (findingId: string) => void;
  setSelectedFindingIds: (ids: string[]) => void;
  setCleanupSelectedFindingIds: (ids: string[]) => void;
  setReviewSelectedFindingIds: (ids: string[]) => void;
  setInspectionSelectedFindingIds: (ids: string[]) => void;
  selectAllSafeFindings: () => void;
  clearFindingSelection: () => void;
  clearReviewSelection: () => void;
  clearInspectionSelection: () => void;
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
  cleanupSelectedFindingIds: string[],
  patchKit: PatchKitPayload | null,
  a2aTaskId?: string,
  scopeReviewed?: boolean,
  reviewSelectedFindingIds: string[] = [],
  inspectionSelectedFindingIds: string[] = []
) {
  const data: PersistedSession = {
    repoUrl: session.repoUrl,
    branch: session.branch,
    scanId: findings?.scanId ?? session.scanRecordId,
    scanRecordId: session.scanRecordId ?? findings?.scanId,
    scanComplete: session.scanComplete,
    selectedFindingIds: cleanupSelectedFindingIds,
    cleanupSelectedFindingIds,
    reviewSelectedFindingIds,
    inspectionSelectedFindingIds,
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
  const [cleanupSelectedFindingIds, setCleanupSelectedFindingIdsState] = useState<string[]>([]);
  const [reviewSelectedFindingIds, setReviewSelectedFindingIdsState] = useState<string[]>([]);
  const [inspectionSelectedFindingIds, setInspectionSelectedFindingIdsState] = useState<
    string[]
  >([]);
  const [scopeReviewed, setScopeReviewedState] = useState(false);
  const [hydrating, setHydrating] = useState(true);

  /** Backward-compatible alias — cleanup selection only. */
  const selectedFindingIds = cleanupSelectedFindingIds;

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
      scanComplete: false,
      scanRecordId: stored.scanRecordId ?? stored.scanId,
      selectedProjectRoot: stored.selectedProjectRoot,
      projectRootConfirmed: stored.projectRootConfirmed ?? false,
      scanPhase: "idle",
    });
    setCleanupSelectedFindingIdsState([]);
    setReviewSelectedFindingIdsState([]);
    setInspectionSelectedFindingIdsState([]);
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
          setSession(emptySession);
          setFindings(null);
          setPatchKit(null);
          setA2aTaskState(null);
          setCleanupSelectedFindingIdsState([]);
          setReviewSelectedFindingIdsState([]);
          setInspectionSelectedFindingIdsState([]);
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

        const storedCleanup =
          stored.cleanupSelectedFindingIds ?? stored.selectedFindingIds ?? [];
        let cleanupIds: string[] = [];
        let reviewIds: string[] = [];
        let inspectionIds: string[] = [];

        if (findingsBound && findingsPayload) {
          setFindings(findingsPayload);
          cleanupIds = sanitizeSelectedFindingIdsFromPayload(findingsPayload, storedCleanup);
          reviewIds = sanitizeReviewSelectedFindingIdsFromPayload(
            findingsPayload,
            stored.reviewSelectedFindingIds ?? []
          );
          inspectionIds = sanitizeInspectionSelectedFindingIdsFromPayload(
            findingsPayload,
            stored.inspectionSelectedFindingIds ?? []
          );
          setCleanupSelectedFindingIdsState(cleanupIds);
          setReviewSelectedFindingIdsState(reviewIds);
          setInspectionSelectedFindingIdsState(inspectionIds);
          setScopeReviewedState(stored.scopeReviewed ?? false);
          if (patchPayload && patchPayload.scanId === findingsPayload.scanId) {
            setPatchKit(patchPayload);
          }
        } else {
          setFindings(null);
          setPatchKit(null);
          setCleanupSelectedFindingIdsState([]);
          setReviewSelectedFindingIdsState([]);
          setInspectionSelectedFindingIdsState([]);
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
          findingsBound ? cleanupIds : [],
          findingsBound && patchPayload?.scanId === findingsPayload?.scanId ? patchPayload : null,
          task?.taskId,
          findingsBound ? stored.scopeReviewed ?? false : false,
          findingsBound ? reviewIds : [],
          findingsBound ? inspectionIds : []
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
      setCleanupSelectedFindingIdsState([]);
      setReviewSelectedFindingIdsState([]);
      setInspectionSelectedFindingIdsState([]);
      setScopeReviewedState(false);
      setA2aTaskState(null);
      setSession((prev) => {
        const hasAuthenticScan = Boolean(prev.scanResult?.id || prev.scanRecordId);
        const updated = {
          ...prev,
          repoUrl: prev.repoUrl || next.repo.url || `https://github.com/${next.repo.owner}/${next.repo.name}`,
          branch: prev.branch || next.repo.branch,
          scanComplete: hasAuthenticScan ? true : prev.scanComplete,
          scanRecordId: prev.scanRecordId ?? next.scanId,
        };
        persist(updated, next, [], null, undefined, false, [], []);
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
        scanComplete: connected,
        scanRecordId: result.id,
        selectedProjectRoot: result.repositoryModel?.primaryProjectRoot,
        projectRootConfirmed: !needsSelection,
        scanPhase: connected ? "complete" : "failed",
      };
      setSession(nextSession);
      setFindings(null);
      setPatchKit(null);
      setA2aTaskState(null);
      setScopeReviewedState(false);
      setCleanupSelectedFindingIdsState([]);
      setReviewSelectedFindingIdsState([]);
      setInspectionSelectedFindingIdsState([]);
      persist(nextSession, null, [], null, undefined, false, [], []);
    },
    []
  );

  const setScanPhase = useCallback((phase: ScanLifecyclePhase) => {
    setSession((prev) => ({ ...prev, scanPhase: phase }));
  }, []);

  const setSelectedProjectRoot = useCallback(
    (projectRoot: string) => {
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
        persist(
          updated,
          findings,
          cleanupSelectedFindingIds,
          patchKit,
          a2aTask?.taskId,
          scopeReviewed,
          reviewSelectedFindingIds,
          inspectionSelectedFindingIds
        );
        return updated;
      });
      setFindings(null);
      setPatchKit(null);
    },
    [
      findings,
      cleanupSelectedFindingIds,
      reviewSelectedFindingIds,
      inspectionSelectedFindingIds,
      patchKit,
      a2aTask?.taskId,
      scopeReviewed,
    ]
  );

  const setPatchKitState = useCallback(
    (next: PatchKitPayload | null) => {
      setPatchKit(next);
      setSession((prev) => {
        persist(
          prev,
          findings,
          cleanupSelectedFindingIds,
          next,
          a2aTask?.taskId,
          scopeReviewed,
          reviewSelectedFindingIds,
          inspectionSelectedFindingIds
        );
        return prev;
      });
    },
    [
      findings,
      cleanupSelectedFindingIds,
      reviewSelectedFindingIds,
      inspectionSelectedFindingIds,
      a2aTask?.taskId,
      scopeReviewed,
    ]
  );

  const setA2aTask = useCallback(
    (next: WorkflowA2ATask | null) => {
      setA2aTaskState(next);
      setSession((prev) => {
        persist(
          prev,
          findings,
          cleanupSelectedFindingIds,
          patchKit,
          next?.taskId,
          scopeReviewed,
          reviewSelectedFindingIds,
          inspectionSelectedFindingIds
        );
        return prev;
      });
    },
    [
      findings,
      cleanupSelectedFindingIds,
      reviewSelectedFindingIds,
      inspectionSelectedFindingIds,
      patchKit,
      scopeReviewed,
    ]
  );

  const setScopeReviewed = useCallback(
    (reviewed: boolean) => {
      setScopeReviewedState(reviewed);
      setSession((prev) => {
        persist(
          prev,
          findings,
          cleanupSelectedFindingIds,
          patchKit,
          a2aTask?.taskId,
          reviewed,
          reviewSelectedFindingIds,
          inspectionSelectedFindingIds
        );
        return prev;
      });
    },
    [
      findings,
      cleanupSelectedFindingIds,
      reviewSelectedFindingIds,
      inspectionSelectedFindingIds,
      patchKit,
      a2aTask?.taskId,
    ]
  );

  const toggleFindingSelection = useCallback(
    (findingId: string) => {
      if (!findings) return;
      const all = flattenFindingsPayload(findings);
      const target = all.find((f) => f.id === findingId);
      if (!target) return;
      const purpose = selectionPurposeOf(target);

      if (purpose === "cleanup") {
        setCleanupSelectedFindingIdsState((prev) => {
          const next = prev.includes(findingId)
            ? prev.filter((id) => id !== findingId)
            : sanitizeSelectedFindingIds(all, [...prev, findingId]);
          setScopeReviewedState(false);
          persist(
            session,
            findings,
            next,
            patchKit,
            a2aTask?.taskId,
            false,
            reviewSelectedFindingIds,
            inspectionSelectedFindingIds
          );
          return next;
        });
        return;
      }

      if (purpose === "review") {
        setReviewSelectedFindingIdsState((prev) => {
          const next = prev.includes(findingId)
            ? prev.filter((id) => id !== findingId)
            : sanitizeReviewSelectedFindingIds(all, [...prev, findingId]);
          persist(
            session,
            findings,
            cleanupSelectedFindingIds,
            patchKit,
            a2aTask?.taskId,
            scopeReviewed,
            next,
            inspectionSelectedFindingIds
          );
          return next;
        });
        return;
      }

      if (purpose === "inspection") {
        setInspectionSelectedFindingIdsState((prev) => {
          const next = prev.includes(findingId)
            ? prev.filter((id) => id !== findingId)
            : sanitizeInspectionSelectedFindingIds(all, [...prev, findingId]);
          persist(
            session,
            findings,
            cleanupSelectedFindingIds,
            patchKit,
            a2aTask?.taskId,
            scopeReviewed,
            reviewSelectedFindingIds,
            next
          );
          return next;
        });
      }
    },
    [
      session,
      findings,
      patchKit,
      a2aTask?.taskId,
      cleanupSelectedFindingIds,
      reviewSelectedFindingIds,
      inspectionSelectedFindingIds,
      scopeReviewed,
    ]
  );

  const setSelectedFindingIds = useCallback(
    (ids: string[]) => {
      const next = sanitizeSelectedFindingIdsFromPayload(findings, ids);
      setCleanupSelectedFindingIdsState(next);
      setScopeReviewedState(false);
      persist(
        session,
        findings,
        next,
        patchKit,
        a2aTask?.taskId,
        false,
        reviewSelectedFindingIds,
        inspectionSelectedFindingIds
      );
    },
    [
      session,
      findings,
      patchKit,
      a2aTask?.taskId,
      reviewSelectedFindingIds,
      inspectionSelectedFindingIds,
    ]
  );

  const setCleanupSelectedFindingIds = setSelectedFindingIds;

  const setReviewSelectedFindingIds = useCallback(
    (ids: string[]) => {
      const next = sanitizeReviewSelectedFindingIdsFromPayload(findings, ids);
      setReviewSelectedFindingIdsState(next);
      persist(
        session,
        findings,
        cleanupSelectedFindingIds,
        patchKit,
        a2aTask?.taskId,
        scopeReviewed,
        next,
        inspectionSelectedFindingIds
      );
    },
    [
      session,
      findings,
      patchKit,
      a2aTask?.taskId,
      cleanupSelectedFindingIds,
      inspectionSelectedFindingIds,
      scopeReviewed,
    ]
  );

  const setInspectionSelectedFindingIds = useCallback(
    (ids: string[]) => {
      const next = sanitizeInspectionSelectedFindingIdsFromPayload(findings, ids);
      setInspectionSelectedFindingIdsState(next);
      persist(
        session,
        findings,
        cleanupSelectedFindingIds,
        patchKit,
        a2aTask?.taskId,
        scopeReviewed,
        reviewSelectedFindingIds,
        next
      );
    },
    [
      session,
      findings,
      patchKit,
      a2aTask?.taskId,
      cleanupSelectedFindingIds,
      reviewSelectedFindingIds,
      scopeReviewed,
    ]
  );

  const selectAllSafeFindings = useCallback(() => {
    if (!findings) return;
    const ids = defaultSafeSelectedIds(findings);
    setCleanupSelectedFindingIdsState(ids);
    setScopeReviewedState(false);
    persist(
      session,
      findings,
      ids,
      patchKit,
      a2aTask?.taskId,
      false,
      reviewSelectedFindingIds,
      inspectionSelectedFindingIds
    );
  }, [
    findings,
    session,
    patchKit,
    a2aTask?.taskId,
    reviewSelectedFindingIds,
    inspectionSelectedFindingIds,
  ]);

  const clearFindingSelection = useCallback(() => {
    setCleanupSelectedFindingIdsState([]);
    setScopeReviewedState(false);
    persist(
      session,
      findings,
      [],
      patchKit,
      a2aTask?.taskId,
      false,
      reviewSelectedFindingIds,
      inspectionSelectedFindingIds
    );
  }, [
    a2aTask?.taskId,
    findings,
    patchKit,
    session,
    reviewSelectedFindingIds,
    inspectionSelectedFindingIds,
  ]);

  const clearReviewSelection = useCallback(() => {
    setReviewSelectedFindingIdsState([]);
    persist(
      session,
      findings,
      cleanupSelectedFindingIds,
      patchKit,
      a2aTask?.taskId,
      scopeReviewed,
      [],
      inspectionSelectedFindingIds
    );
  }, [
    session,
    findings,
    cleanupSelectedFindingIds,
    patchKit,
    a2aTask?.taskId,
    scopeReviewed,
    inspectionSelectedFindingIds,
  ]);

  const clearInspectionSelection = useCallback(() => {
    setInspectionSelectedFindingIdsState([]);
    persist(
      session,
      findings,
      cleanupSelectedFindingIds,
      patchKit,
      a2aTask?.taskId,
      scopeReviewed,
      reviewSelectedFindingIds,
      []
    );
  }, [
    session,
    findings,
    cleanupSelectedFindingIds,
    patchKit,
    a2aTask?.taskId,
    scopeReviewed,
    reviewSelectedFindingIds,
  ]);

  // Drop stale / cross-purpose IDs after findings changes.
  useEffect(() => {
    if (!findings) return;
    setCleanupSelectedFindingIdsState((prev) => {
      const next = sanitizeSelectedFindingIdsFromPayload(findings, prev);
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev;
      persist(
        session,
        findings,
        next,
        patchKit,
        a2aTask?.taskId,
        scopeReviewed,
        reviewSelectedFindingIds,
        inspectionSelectedFindingIds
      );
      return next;
    });
    setReviewSelectedFindingIdsState((prev) => {
      const next = sanitizeReviewSelectedFindingIdsFromPayload(findings, prev);
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev;
      return next;
    });
    setInspectionSelectedFindingIdsState((prev) => {
      const next = sanitizeInspectionSelectedFindingIdsFromPayload(findings, prev);
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev;
      return next;
    });
  }, [
    findings,
    session,
    patchKit,
    a2aTask?.taskId,
    scopeReviewed,
    reviewSelectedFindingIds,
    inspectionSelectedFindingIds,
  ]);

  const resetSession = useCallback(() => {
    setSession(emptySession);
    setFindings(null);
    setPatchKit(null);
    setA2aTaskState(null);
    setScopeReviewedState(false);
    setCleanupSelectedFindingIdsState([]);
    setReviewSelectedFindingIdsState([]);
    setInspectionSelectedFindingIdsState([]);
    clearPersistedSession();
  }, []);

  const value = useMemo(
    () => ({
      session,
      findings,
      patchKit,
      a2aTask,
      selectedFindingIds,
      cleanupSelectedFindingIds,
      reviewSelectedFindingIds,
      inspectionSelectedFindingIds,
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
      setCleanupSelectedFindingIds,
      setReviewSelectedFindingIds,
      setInspectionSelectedFindingIds,
      selectAllSafeFindings,
      clearFindingSelection,
      clearReviewSelection,
      clearInspectionSelection,
      resetSession,
    }),
    [
      session,
      findings,
      patchKit,
      a2aTask,
      selectedFindingIds,
      cleanupSelectedFindingIds,
      reviewSelectedFindingIds,
      inspectionSelectedFindingIds,
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
      setCleanupSelectedFindingIds,
      setReviewSelectedFindingIds,
      setInspectionSelectedFindingIds,
      selectAllSafeFindings,
      clearFindingSelection,
      clearReviewSelection,
      clearInspectionSelection,
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
