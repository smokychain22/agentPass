"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ScanPayload } from "@/lib/scanner/run-scan";
import type { FindingsPayload } from "@/lib/findings/types";
import type { PatchKitPayload } from "@/lib/patch-kit/types";

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
  setScanComplete: (repoUrl: string, branch: string, result: ScanPayload) => void;
  setFindings: (findings: FindingsPayload | null) => void;
  setPatchKit: (patchKit: PatchKitPayload | null) => void;
  resetSession: () => void;
}

const emptySession: ScanSession = {
  repoUrl: "",
  branch: "",
  scanResult: null,
  scanComplete: false,
};

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

export function AppSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ScanSession>(emptySession);
  const [findings, setFindings] = useState<FindingsPayload | null>(null);
  const [patchKit, setPatchKit] = useState<PatchKitPayload | null>(null);

  const setFindingsState = useCallback((next: FindingsPayload | null) => {
    setFindings(next);
    setPatchKit(null);
  }, []);

  const setScanComplete = useCallback(
    (repoUrl: string, branch: string, result: ScanPayload) => {
      setSession({
        repoUrl,
        branch,
        scanResult: result,
        scanComplete: true,
      });
      setFindings(null);
      setPatchKit(null);
    },
    []
  );

  const resetSession = useCallback(() => {
    setSession(emptySession);
    setFindings(null);
    setPatchKit(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      findings,
      patchKit,
      setScanComplete,
      setFindings: setFindingsState,
      setPatchKit,
      resetSession,
    }),
    [session, findings, patchKit, setScanComplete, setFindingsState, resetSession]
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
