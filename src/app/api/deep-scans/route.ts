import { NextResponse } from "next/server";
import { createDeepScanJob, DeepScanWorkerUnavailableError } from "@/lib/deep-scan/job-store";
import { after } from "next/server";
import { claimNextDeepScanJob } from "@/lib/deep-scan/job-store";
import { executeDeepScanJob } from "@/lib/deep-scan/execute";
import { isWorkerAvailable } from "@/lib/worker/worker-instance-store";
import { runPublicRepositoryIntake } from "@/lib/product/public-intake";
import { buildTenantBinding } from "@/lib/tenant/types";
import { resolveTenantIdentity } from "@/lib/tenant/request-auth";
import { customerError } from "@/lib/product/customer-errors";
import {
  capacityQueuedResponse,
  getDeepScanCapacitySnapshot,
} from "@/lib/deep-scan/capacity";
import { repositoryTargetFromKnown } from "@/lib/repository/repository-target";
import { RepositoryIdentityIncompleteError } from "@/lib/repository/repository-target";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Enqueue a durable deep-scan job for any authorized public repository.
 * Immediate response — full analysis continues via worker claim.
 * No repository allowlist.
 */
export async function POST(request: Request) {
  let body: {
    repoUrl?: string;
    branch?: string;
    projectRoot?: string;
    sourceCommit?: string;
    a2aTaskId?: string;
    readOnly?: boolean;
    idempotencyKey?: string;
    buyerWallet?: string;
    okxBuyerId?: string;
    allowInlineExecutor?: boolean;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      customerError({
        code: "INVALID_INPUT",
        message: "Request body must be valid JSON.",
        retryable: false,
        requiredAction: "SEND_JSON_BODY",
      }),
      { status: 400 }
    );
  }

  if (!body.repoUrl?.trim()) {
    return NextResponse.json(
      customerError({
        code: "INVALID_INPUT",
        message: "repoUrl is required.",
        retryable: false,
        requiredAction: "PROVIDE_REPOSITORY_URL",
      }),
      { status: 422 }
    );
  }

  const intake = await runPublicRepositoryIntake({
    repositoryUrl: body.repoUrl,
    branch: body.branch,
    projectRoot: body.projectRoot,
  });
  if (!intake.ok) {
    return NextResponse.json(intake.error, { status: 422 });
  }
  if (!intake.repositoryIsPublic) {
    return NextResponse.json(
      customerError({
        code: "PRIVATE_UNAUTHORIZED",
        message: "Private repositories require GitHub App authorization before deep scan.",
        retryable: false,
        requiredAction: "INSTALL_GITHUB_APP",
      }),
      { status: 403 }
    );
  }

  const identity = resolveTenantIdentity(request);
  const tenant = buildTenantBinding({
    okxBuyerId: body.okxBuyerId?.trim() || identity.okxBuyerId,
    buyerWallet: body.buyerWallet?.trim() || identity.buyerWallet,
    repositoryOwner: intake.owner,
    repositoryName: intake.name,
    branch: intake.branch,
    sourceCommit: body.sourceCommit?.trim() || intake.sourceCommit,
    projectRoot: intake.projectRoot,
    taskId: body.a2aTaskId,
  });
  // Prefer explicit body/header tenant over anonymous when buyer identity is present.
  if (
    tenant.tenantId === "anonymous_public_readonly" &&
    identity.tenantId !== "anonymous_public_readonly"
  ) {
    tenant.tenantId = identity.tenantId;
    tenant.okxBuyerId = identity.okxBuyerId;
    tenant.buyerWallet = identity.buyerWallet;
  }

  try {
    const capacityBefore = await getDeepScanCapacitySnapshot(tenant.tenantId);
    const repositoryTarget = repositoryTargetFromKnown({
      owner: intake.owner,
      name: intake.name,
      branch: intake.branch,
      sourceCommit: tenant.sourceCommit || intake.sourceCommit,
      projectRoot: intake.projectRoot,
      visibility: intake.repositoryIsPublic ? "public" : "private",
    });
    const job = await createDeepScanJob(
      {
        repoUrl: repositoryTarget.repositoryUrl,
        branch: repositoryTarget.branch,
        projectRoot: repositoryTarget.projectRoot,
        sourceCommit: repositoryTarget.sourceCommit,
        a2aTaskId: body.a2aTaskId?.trim(),
        readOnly: body.readOnly !== false,
        requestedBy: `tenant:${tenant.tenantId}`,
        tenantId: tenant.tenantId,
        buyerWallet: tenant.buyerWallet,
        okxBuyerId: tenant.okxBuyerId,
      },
      {
        repositoryTarget,
        idempotencyKey:
          body.idempotencyKey?.trim() ||
          `deep:${tenant.tenantId}:${intake.repository}:${repositoryTarget.sourceCommit}:${intake.projectRoot}`,
      }
    );

    const { dispatchQueuedDeepScanJob } = await import("@/lib/deep-scan/dispatch-queued-job");
    const dispatched = await dispatchQueuedDeepScanJob({
      jobId: job.id,
      requestId: `deep_${job.id}`,
      tenantId: tenant.tenantId,
    });
    const liveJob = dispatched.job;

    const workerReady = await isWorkerAvailable();
    const allowInline =
      body.allowInlineExecutor === true &&
      !workerReady &&
      process.env.NODE_ENV !== "production" &&
      process.env.VERCEL_ENV !== "production";

    if (allowInline) {
      after(() => {
        void (async () => {
          const claimed = await claimNextDeepScanJob("inline-deep-scan");
          if (claimed && claimed.id === liveJob.id) {
            await executeDeepScanJob(claimed.id, "inline-deep-scan", {
              alreadyClaimed: true,
              claimToken: claimed.claimToken,
            });
          }
        })().catch((err) => {
          console.error("[deep-scan] inline executor failed", err);
        });
      });
    }

    const capacityAfter = await getDeepScanCapacitySnapshot(tenant.tenantId);
    const overCapacity =
      capacityBefore.atGlobalCapacity ||
      capacityBefore.tenantAtCapacity ||
      capacityAfter.activeJobs > capacityAfter.globalLimit;

    if (overCapacity) {
      // Still persisted — never drop. Honest QUEUED + CAPACITY_LIMIT (not 504).
      return NextResponse.json({
        ok: true,
        ...capacityQueuedResponse({
          taskId: liveJob.id,
          statusUrl: `/api/deep-scans/${liveJob.id}`,
          queuePosition: Math.max(0, capacityAfter.queueDepth - 1),
          reason: capacityBefore.tenantAtCapacity ? "TENANT" : "GLOBAL",
        }),
        jobId: liveJob.id,
        tenantId: tenant.tenantId,
        repository: intake.repository,
        sourceCommit: tenant.sourceCommit,
        stage: liveJob.stage,
        dispatchState: dispatched.dispatchState,
        workflowRunId: liveJob.workflowRunId ?? null,
        progressUrl: `/api/deep-scans/${liveJob.id}`,
        workerReady: workerReady || dispatched.dispatched,
      });
    }

    return NextResponse.json({
      ok: true,
      jobId: liveJob.id,
      tenantId: tenant.tenantId,
      repository: intake.repository,
      sourceCommit: tenant.sourceCommit,
      status: liveJob.status,
      stage: liveJob.stage,
      dispatchState: dispatched.dispatchState,
      workflowRunId: liveJob.workflowRunId ?? null,
      progressUrl: `/api/deep-scans/${liveJob.id}`,
      workerReady: workerReady || dispatched.dispatched,
      queueDepth: capacityAfter.queueDepth,
      message: dispatched.dispatched
        ? "Deep scan dispatched to GitHub Actions analysis worker."
        : workerReady
          ? "Deep scan queued for RepoDiet worker."
          : dispatched.error
            ? `Deep scan persisted; dispatch: ${dispatched.error}`
            : "Deep scan persisted. Waiting for RepoDiet worker heartbeat to claim — not executed solely via after().",
      note: "A2MCP Quick Triage remains bounded; this endpoint is for full durable analysis. No repository allowlist.",
    });
  } catch (err) {
    if (err instanceof RepositoryIdentityIncompleteError) {
      return NextResponse.json(
        {
          ...customerError({
            code: "INVALID_INPUT",
            message: err.message,
            retryable: false,
            requiredAction: "PROVIDE_CANONICAL_GITHUB_URL",
            paymentState: "not_required",
            taskId: err.taskId,
          }),
          code: "REPOSITORY_IDENTITY_INCOMPLETE",
          missingFields: err.missingFields,
        },
        { status: 422 }
      );
    }
    if (err instanceof DeepScanWorkerUnavailableError) {
      return NextResponse.json(
        customerError({
          code: "WORKER_UNAVAILABLE",
          message: err.message,
          retryable: true,
          requiredAction: "RETRY_LATER",
          paymentState: "not_required",
        }),
        { status: 503 }
      );
    }
    return NextResponse.json(
      customerError({
        code: "INVALID_INPUT",
        message: err instanceof Error ? err.message : "Failed to enqueue deep scan.",
        retryable: true,
        requiredAction: "RETRY",
      }),
      { status: 500 }
    );
  }
}
