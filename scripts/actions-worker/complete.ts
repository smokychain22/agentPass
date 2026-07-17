/**
 * Trusted Actions complete job — signed callback; server resolves claimToken.
 * Never reads or transmits a raw claim token.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const WORK = "/tmp/repodiet-actions";
const WORKER_ID = "github-actions/ubuntu-latest";
const EXPECTED_WORKFLOW = "RepoDiet analysis worker";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function canonicalCallbackString(payload: {
  jobId: string;
  workflowRunId: string;
  workflowRunAttempt: string;
  workflowName: string;
  repository: string;
  completionNonce: string;
  timestamp: string;
  resultDigest?: string;
  stage?: string;
  code?: string;
}): string {
  return [
    payload.jobId,
    payload.workflowRunId,
    payload.workflowRunAttempt,
    payload.workflowName,
    payload.repository,
    payload.completionNonce,
    payload.timestamp,
    payload.resultDigest ?? "",
    payload.stage ?? "",
    payload.code ?? "",
  ].join("\n");
}

function sign(payload: Parameters<typeof canonicalCallbackString>[0], secret: string): string {
  return createHmac("sha256", secret).update(canonicalCallbackString(payload)).digest("hex");
}

async function postSigned(
  apiBase: string,
  callbackSecret: string,
  jobId: string,
  pathSuffix: "ingest" | "incident",
  body: Record<string, unknown>,
  signFields: Parameters<typeof canonicalCallbackString>[0]
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const signature = sign(signFields, callbackSecret);
  const res = await fetch(`${apiBase}/api/internal/actions/deep-scans/${jobId}/${pathSuffix}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-callback-secret": callbackSecret,
      "x-worker-callback-signature": `sha256=${signature}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

async function main(): Promise<void> {
  if (process.env.INPUT_ALREADY_CLAIMED === "true") {
    console.log("ALREADY_CLAIMED — complete job no-op.");
    return;
  }

  const callbackSecret = requireEnv("REPODIET_WORKER_CALLBACK_SECRET");
  const apiBase = requireEnv("INPUT_API_BASE_URL").replace(/\/$/, "");
  const jobId = requireEnv("INPUT_JOB_ID");
  const analyzeResult = process.env.INPUT_ANALYZE_RESULT?.trim() || "success";
  const requestId = process.env.INPUT_REQUEST_ID?.trim();
  const workflowRunId = requireEnv("INPUT_WORKFLOW_RUN_ID");
  const workflowRunAttempt = process.env.INPUT_WORKFLOW_RUN_ATTEMPT?.trim() || "1";
  const workflowName = process.env.INPUT_WORKFLOW_NAME?.trim() || EXPECTED_WORKFLOW;
  const repository =
    process.env.INPUT_WORKFLOW_REPOSITORY?.trim() || "smokychain22/agentPass";
  const claimHandle = process.env.INPUT_CLAIM_HANDLE?.trim() || "";

  // Refuse to proceed if a claim token was somehow injected into the environment.
  for (const banned of ["INPUT_CLAIM_TOKEN", "CLAIM_TOKEN", "REPODIET_CLAIM_TOKEN"]) {
    if (process.env[banned]?.trim()) {
      throw new Error(`SECURITY: ${banned} must not be present in the complete job.`);
    }
  }

  const completionNonce = `cn_${randomBytes(18).toString("hex")}`;
  const timestamp = new Date().toISOString();

  const bundlePath = path.join(WORK, "result-bundle.json");
  let bundle: Record<string, unknown> | null = null;
  try {
    bundle = JSON.parse(await fs.readFile(bundlePath, "utf8")) as Record<string, unknown>;
  } catch {
    bundle = null;
  }

  // Claim failed or analyze never produced a result.
  if (analyzeResult !== "success" || !bundle) {
    const code =
      analyzeResult === "skipped" || analyzeResult === ""
        ? claimHandle
          ? "ANALYZE_FAILED"
          : "CLAIM_FAILED"
        : bundle
          ? "ACTIONS_ANALYZER_FAILED"
          : "RESULT_ARTIFACT_MISSING";
    const signFields = {
      jobId,
      workflowRunId,
      workflowRunAttempt,
      workflowName,
      repository,
      completionNonce,
      timestamp,
      stage: "FAILED_RETRYABLE",
      code,
    };
    // Prefer incident for pre-claim / claim-stage; ingest for post-claim failures with handle.
    if (!claimHandle) {
      const incident = await postSigned(apiBase, callbackSecret, jobId, "incident", {
        code,
        message:
          code === "RESULT_ARTIFACT_MISSING"
            ? "Analyzer result artifact missing."
            : `Structured Actions failure (${code}); analyzeResult=${analyzeResult}`,
        terminal: false,
        workflowRunId,
        workflowRunUrl: process.env.INPUT_WORKFLOW_RUN_URL?.trim(),
        requestId,
        stage: code === "CLAIM_FAILED" ? "claim" : "complete",
        completionNonce,
        timestamp,
        workflowRunAttempt,
        workflowName,
        repository,
      }, signFields);
      if (!incident.ok) {
        throw new Error(
          `incident callback failed (${incident.status}): ${JSON.stringify(incident.json).slice(0, 200)}`
        );
      }
      console.log(JSON.stringify({ event: "complete_structured_incident", jobId, code, analyzeResult }));
      return;
    }

    const failed = await postSigned(
      apiBase,
      callbackSecret,
      jobId,
      "ingest",
      {
        workerId: WORKER_ID,
        claimHandle,
        workflowRunId,
        workflowRunAttempt,
        workflowName,
        repository,
        completionNonce,
        timestamp,
        stage: "FAILED_RETRYABLE",
        failureCode: code,
        failureMessage:
          code === "RESULT_ARTIFACT_MISSING"
            ? "Analyzer result artifact missing."
            : "Analyzer job failed.",
        terminal: false,
        detail: `analyzeResult=${analyzeResult}`,
      },
      signFields
    );
    if (!failed.ok) {
      throw new Error(
        `ingest failure callback failed (${failed.status}): ${JSON.stringify(failed.json).slice(0, 200)}`
      );
    }
    console.log(JSON.stringify({ event: "complete_failed_structured", jobId, code, analyzeResult }));
    return;
  }

  // Analyze already posted live progress; complete records persistence + READY.
  const persistStarted = Date.now();
  {
    const stage = "PERSISTING_RESULTS";
    const stageNonce = `cn_${randomBytes(12).toString("hex")}`;
    const stageTs = new Date().toISOString();
    const signFields = {
      jobId,
      workflowRunId,
      workflowRunAttempt,
      workflowName,
      repository,
      completionNonce: stageNonce,
      timestamp: stageTs,
      stage,
    };
    await postSigned(
      apiBase,
      callbackSecret,
      jobId,
      "ingest",
      {
        workerId: WORKER_ID,
        claimHandle,
        workflowRunId,
        workflowRunAttempt,
        workflowName,
        repository,
        completionNonce: stageNonce,
        timestamp: stageTs,
        stage,
        detail: "Saving repository graph and findings",
      },
      signFields
    );
  }

  const timingBreakdown = {
    ...((bundle.timingBreakdown as Record<string, number>) || {}),
    ...(((bundle.resultSummary as { timingBreakdown?: Record<string, number> } | undefined)
      ?.timingBreakdown) || {}),
    completionCallbackMs: Math.max(0, Date.now() - persistStarted),
  };

  const resultDigest = String(bundle.resultDigest || "");
  const readyNonce = completionNonce;
  const readyTs = timestamp;
  const signFields = {
    jobId,
    workflowRunId,
    workflowRunAttempt,
    workflowName,
    repository,
    completionNonce: readyNonce,
    timestamp: readyTs,
    resultDigest,
    stage: "READY",
  };

  const resultSummary = {
    ...((bundle.resultSummary as Record<string, unknown>) || {}),
    timingBreakdown,
  };

  const ready = await postSigned(
    apiBase,
    callbackSecret,
    jobId,
    "ingest",
    {
      workerId: WORKER_ID,
      claimHandle,
      workflowRunId,
      workflowRunAttempt,
      workflowName,
      repository,
      completionNonce: readyNonce,
      timestamp: readyTs,
      stage: "READY",
      sourceCommit: bundle.sourceCommit,
      resultDigest,
      findings: bundle.findings,
      graph: bundle.graph,
      coverage: bundle.coverage,
      baseline: bundle.baseline,
      resultSummary,
    },
    signFields
  );

  if (!ready.ok) {
    throw new Error(
      `READY ingest failed (${ready.status}): ${JSON.stringify(ready.json).slice(0, 300)}`
    );
  }

  console.log(
    JSON.stringify({
      event: "complete_ready",
      jobId,
      findingsId: (bundle.findings as { scanId?: string })?.scanId,
      claimTokenTransport: "SERVER_SIDE_ONLY",
    })
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
