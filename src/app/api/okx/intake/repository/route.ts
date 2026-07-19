import { NextResponse } from "next/server";
import { runPublicRepositoryIntake } from "@/lib/product/public-intake";
import { buildTenantBinding } from "@/lib/tenant/types";
import { createDeepScanJob } from "@/lib/deep-scan/job-store";
import { getServerBaseUrl } from "@/lib/docs/base-url";
import { customerError } from "@/lib/product/customer-errors";
import { isWorkerAvailable } from "@/lib/worker/worker-instance-store";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * Public repository intake — validates URL, pins commit, optionally enqueues durable deep scan.
 * Does not run analyzers inline. Same rules for every buyer/repository.
 */
export async function POST(request: Request) {
  const started = Date.now();
  let body: {
    repositoryUrl?: string;
    branch?: string;
    projectRoot?: string;
    objective?: string;
    requiredCommands?: string[];
    buyerWallet?: string;
    okxBuyerId?: string;
    enqueueDeepScan?: boolean;
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

  if (!body.repositoryUrl?.trim()) {
    return NextResponse.json(
      customerError({
        code: "INVALID_INPUT",
        message: "repositoryUrl is required.",
        retryable: false,
        requiredAction: "PROVIDE_REPOSITORY_URL",
      }),
      { status: 422 }
    );
  }

  const intake = await runPublicRepositoryIntake({
    repositoryUrl: body.repositoryUrl,
    branch: body.branch,
    projectRoot: body.projectRoot,
    objective: body.objective,
    requiredCommands: body.requiredCommands,
  });

  if (!intake.ok) {
    const status =
      "status" in intake.error && intake.error.status === "UNSUPPORTED"
        ? 422
        : intake.error && "code" in intake.error && intake.error.code === "BRANCH_MISSING"
          ? 404
          : 422;
    return NextResponse.json(intake.error, { status });
  }

  const tenant = buildTenantBinding({
    okxBuyerId: body.okxBuyerId,
    buyerWallet: body.buyerWallet,
    repositoryOwner: intake.owner,
    repositoryName: intake.name,
    branch: intake.branch,
    sourceCommit: intake.sourceCommit,
    projectRoot: intake.projectRoot,
  });

  const baseUrl = getServerBaseUrl();
  const workerReady = await isWorkerAvailable();
  let deepScanJobId: string | undefined;
  let progressUrl: string | undefined;

  if (body.enqueueDeepScan !== false) {
    if (!intake.repositoryIsPublic) {
      return NextResponse.json(
        {
          ...customerError({
            code: "PRIVATE_UNAUTHORIZED",
            message:
              "Private repositories require RepoDiet Operator installation before analysis can be queued.",
            retryable: false,
            requiredAction: "INSTALL_GITHUB_APP",
            paymentState: "not_required",
          }),
          tenantId: tenant.tenantId,
          repository: intake.repository,
          repositoryIsPublic: false,
          canScan: false,
          canCreatePullRequest: false,
        },
        { status: 403 }
      );
    }

    const { repositoryTargetFromKnown } = await import("@/lib/repository/repository-target");
    const repositoryTarget = repositoryTargetFromKnown({
      owner: intake.owner,
      name: intake.name,
      branch: intake.branch,
      sourceCommit: intake.sourceCommit,
      projectRoot: intake.projectRoot,
      visibility: "public",
    });
    const job = await createDeepScanJob(
      {
        repoUrl: repositoryTarget.repositoryUrl,
        branch: repositoryTarget.branch,
        projectRoot: repositoryTarget.projectRoot,
        sourceCommit: repositoryTarget.sourceCommit,
        readOnly: true,
        requestedBy: `tenant:${tenant.tenantId}`,
        tenantId: tenant.tenantId,
        buyerWallet: tenant.buyerWallet,
        okxBuyerId: tenant.okxBuyerId,
      },
      {
        repositoryTarget,
        idempotencyKey: `intake:${tenant.tenantId}:${intake.repository}:${intake.sourceCommit}:${intake.projectRoot}`,
      }
    );
    const { dispatchQueuedDeepScanJob } = await import("@/lib/deep-scan/dispatch-queued-job");
    await dispatchQueuedDeepScanJob({
      jobId: job.id,
      requestId: `intake_${job.id}`,
      tenantId: tenant.tenantId,
    });
    deepScanJobId = job.id;
    progressUrl = `${baseUrl}/api/deep-scans/${job.id}`;
  }

  return NextResponse.json({
    ok: true,
    status: "ACCEPTED",
    message:
      "Repository accepted. Deep analysis continues asynchronously when queued — this response does not wait for analyzers.",
    tenantId: tenant.tenantId,
    repository: intake.repository,
    branch: intake.branch,
    projectRoot: intake.projectRoot,
    sourceCommit: intake.sourceCommit,
    repositoryIsPublic: intake.repositoryIsPublic,
    canScanReadOnly: intake.repositoryIsPublic,
    canCreatePullRequest: false,
    githubAppRequiredForWrite: true,
    deepScanJobId,
    progressUrl,
    workerReady,
    nextAction: deepScanJobId ? "POLL_DEEP_SCAN" : "PROVIDE_SCOPE_OR_INSTALL_APP",
    responseTimeMs: Date.now() - started,
  });
}
