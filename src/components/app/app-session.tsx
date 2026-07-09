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

export interface ScanSession {
  repoUrl: string;
  branch: string;
  scanResult: ScanPayload | null;
  scanComplete: boolean;
}

interface AppSessionContextValue {
  session: ScanSession;
  findings: FindingsPayload | null;
  setScanComplete: (repoUrl: string, branch: string, result: ScanPayload) => void;
  setFindings: (findings: FindingsPayload | null) => void;
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

  const setScanComplete = useCallback(
    (repoUrl: string, branch: string, result: ScanPayload) => {
      setSession({
        repoUrl,
        branch,
        scanResult: result,
        scanComplete: true,
      });
      setFindings(null);
    },
    []
  );

  const resetSession = useCallback(() => {
    setSession(emptySession);
    setFindings(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      findings,
      setScanComplete,
      setFindings,
      resetSession,
    }),
    [session, findings, setScanComplete, resetSession]
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
