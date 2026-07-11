import type { FindingsPayload } from "@/lib/findings/types";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import {
  countEligibleFindings,
  isActionableFinding,
} from "@/lib/findings/actionability-signals";
import { flattenFindings } from "@/lib/findings/client";

export type QuickCleanupWorkflowState =
  | "inactive"
  | "running"
  | "blocked"
  | "failed"
  | "complete";

export interface WorkflowGates {
  scanComplete: boolean;
  projectRootConfirmed: boolean;
  findingsUnlocked: boolean;
  findingsReady: boolean;
  eligibleFindingsCount: number;
  transformedFindingsCount: number;
  /** @deprecated */
  transformerCompatibleCount: number;
  /** @deprecated */
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
  verificationPassed: boolean;
  cleanupPrAvailable: boolean;
  reportOnlyPrAvailable: boolean;
}

export function computeWorkflowGates(input: {
  scanComplete: boolean;
  projectRootConfirmed?: boolean;
  findings: FindingsPayload | null;
  patchKit: PatchKitPayload | null;
  quickCleanupRunning?: boolean;
  verificationStatus?: "passed" | "failed" | "partial" | "not_run" | null;
}): WorkflowGates {
  const findings = input.findings;
  const patchKit = input.patchKit;
  const projectRootConfirmed = input.projectRootConfirmed ?? true;

  const flat = findings ? flattenFindings(findings) : [];
  const eligibleFindingsCount =
    findings?.summary.eligibleFindings ?? countEligibleFindings(flat);
  const transformedFindingsCount = findings?.summary.transformedFindings ?? 0;
  const supportedFixCount = flat.filter(isActionableFinding).length;
  const findingsReady = Boolean(findings);
  const findingsUnlocked = input.scanComplete && projectRootConfirmed;

  const generatedChanges = patchKit?.summary.generatedChanges ?? 0;
  const validatedChanges = patchKit?.summary.validatedChanges ?? 0;
  const verifiedChanges = patchKit?.summary.verifiedChanges ?? 0;
  const patchValidated = patchKit?.patchValidation?.status === "passed";
  const patchKitReady = Boolean(patchKit?.id);
  const verificationPassed = input.verificationStatus === "passed";

  let quickCleanupState: QuickCleanupWorkflowState = "inactive";
  if (input.quickCleanupRunning) {
    quickCleanupState = "running";
  } else if (patchKitReady) {
    if (validatedChanges > 0 && patchValidated) {
      quickCleanupState = "complete";
    } else if (generatedChanges === 0 && validatedChanges === 0) {
      quickCleanupState = "failed";
    } else {
      quickCleanupState = "blocked";
    }
  }

  return {
    scanComplete: input.scanComplete,
    projectRootConfirmed,
    findingsUnlocked,
    findingsReady,
    eligibleFindingsCount,
    transformedFindingsCount,
    transformerCompatibleCount: eligibleFindingsCount,
    dryRunPassedCount: transformedFindingsCount,
    supportedFixCount,
    quickCleanupAvailable: findingsReady && eligibleFindingsCount > 0,
    quickCleanupState,
    patchKitReady,
    generatedChanges,
    validatedChanges,
    verifiedChanges,
    patchValidated,
    verifyUnlocked: patchKitReady && patchValidated && validatedChanges > 0,
    verificationPassed,
    cleanupPrAvailable:
      patchKitReady &&
      patchValidated &&
      validatedChanges > 0 &&
      generatedChanges > 0 &&
      verificationPassed,
    reportOnlyPrAvailable: findingsReady,
  };
}
