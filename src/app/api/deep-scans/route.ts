import { NextResponse } from "next/server";
import { createDeepScanJob, DeepScanWorkerUnavailableError } from "@/lib/deep-scan/job-store";
import { after } from "next/server";
import { claimNextDeepScanJob } from "@/lib/deep-scan/job-store";
import { executeDeepScanJob } from "@/lib/deep-scan/execute";
import { isWorkerAvailable } from "@/lib/worker/worker-instance-store";
import { runPublicRepositoryIntake } from "@/lib/product/public-intake";
import { buildTenantBinding } from "@/lib/tenant/types";
import { customerError } from "@/lib/product/customer-errors";
import {
  capacityQueuedResponse,
  getDeepScanCapacitySnapshot,
} from "@/lib/deep-scan/capacity";

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

  const tenant = buildTenantBinding({
    okxBuyerId: body.okxBuyerId,
    buyerWallet: body.buyerWallet,
    repositoryOwner: intake.owner,
    repositoryName: intake.name,
    branch: intake.branch,
    sourceCommit: body.sourceCommit?.trim() || intake.sourceCommit,
    projectRoot: intake.projectRoot,
    taskId: body.a2aTaskId,
  });

  try {
    const capacityBefore = await getDeepScanCapacitySnapshot(tenant.tenantId);
    const job = await createDeepScanJob(
      {
        repoUrl: intake.canonicalUrl,
        branch: intake.branch,
        projectRoot: intake.projectRoot,
        sourceCommit: tenant.sourceCommit,
        a2aTaskId: body.a2aTaskId?.trim(),
        readOnly: body.readOnly !== false,
        requestedBy: `tenant:${tenant.tenantId}`,
        tenantId: tenant.tenantId,
        buyerWallet: tenant.buyerWallet,
        okxBuyerId: tenant.okxBuyerId,
      },
      {
        idempotencyKey:
          body.idempotencyKey?.trim() ||
          `deep:${tenant.tenantId}:${intake.repository}:${tenant.sourceCommit}:${intake.projectRoot}`,
      }
    );

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
          if (claimed && claimed.id === job.id) {
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
          taskId: job.id,
          statusUrl: `/api/deep-scans/${job.id}`,
          queuePosition: Math.max(0, capacityAfter.queueDepth - 1),
          reason: capacityBefore.tenantAtCapacity ? "TENANT" : "GLOBAL",
        }),
        jobId: job.id,
        tenantId: tenant.tenantId,
        repository: intake.repository,
        sourceCommit: tenant.sourceCommit,
        stage: job.stage,
        progressUrl: `/api/deep-scans/${job.id}`,
        workerReady,
      });
    }

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      tenantId: tenant.tenantId,
      repository: intake.repository,
      sourceCommit: tenant.sourceCommit,
      status: job.status,
      stage: job.stage,
      progressUrl: `/api/deep-scans/${job.id}`,
      workerReady,
      queueDepth: capacityAfter.queueDepth,
      message: workerReady
        ? "Deep scan queued for RepoDiet worker."
        : "Deep scan persisted. Waiting for RepoDiet worker heartbeat to claim — not executed solely via after().",
      note: "A2MCP Quick Triage remains bounded; this endpoint is for full durable analysis. No repository allowlist.",
    });
  } catch (err) {
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
