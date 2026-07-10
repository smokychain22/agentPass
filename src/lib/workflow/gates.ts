import type { FindingsPayload } from "@/lib/findings/types";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import {
  countTransformerCompatible,
  isActionableFinding,
} from "@/lib/findings/actionability-signals";
import { flattenFindings } from "@/lib/findings/client";

export type QuickCleanupWorkflowState =
  | "inactive"
  | "running"
  | "blocked"
  | "complete";

export interface WorkflowGates {
  scanComplete: boolean;
  projectRootConfirmed: boolean;
  findingsUnlocked: boolean;
  findingsReady: boolean;
  transformerCompatibleCount: number;
  dryRunPassedCount: number;
  supportedFixCount: number;
  quickCleanupAvailable: boolean;
  quickCleanupState: QuickCleanupWorkflowState;
  patchKitReady: boolean;
  generatedChanges: number;
  validatedChanges: number;
  verifiedChanges: number;
  patchValidated: boolean;
  verifyUnlocked: boolean;
  cleanupPrAvailable: boolean;
  reportOnlyPrAvailable: boolean;
}

export function computeWorkflowGates(input: {
  scanComplete: boolean;
  projectRootConfirmed?: boolean;
  findings: FindingsPayload | null;
  patchKit: PatchKitPayload | null;
  quickCleanupRunning?: boolean;
}): WorkflowGates {
  const findings = input.findings;
  const patchKit = input.patchKit;
  const projectRootConfirmed = input.projectRootConfirmed ?? true;

  const flat = findings ? flattenFindings(findings) : [];
  const transformerCompatibleCount =
    findings?.summary.transformerCompatible ?? countTransformerCompatible(flat);
  const dryRunPassedCount = findings?.summary.dryRunPassed ?? 0;
  const supportedFixCount = flat.filter(isActionableFinding).length;
  const findingsReady = Boolean(findings);
  const findingsUnlocked = input.scanComplete && projectRootConfirmed;

  const generatedChanges = patchKit?.summary.generatedChanges ?? 0;
  const validatedChanges = patchKit?.summary.validatedChanges ?? 0;
  const verifiedChanges = patchKit?.summary.verifiedChanges ?? 0;
  const patchValidated = patchKit?.patchValidation?.status === "passed";
  const patchKitReady = Boolean(patchKit?.id);
  const transformerCompatible =
    patchKit?.summary.transformerCompatible ?? transformerCompatibleCount;

  let quickCleanupState: QuickCleanupWorkflowState = "inactive";
  if (input.quickCleanupRunning) {
    quickCleanupState = "running";
  } else if (patchKitReady) {
    if (verifiedChanges > 0 && patchValidated) {
      quickCleanupState = "complete";
    } else if (transformerCompatible > 0) {
      quickCleanupState = "blocked";
    } else {
      quickCleanupState = "blocked";
    }
  }

  return {
    scanComplete: input.scanComplete,
    projectRootConfirmed,
    findingsUnlocked,
    findingsReady,
    transformerCompatibleCount,
    dryRunPassedCount,
    supportedFixCount,
    quickCleanupAvailable: findingsReady && transformerCompatibleCount > 0,
    quickCleanupState,
    patchKitReady,
    generatedChanges,
    validatedChanges,
    verifiedChanges,
    patchValidated,
    verifyUnlocked: patchKitReady && patchValidated && validatedChanges > 0,
    cleanupPrAvailable:
      patchKitReady &&
      verifiedChanges > 0 &&
      validatedChanges > 0 &&
      patchValidated &&
      generatedChanges > 0,
    reportOnlyPrAvailable: findingsReady,
  };
}
