import type { PatchKitPayload } from "@/lib/patch-kit/types";
import { getSandboxRunByCleanupRunId } from "@/lib/execution/sandbox-run-store";
import { reconcileSandboxRun } from "@/lib/execution/reconcile-sandbox-run";
import { getStoredPatchKit } from "@/lib/patch-kit/patch-kit-store";

export function patchKitHasDeliverableChanges(patchKit: PatchKitPayload): boolean {
  const verified = patchKit.summary.verifiedChanges ?? 0;
  if (verified > 0) return true;
  // Git-validated-only bundles are not deliverable — repository verification must complete.
  if (
    patchKit.repositoryVerification?.status === "verified" &&
    (patchKit.summary.generatedChanges ?? 0) > 0 &&
    patchKit.patchValidation?.status === "passed"
  ) {
    return true;
  }
  return false;
}

export function patchKitDeliveryBlocker(patchKit: PatchKitPayload): string | undefined {
  if (patchKitHasDeliverableChanges(patchKit)) return undefined;
  if (patchKit.patchValidation?.status === "pending_sandbox") {
    return "Repository verification is still running. Wait for sandbox validation to finish, then retry delivery.";
  }
  if ((patchKit.summary.validatedChanges ?? 0) === 0 && (patchKit.summary.generatedChanges ?? 0) === 0) {
    return "No cleanup changes were generated for the selected findings. Re-run eligibility on Findings and select findings with confirmed preflight.";
  }
  return (
    patchKit.repositoryVerification?.error ??
    patchKit.patchValidation?.userMessage ??
    patchKit.patchValidation?.error ??
    "Cleanup changes did not pass repository verification."
  );
}

export async function waitForPatchKitSandbox(
  patchKit: PatchKitPayload,
  maxMs = 240_000
): Promise<PatchKitPayload> {
  if (patchKit.patchValidation?.status !== "pending_sandbox") {
    return patchKit;
  }

  const cleanupRunId = patchKit.id;
  const deadline = Date.now() + maxMs;

  while (Date.now() < deadline) {
    const run = await getSandboxRunByCleanupRunId(cleanupRunId);
    if (run) {
      await reconcileSandboxRun(run);
    }

    const refreshed = await getStoredPatchKit(cleanupRunId);
    const next = refreshed?.payload ?? patchKit;
    if (next.patchValidation?.status !== "pending_sandbox") {
      return next;
    }

    await new Promise((resolve) => setTimeout(resolve, 4000));
  }

  const refreshed = await getStoredPatchKit(cleanupRunId);
  return refreshed?.payload ?? patchKit;
}
