import type { FindingsPayload } from "@/lib/findings/types";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import type { ScanPayload } from "@/lib/scanner/run-scan";

export type JobStatus = "queued" | "running" | "complete" | "failed";

export type ScanJobStage =
  | "queued"
  | "validating_repository"
  | "resolving_branch"
  | "downloading_archive"
  | "extracting_archive"
  | "inventorying_files"
  | "detecting_frameworks"
  | "detecting_project_roots"
  | "detecting_protected_paths"
  | "persisting_scan"
  | "complete";

export type FindingsJobStage =
  | "queued"
  | "fetching_repo"
  | "extracting"
  | "framework_detection"
  | "jscpd"
  | "knip"
  | "madge"
  | "heuristics"
  | "normalizing"
  | "complete";

export type PatchJobStage =
  | "queued"
  | "loading_findings"
  | "classifying"
  | "generating_patch"
  | "validating_patch"
  | "building_bundle"
  | "complete";

export type VerifyJobStage =
  | "queued"
  | "preparing_workspace"
  | "applying_patch"
  | "installing_deps"
  | "running_checks"
  | "complete";

export type JobType = "scan" | "findings" | "patch" | "verify";

export interface BaseJob {
  id: string;
  type: JobType;
  status: JobStatus;
  stage: string;
  progress: null;
  ownerKey: string;
  repoUrl: string;
  branch?: string;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface ScanJob extends BaseJob {
  type: "scan";
  stage: ScanJobStage;
  result?: ScanPayload;
}

export interface FindingsJob extends BaseJob {
  type: "findings";
  stage: FindingsJobStage;
  result?: FindingsPayload;
  scanId?: string;
}

export interface PatchJob extends BaseJob {
  type: "patch";
  stage: PatchJobStage;
  result?: PatchKitPayload;
  scanId?: string;
  patchValidation?: {
    status: "passed" | "failed" | "skipped";
    error?: string;
  };
}

export interface VerifyCheckResult {
  name: string;
  command: string;
  status: "passed" | "failed" | "not_run" | "skipped";
  exitCode: number | null;
  durationMs: number;
  stdoutSummary: string;
  stderrSummary: string;
}

export interface VerifyJob extends BaseJob {
  type: "verify";
  stage: VerifyJobStage;
  patchId: string;
  result?: {
    status: "passed" | "failed" | "partial" | "not_run";
    checks: VerifyCheckResult[];
    limitations: string[];
  };
}

export type RepoDietJob = ScanJob | FindingsJob | PatchJob | VerifyJob;

export function jobOwnerKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "anonymous";
  return request.headers.get("x-real-ip") ?? "anonymous";
}
