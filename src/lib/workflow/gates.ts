import type { FindingsPayload } from "@/lib/findings/types";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import { isActionableFinding } from "@/lib/findings/actionability-signals";
import { flattenFindings } from "@/lib/findings/client";

export interface WorkflowGates {
  scanComplete: boolean;
  findingsReady: boolean;
  supportedFixCount: number;
  quickCleanupAvailable: boolean;
  patchKitReady: boolean;
  patchValidated: boolean;
  verifyUnlocked: boolean;
  cleanupPrAvailable: boolean;
  reportOnlyPrAvailable: boolean;
}

export function computeWorkflowGates(input: {
  scanComplete: boolean;
  findings: FindingsPayload | null;
  patchKit: PatchKitPayload | null;
}): WorkflowGates {
  const findings = input.findings;
  const patchKit = input.patchKit;

  const flat = findings ? flattenFindings(findings) : [];
  const supportedFixCount = flat.filter(isActionableFinding).length;
  const findingsReady = Boolean(findings);

  const validatedChanges = patchKit?.summary.validatedChanges ?? 0;
  const patchValidated = patchKit?.patchValidation?.status === "passed";
  const patchKitReady = Boolean(patchKit?.id);
  const hasGeneratedChanges = validatedChanges > 0;

  return {
    scanComplete: input.scanComplete,
    findingsReady,
    supportedFixCount,
    quickCleanupAvailable: findingsReady && supportedFixCount > 0,
    patchKitReady,
    patchValidated,
    verifyUnlocked: patchKitReady && patchValidated && hasGeneratedChanges,
    cleanupPrAvailable: patchKitReady && patchValidated && hasGeneratedChanges,
    reportOnlyPrAvailable: findingsReady && Boolean(patchKit?.artifacts?.reportMd),
  };
}
