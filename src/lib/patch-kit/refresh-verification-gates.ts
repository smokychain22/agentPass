import type { FindingsPayload } from "@/lib/findings/types";
import { buildVerificationGateReport } from "./verification-gates";
import type { PatchKitPayload } from "./types";

/** Recompute verification gates from the patch kit's current summary and verification state. */
export function withRefreshedVerificationGates(
  patchKit: PatchKitPayload,
  findings?: FindingsPayload
): PatchKitPayload {
  const findingsPayload = findings ?? patchKit.artifacts?.findingsJson;
  const verificationGates = buildVerificationGateReport(patchKit, findingsPayload);
  return { ...patchKit, verificationGates };
}
