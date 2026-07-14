import type { Finding } from "@/lib/findings/types";
import type { RepositoryConnectionStatus } from "./github-repository-status";
import {
  formatBaselineInvalidMessage,
  runBaselineReadiness,
  type BaselineReadinessResult,
} from "./baseline-readiness";
import {
  runTransformPreflightForQuote,
  type TransformPreflightResult,
} from "./transform-preflight-gate";
import {
  ensureScanInvalidationMetadata,
  ensureTaskInvalidationMetadata,
  scanBlocksFixPr,
} from "./source-invalidation";

export class PreQuoteGateError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly baseline?: BaselineReadinessResult;
  readonly transform?: TransformPreflightResult;
  readonly invalidation?: {
    status: string;
    retryable: false;
    requiresNewScan: true;
  };

  constructor(
    message: string,
    input: {
      code: string;
      httpStatus?: number;
      baseline?: BaselineReadinessResult;
      transform?: TransformPreflightResult;
      invalidation?: { status: string; retryable: false; requiresNewScan: true };
    }
  ) {
    super(message);
    this.name = "PreQuoteGateError";
    this.code = input.code;
    this.httpStatus = input.httpStatus ?? 422;
    this.baseline = input.baseline;
    this.transform = input.transform;
    this.invalidation = input.invalidation;
  }
}

export interface PreQuoteGateInput {
  repoUrl: string;
  branch?: string;
  scanId: string;
  commitSha: string;
  findingIds: string[];
  findings: Finding[];
  repository: string;
  github?: RepositoryConnectionStatus | null;
  taskId?: string;
  skipTransformPreflight?: boolean;
}

export interface PreQuoteGateResult {
  baseline: BaselineReadinessResult;
  transform?: TransformPreflightResult;
  transformedSourceHashes: Record<string, string>;
  eligibleFindingIds: string[];
}

export async function assertPreQuoteGate(input: PreQuoteGateInput): Promise<PreQuoteGateResult> {
  const scanInvalidation = await ensureScanInvalidationMetadata(input.scanId);
  if (scanBlocksFixPr(scanInvalidation)) {
    throw new PreQuoteGateError(
      scanInvalidation?.reason ?? "Scan is blocked due to invalid source baseline.",
      {
        code: scanInvalidation?.status ?? "invalid_source_baseline",
        httpStatus: 409,
        invalidation: {
          status: scanInvalidation!.status,
          retryable: false,
          requiresNewScan: true,
        },
      }
    );
  }

  if (input.taskId) {
    const taskInvalidation = await ensureTaskInvalidationMetadata(input.taskId);
    if (scanBlocksFixPr(taskInvalidation)) {
      throw new PreQuoteGateError(
        taskInvalidation?.reason ?? "Task is blocked due to invalid source baseline.",
        {
          code: taskInvalidation?.status ?? "invalid_source_baseline",
          httpStatus: 409,
          invalidation: {
            status: taskInvalidation!.status,
            retryable: false,
            requiresNewScan: true,
          },
        }
      );
    }
  }

  if (input.github && (input.github.authoritativeState !== "repository_verified" || !input.github.connected)) {
    throw new PreQuoteGateError("GitHub write access is required before quote creation.", {
      code: "github_authorization_required",
      httpStatus: 403,
    });
  }

  const touchedPaths = input.findings
    .filter((f) => input.findingIds.includes(f.id))
    .flatMap((f) => f.files);

  const baseline = await runBaselineReadiness({
    repoUrl: input.repoUrl,
    branch: input.branch,
    commitSha: input.commitSha,
    touchedPaths,
    findings: input.findings.filter((f) => input.findingIds.includes(f.id)),
  });

  if (baseline.status !== "baseline_ready") {
    throw new PreQuoteGateError(formatBaselineInvalidMessage(baseline), {
      code: baseline.status,
      httpStatus: baseline.status === "baseline_infrastructure_failed" ? 503 : 422,
      baseline,
      invalidation: {
        status: "invalid_source_baseline",
        retryable: false,
        requiresNewScan: true,
      },
    });
  }

  if (input.skipTransformPreflight) {
    return { baseline, transformedSourceHashes: {}, eligibleFindingIds: input.findingIds };
  }

  const transform = await runTransformPreflightForQuote({
    repoUrl: input.repoUrl,
    branch: input.branch,
    findings: input.findings,
    findingIds: input.findingIds,
  });

  if (!transform.allPassed || transform.passed.length === 0) {
    throw new PreQuoteGateError(
      "None of the selected findings passed transform preflight. Re-run eligibility and select findings with confirmed dry-run.",
      {
        code: "transform_preflight_failed",
        httpStatus: 422,
        baseline,
        transform,
      }
    );
  }

  return {
    baseline,
    transform,
    transformedSourceHashes: transform.transformedSourceHashes,
    eligibleFindingIds: transform.passed.map((p) => p.findingId),
  };
}

export function preQuoteGateErrorResponse(err: PreQuoteGateError) {
  return {
    ok: false,
    error: err.code,
    message: err.message,
    baseline: err.baseline,
    transform: err.transform,
    invalidation: err.invalidation,
  };
}
