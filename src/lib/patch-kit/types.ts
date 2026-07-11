import type { FindingsPayload } from "@/lib/findings/types";
import type { FrameworkName, PackageManager } from "@/lib/scanner/types";
import type { CandidateAuditRecord, BlockerCode } from "@/lib/execution/candidate-lifecycle";

export interface PatchKitGenerateBody {
  repoUrl: string;
  branch?: string;
  findings?: FindingsPayload;
  selectedFindingIds?: string[];
}

export interface PatchKitRepo {
  owner: string;
  name: string;
  branch: string;
}

export interface TransformerResult {
  findingId: string;
  transformer: string;
  status: "generated" | "skipped" | "failed";
  reason: string;
  filePath?: string;
  originalHash?: string;
  resultingDiff?: string;
}

export interface PatchKitSummary {
  safeDeleteCandidates: number;
  /** @deprecated Use eligibleFindings */
  supportedFixesDetected?: number;
  /** @deprecated Use eligibleFindings */
  transformerCompatible: number;
  /** @deprecated Use transformedFindings */
  dryRunPassed: number;
  eligibleFindings?: number;
  attemptedTransformations?: number;
  noopTransformations?: number;
  failedTransformations?: number;
  notAttempted?: number;
  generatedChanges: number;
  validatedChanges: number;
  verifiedChanges: number;
  /** Retained transformer attempts before per-file consolidation for patch delivery */
  retainedFixAttempts?: number;
  filesEdited: number;
  filesDeleted: number;
  filesAdded: number;
  rawReviewFindings: number;
  reviewFirstItems: number;
  doNotTouchItems: number;
  packageSuggestions: number;
  patchLines: number;
  regressionChecks: number;
  bundleFileCount: number;
  patchValidationStatus?: "passed" | "failed" | "skipped" | "not_generated";
  deletedPaths?: string[];
  changedPaths?: string[];
  blockerBreakdown?: Partial<Record<BlockerCode, number>>;
  blockerSummary?: string;
  detectedSignals?: number;
  proofLadder?: import("@/lib/execution/proof-ladder").ProofLadderCounts;
}

export interface PatchKitArtifacts {
  reportMd: string;
  cleanupPatch: string;
  packageCleanupMd: string;
  regressionChecklistMd: string;
  cursorPromptMd: string;
  findingsJson: FindingsPayload;
  patchkitSummaryJson: string;
}

export interface ChangeManifestEntry {
  findingId: string;
  transformationType: string;
  filePath: string;
  operation: "edit" | "delete" | "add";
  linesAdded?: number;
  linesRemoved?: number;
}

export interface PatchKitPayload {
  id: string;
  scanId?: string;
  repo: PatchKitRepo;
  summary: PatchKitSummary;
  patchValidation?: {
    status: "passed" | "failed" | "skipped" | "not_generated";
    error?: string;
  };
  transformerResults?: TransformerResult[];
  candidateAudits?: CandidateAuditRecord[];
  artifacts: PatchKitArtifacts;
  downloadUrl: string;
  zipBase64?: string;
  validatedEdits?: Array<{ path: string; content: string; baselineContentHash?: string }>;
  changeManifest?: ChangeManifestEntry[];
  cleanupProof?: import("@/lib/execution/proof-ladder").CleanupProof;
}

export interface PatchKitRepoContext {
  framework: FrameworkName;
  packageManager: PackageManager;
  routes: string[];
  apiRoutes: string[];
  hasTypecheck: boolean;
  hasLint: boolean;
  hasBuild: boolean;
}

export interface ClassifiedItem {
  path: string;
  reason: string;
  findingId?: string;
  findingType?: string;
}

export interface ClassifiedBuckets {
  safeDelete: ClassifiedItem[];
  reviewFirst: ClassifiedItem[];
  doNotTouch: ClassifiedItem[];
}

export const PatchKitGenerateBodySchema = {
  parse(input: unknown): PatchKitGenerateBody {
    if (!input || typeof input !== "object") {
      throw new Error("Invalid request body.");
    }
    const body = input as Record<string, unknown>;
    if (typeof body.repoUrl !== "string" || !body.repoUrl.trim()) {
      throw new Error("repoUrl is required.");
    }
    return {
      repoUrl: body.repoUrl.trim(),
      branch: typeof body.branch === "string" ? body.branch.trim() : undefined,
      findings:
        body.findings && typeof body.findings === "object"
          ? (body.findings as FindingsPayload)
          : undefined,
      selectedFindingIds: Array.isArray(body.selectedFindingIds)
        ? body.selectedFindingIds.filter((id): id is string => typeof id === "string")
        : undefined,
    };
  },
};
