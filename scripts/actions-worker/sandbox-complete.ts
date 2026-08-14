/**
 * Trusted Actions sandbox-complete job.
 * Secrets: REPODIET_WORKER_CALLBACK_SECRET only. Signs and posts the untrusted
 * validate job's raw result — the server independently re-verifies it before
 * ever recording "passed" (see sandbox-run-verification.ts). Never reads or
 * transmits a raw claim token.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, createHmac, randomBytes } from "node:crypto";

const WORK = "/tmp/repodiet-actions";
const WORKER_ID = "github-actions/ubuntu-latest";
const EXPECTED_WORKFLOW = "RepoDiet sandbox validation worker";

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

type ResultBundle = {
  runId?: string;
  baseCommitSha?: string;
  status?: "passed" | "failed";
  gitApplyExitCode?: number;
  gitApplyStderr?: string;
  validatedPaths?: string[];
  patchHash?: string;
  gitVersion?: string;
  error?: string;
  repositoryVerification?: unknown;
};

type Manifest = { runId: string; baseCommitSha: string };

async function main(): Promise<void> {
  if (process.env.INPUT_ALREADY_CLAIMED === "true") {
    console.log("ALREADY_CLAIMED — complete job no-op.");
    return;
  }
  const claimHandle = process.env.INPUT_CLAIM_HANDLE?.trim() || "";
  if (!claimHandle) {
    // Claim itself never succeeded — nothing legitimate to report. The
    // run's own server-side redispatch cadence will retry with a fresh claim.
    console.log("No claim handle — claim job did not succeed; skipping completion report.");
    return;
  }

  for (const banned of ["INPUT_CLAIM_TOKEN", "CLAIM_TOKEN", "REPODIET_CLAIM_TOKEN"]) {
    if (process.env[banned]?.trim()) {
      throw new Error(`SECURITY: ${banned} must not be present in the complete job.`);
    }
  }

  const callbackSecret = requireEnv("REPODIET_WORKER_CALLBACK_SECRET");
  const apiBase = requireEnv("INPUT_API_BASE_URL").replace(/\/$/, "");
  const runId = requireEnv("INPUT_RUN_ID");
  const validateResult = process.env.INPUT_VALIDATE_RESULT?.trim() || "failure";
  const workflowRunId = requireEnv("INPUT_WORKFLOW_RUN_ID");
  const workflowRunAttempt = process.env.INPUT_WORKFLOW_RUN_ATTEMPT?.trim() || "1";
  const workflowName = process.env.INPUT_WORKFLOW_NAME?.trim() || EXPECTED_WORKFLOW;
  const repository = process.env.INPUT_WORKFLOW_REPOSITORY?.trim() || "smokychain22/agentPass";

  let manifest: Manifest | null = null;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(WORK, "job-manifest.json"), "utf8")) as Manifest;
  } catch {
    manifest = null;
  }

  let bundle: ResultBundle | null = null;
  if (validateResult === "success") {
    try {
      bundle = JSON.parse(await fs.readFile(path.join(WORK, "sandbox-result-bundle.json"), "utf8")) as ResultBundle;
    } catch {
      bundle = null;
    }
  }

  const report: ResultBundle =
    bundle ??
    {
      runId,
      baseCommitSha: manifest?.baseCommitSha,
      status: "failed",
      gitApplyExitCode: 1,
      error: `Sandbox validate job did not produce a result (validateResult=${validateResult}).`,
    };

  const stage = report.status === "passed" ? "passed" : "failed";
  const resultDigest = createHash("sha256")
    .update(JSON.stringify({ stage, baseCommitSha: report.baseCommitSha ?? "", validatedPaths: report.validatedPaths ?? [] }))
    .digest("hex");

  const completionNonce = `cn_${randomBytes(18).toString("hex")}`;
  const timestamp = new Date().toISOString();
  const signFields = {
    jobId: runId,
    workflowRunId,
    workflowRunAttempt,
    workflowName,
    repository,
    completionNonce,
    timestamp,
    resultDigest,
    stage,
  };
  const signature = createHmac("sha256", callbackSecret)
    .update(canonicalCallbackString(signFields))
    .digest("hex");

  const res = await fetch(`${apiBase}/api/internal/actions/sandbox-runs/${runId}/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-callback-secret": callbackSecret,
      "x-worker-callback-signature": `sha256=${signature}`,
    },
    body: JSON.stringify({
      workerId: WORKER_ID,
      claimHandle,
      workflowRunId,
      workflowRunAttempt,
      workflowName,
      repository,
      completionNonce,
      timestamp,
      stage,
      resultDigest,
      baseCommitSha: report.baseCommitSha,
      validatedPaths: report.validatedPaths,
      gitApplyExitCode: report.gitApplyExitCode,
      gitApplyStderr: report.gitApplyStderr,
      patchHash: report.patchHash,
      gitVersion: report.gitVersion,
      error: report.error,
      repositoryVerification: report.repositoryVerification,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`ingest failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }

  console.log(JSON.stringify({ event: "sandbox_complete_ok", runId, stage, response: json }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
