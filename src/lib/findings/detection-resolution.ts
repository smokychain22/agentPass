/**
 * Command 3E, Part 1 — detection/resolution split. A detector's own output
 * (Knip found no imports, jscpd found similarity, a path looks generated)
 * must never be read as an implicit decision about what RepoDiet will do.
 * `detectionType` is what RepoDiet observed; `resolutionType` is what
 * RepoDiet can actually do about it, derived only through the real
 * transformer registry — never inferred directly from the detector name.
 */
import type { Finding } from "./types";
import { isDoNotTouchPath, isGeneratedArtefactPath } from "./confidence-path-rules";
import { isTempFilePath } from "@/lib/execution/fix-plugins/phase1-plugins";
import { resolvePhase1Plugin } from "@/lib/execution/fix-plugins/phase1-plugins";
import {
  canonicalTransformationId,
  resolutionTypeForCanonicalId,
  type CanonicalTransformationId,
  type ResolutionType,
} from "@/lib/execution/transformer-registry";
import { isCleanupEligible } from "./cleanup-eligibility";

export type DetectionType =
  | "duplicate_implementation"
  | "unused_file"
  | "unused_dependency"
  | "unused_export"
  | "unreachable_code"
  | "generated_artifact"
  | "protected_framework_file"
  | "suspicious_backup_file";

export interface DetectionResolution {
  detectionType: DetectionType;
  resolutionType: ResolutionType;
  supportedTransformationId: CanonicalTransformationId | null;
  verificationStatus: "verified" | "not_required" | "unsupported";
  actionable: boolean;
}

function baseDetectionType(finding: Finding): DetectionType {
  switch (finding.type) {
    case "duplicate_code":
      return "duplicate_implementation";
    case "unused_dependency":
      return "unused_dependency";
    case "unused_export":
      return "unused_export";
    case "orphan_pattern":
      return "unreachable_code";
    default: {
      // unused_file, unused_import, ai_slop_signal — path evidence decides
      // whether this is a real unused-file candidate, a generated artefact,
      // a framework-protected file, or a suspicious backup/archive file.
      const file = finding.files[0];
      if (file && isGeneratedArtefactPath(file)) return "generated_artifact";
      if (file && isDoNotTouchPath(file)) return "protected_framework_file";
      if (file && isTempFilePath(file)) return "suspicious_backup_file";
      return "unused_file";
    }
  }
}

/**
 * Single source of truth for what RepoDiet will do about a finding.
 * Generated/protected paths always resolve to "leave_protected" regardless
 * of detector output. Everything else is resolved only through the real
 * transformer registry — a finding is never "actionable" without a
 * canonical, implemented transformation and passing eligibility signals.
 */
export function classifyDetectionAndResolution(finding: Finding): DetectionResolution {
  const detectionType = baseDetectionType(finding);

  if (detectionType === "generated_artifact" || detectionType === "protected_framework_file") {
    return {
      detectionType,
      resolutionType: "leave_protected",
      supportedTransformationId: null,
      verificationStatus: "not_required",
      actionable: false,
    };
  }

  const plugin = resolvePhase1Plugin(finding);
  const canonicalId = canonicalTransformationId(plugin.id);
  if (!canonicalId) {
    return {
      detectionType,
      resolutionType: "report_only",
      supportedTransformationId: null,
      verificationStatus: "unsupported",
      actionable: false,
    };
  }

  const actionable = isCleanupEligible(finding);
  return {
    detectionType,
    resolutionType: resolutionTypeForCanonicalId(canonicalId),
    supportedTransformationId: canonicalId,
    verificationStatus: actionable ? "verified" : "unsupported",
    actionable,
  };
}
