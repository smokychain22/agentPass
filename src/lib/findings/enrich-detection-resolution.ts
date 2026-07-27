import type { FindingsPayload } from "./types";
import { flattenFindings } from "./client";
import { rebuildFindingsPayload } from "./canonical-findings";
import { classifyDetectionAndResolution } from "./detection-resolution";

/** Persists detectionType/resolutionType/supportedTransformationId/verificationStatus/actionable onto every finding before storage. */
export function enrichFindingsWithDetectionResolution(payload: FindingsPayload): FindingsPayload {
  const flat = flattenFindings(payload).map((finding) => ({
    ...finding,
    ...classifyDetectionAndResolution(finding),
  }));
  return rebuildFindingsPayload(payload, flat);
}
