import { NextResponse } from "next/server";
import {
  assertWorkerAuthorized,
  WorkerAuthError,
} from "@/lib/worker/worker-auth";
import {
  assertDeepScanClaim,
  DeepScanClaimError,
  failDeepScanJob,
  getDeepScanJob,
  heartbeatDeepScanJob,
  updateDeepScanStage,
} from "@/lib/deep-scan/job-store";
import { storeFindings } from "@/lib/findings/findings-store";
import { saveRepositoryGraph } from "@/lib/repository-graph/graph-store";
import type { FindingsPayload } from "@/lib/findings/types";
import type { DeepScanStage } from "@/lib/deep-scan/types";
import { touchMarketplaceHealth } from "@/lib/okx/marketplace-telemetry";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Trusted Actions callback: ingest analyzer result bundle and mark READY / FAILED.
 * Customer code never executes here.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertWorkerAuthorized(request);
  } catch (err) {
    if (err instanceof WorkerAuthError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 401 }
      );
    }
    throw err;
  }

  const { id: jobId } = await context.params;
  let body: {
    workerId?: string;
    claimToken?: string;
    stage?: DeepScanStage;
    detail?: string;
    heartbeatOnly?: boolean;
    failureCode?: string;
    failureMessage?: string;
    terminal?: boolean;
    resultDigest?: string;
    sourceCommit?: string;
    findings?: FindingsPayload;
    graph?: {
      id: string;
      repository: string;
      branch: string;
      sourceCommit: string;
      projectRoot?: string;
      [key: string]: unknown;
    };
    coverage?: Record<string, unknown>;
    baseline?: Record<string, unknown>;
    resultSummary?: Record<string, unknown>;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", error: "JSON body required." },
      { status: 400 }
    );
  }

  const workerId = body.workerId?.trim();
  const claimToken = body.claimToken?.trim();
  if (!workerId || !claimToken) {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", error: "workerId and claimToken are required." },
      { status: 422 }
    );
  }

  const job = await getDeepScanJob(jobId);
  if (!job) {
    return NextResponse.json(
      { ok: false, code: "JOB_NOT_FOUND", error: "Deep-scan job not found." },
      { status: 404 }
    );
  }

  try {
    assertDeepScanClaim(job, workerId, claimToken);
  } catch (err) {
    if (err instanceof DeepScanClaimError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 409 }
      );
    }
    throw err;
  }

  if (body.heartbeatOnly) {
    const hb = await heartbeatDeepScanJob(jobId, workerId, body.detail, claimToken);
    return NextResponse.json({ ok: true, heartbeat: true, stage: hb?.stage, jobId });
  }

  if (body.failureCode || body.stage === "FAILED" || body.stage === "FAILED_TERMINAL" || body.stage === "FAILED_RETRYABLE") {
    const failed = await failDeepScanJob(
      jobId,
      body.failureCode || "ACTIONS_ANALYZER_FAILED",
      body.failureMessage || body.detail || "GitHub Actions analysis failed.",
      { terminal: body.terminal !== false && body.stage !== "FAILED_RETRYABLE" }
    );
    return NextResponse.json({ ok: true, failed: true, stage: failed?.stage, jobId });
  }

  if (body.stage && body.stage !== "READY" && body.stage !== "COMPLETED") {
    const updated = await updateDeepScanStage(jobId, body.stage, body.detail);
    await heartbeatDeepScanJob(jobId, workerId, body.detail, claimToken);
    return NextResponse.json({ ok: true, stage: updated?.stage, jobId });
  }

  // READY path — validate digest and persist findings/graph.
  if (!body.findings) {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", error: "findings payload required for READY ingest." },
      { status: 422 }
    );
  }

  const expectedCommit = job.sourceCommit || job.request.sourceCommit;
  if (body.sourceCommit && expectedCommit && body.sourceCommit !== expectedCommit) {
    return NextResponse.json(
      {
        ok: false,
        code: "SOURCE_COMMIT_MISMATCH",
        error: "Result source commit does not match the durable job pin.",
      },
      { status: 409 }
    );
  }

  const digest = createHash("sha256")
    .update(JSON.stringify({ scanId: body.findings.scanId, summary: body.findings.summary }))
    .digest("hex");
  if (body.resultDigest && body.resultDigest !== digest) {
    return NextResponse.json(
      { ok: false, code: "RESULT_DIGEST_MISMATCH", error: "Result digest validation failed." },
      { status: 409 }
    );
  }

  await storeFindings(body.findings);
  if (body.graph?.id) {
    try {
      await saveRepositoryGraph(body.graph as never);
    } catch {
      // Graph persistence is best-effort; findings remain authoritative for READY.
    }
  }

  const ready = await updateDeepScanStage(jobId, "READY", "GitHub Actions analysis complete", {
    findingsId: body.findings.scanId,
    graphId: body.graph?.id || job.graphId,
    coverage: body.coverage,
    baseline: body.baseline ?? {
      status: "NOT_RUN",
      verification: "SANDBOX_REQUIRED",
      reason: "READ_ONLY_FINDINGS",
    },
    resultSummary: body.resultSummary ?? {
      findings: body.findings.summary,
      workerMode: "github_actions_on_demand",
      resultDigest: digest,
    },
  });

  await touchMarketplaceHealth({
    activeWorkers: 0,
    activeWorkflowRuns: 0,
    lastSuccessfulWorkerRun: new Date().toISOString(),
  });

  return NextResponse.json({
    ok: true,
    ready: true,
    jobId,
    stage: ready?.stage,
    findingsId: body.findings.scanId,
    graphId: body.graph?.id,
    resultDigest: digest,
  });
}
