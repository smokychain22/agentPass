import type { FindingsPayload } from "@/lib/findings/types";
import type { FrameworkName, PackageManager } from "@/lib/scanner/types";

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

export interface PatchKitSummary {
  safeDeleteCandidates: number;
  validatedChanges: number;
  supportedFixesDetected: number;
  rawReviewFindings: number;
  reviewFirstItems: number;
  doNotTouchItems: number;
  packageSuggestions: number;
  patchLines: number;
  regressionChecks: number;
  bundleFileCount: number;
  patchValidationStatus?: "passed" | "failed" | "skipped";
  deletedPaths?: string[];
  changedPaths?: string[];
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

export interface PatchKitPayload {
  id: string;
  repo: PatchKitRepo;
  summary: PatchKitSummary;
  patchValidation?: {
    status: "passed" | "failed" | "skipped";
    error?: string;
  };
  artifacts: PatchKitArtifacts;
  downloadUrl: string;
  zipBase64?: string;
  validatedEdits?: Array<{ path: string; content: string }>;
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
