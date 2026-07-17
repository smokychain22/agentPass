/**
 * Trusted Actions claim job.
 * Secrets: REPODIET_WORKER_API_KEY (+ optional callback secret for progress / incident).
 * Raw claimToken never leaves the server — only opaque claimHandle + progressToken are returned.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createHmac, randomBytes } from "node:crypto";

const WORK = "/tmp/repodiet-actions";
const WORKER_ID = "github-actions/ubuntu-latest";
const EXPECTED_WORKFLOW = "RepoDiet analysis worker";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function setOutput(name: string, value: string): Promise<void> {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) {
    console.log(`output ${name}=${value}`);
    return;
  }
  await fs.appendFile(out, `${name}=${value}\n`);
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

async function postSignedProgress(
  apiBase: string,
  callbackSecret: string,
  jobId: string,
  fields: {
    stage: string;
    progressMessage: string;
    workflowRunId: string;
    workflowRunAttempt: string;
    workflowName: string;
    repository: string;
    claimHandle?: string;
    completedUnits?: number;
    totalUnits?: number;
    timingPatch?: Record<string, number>;
  }
): Promise<void> {
  const completionNonce = `cn_${randomBytes(12).toString("hex")}`;
  const timestamp = new Date().toISOString();
  const signFields = {
    jobId,
    workflowRunId: fields.workflowRunId,
    workflowRunAttempt: fields.workflowRunAttempt,
    workflowName: fields.workflowName,
    repository: fields.repository,
    completionNonce,
    timestamp,
    stage: fields.stage,
  };
  const signature = createHmac("sha256", callbackSecret)
    .update(canonicalCallbackString(signFields))
    .digest("hex");
  const res = await fetch(`${apiBase}/api/internal/actions/deep-scans/${jobId}/progress`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-callback-secret": callbackSecret,
      "x-worker-callback-signature": `sha256=${signature}`,
    },
    body: JSON.stringify({
      workerId: WORKER_ID,
      claimHandle: fields.claimHandle,
      workflowRunId: fields.workflowRunId,
      workflowRunAttempt: fields.workflowRunAttempt,
      workflowName: fields.workflowName,
      repository: fields.repository,
      completionNonce,
      timestamp,
      stage: fields.stage,
      detail: fields.progressMessage,
      progressMessage: fields.progressMessage,
      completedUnits: fields.completedUnits,
      totalUnits: fields.totalUnits,
      timingPatch: fields.timingPatch,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`progress ${fields.stage} failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

async function reportIncident(
  apiBase: string,
  jobId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const callbackSecret = process.env.REPODIET_WORKER_CALLBACK_SECRET?.trim();
  const apiKey = process.env.REPODIET_WORKER_API_KEY?.trim();
  try {
    await fetch(`${apiBase}/api/internal/actions/deep-scans/${jobId}/incident`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        ...(callbackSecret ? { "x-worker-callback-secret": callbackSecret } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("incident callback failed:", err instanceof Error ? err.message : err);
  }
}

async function main(): Promise<void> {
  const claimStarted = Date.now();
  const apiKey = requireEnv("REPODIET_WORKER_API_KEY");
  const apiBase = requireEnv("INPUT_API_BASE_URL").replace(/\/$/, "");
  const jobId = requireEnv("INPUT_JOB_ID");
  const dispatchNonce = requireEnv("INPUT_DISPATCH_NONCE");
  const workflowRunId = process.env.INPUT_WORKFLOW_RUN_ID?.trim() || "";
  const workflowRunUrl = process.env.INPUT_WORKFLOW_RUN_URL?.trim();
  const workflowRunAttempt = process.env.INPUT_WORKFLOW_RUN_ATTEMPT?.trim() || "1";
  const workflowName = process.env.INPUT_WORKFLOW_NAME?.trim() || EXPECTED_WORKFLOW;
  const repository =
    process.env.INPUT_WORKFLOW_REPOSITORY?.trim() || "smokychain22/agentPass";
  const requestId = process.env.INPUT_REQUEST_ID?.trim();
  const callbackSecret = process.env.REPODIET_WORKER_CALLBACK_SECRET?.trim();

  await fs.mkdir(WORK, { recursive: true });

  const archivePrepStarted = Date.now();
  const res = await fetch(`${apiBase}/api/internal/actions/claim-exchange`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(callbackSecret ? { "x-worker-callback-secret": callbackSecret } : {}),
    },
    body: JSON.stringify({
      jobId,
      dispatchNonce,
      workerId: WORKER_ID,
      workflowRunId,
      workflowRunUrl,
      workflowRunAttempt,
      workflowName,
      workflowRepository: repository,
      workflowServerUrl: process.env.INPUT_WORKFLOW_SERVER_URL?.trim(),
    }),
  });

  const json = (await res.json()) as {
    ok?: boolean;
    alreadyClaimed?: boolean;
    code?: string;
    claimHandle?: string;
    claimToken?: string;
    progressToken?: string;
    error?: string;
    job?: {
      sourceCommit?: string;
      repoUrl?: string;
      branch?: string;
      projectRoot?: string;
      structureScanId?: string;
      id?: string;
      repositoryOwner?: string;
      repositoryName?: string;
      repositoryFullName?: string;
      claimHandle?: string;
    };
    archive?: {
      strategy?: string;
      url?: string | null;
      sourceCommit?: string;
      maxBytes?: number;
      repositoryFullName?: string;
    };
  };

  // Hard fail if the server ever leaks a claimToken into this response.
  if (json.claimToken) {
    throw new Error("SECURITY: claim-exchange must not return claimToken to the runner.");
  }

  if (!res.ok || !json.ok) {
    if (json.code === "ALREADY_CLAIMED" || json.alreadyClaimed) {
      await setOutput("already_claimed", "true");
      await setOutput("source_commit", "");
      await setOutput("archive_url", "");
      await setOutput("claim_handle", "");
      console.log("ALREADY_CLAIMED — exiting successfully (losing workflow).");
      return;
    }

    await reportIncident(apiBase, jobId, {
      code: json.code || "CLAIM_EXCHANGE_FAILED",
      message: json.error || `claim-exchange failed (${res.status})`,
      terminal: json.code === "REPOSITORY_IDENTITY_INCOMPLETE",
      workflowRunId,
      workflowRunUrl,
      requestId,
      stage: "claim",
    });
    throw new Error(json.error || `claim-exchange failed (${res.status})`);
  }

  const sourceCommit = json.job?.sourceCommit || json.archive?.sourceCommit || "";
  const archiveUrl = json.archive?.url || "";
  const claimHandle = json.claimHandle || json.job?.claimHandle || "";
  const progressToken = json.progressToken || "";

  await setOutput("already_claimed", json.alreadyClaimed ? "true" : "false");
  await setOutput("source_commit", String(sourceCommit));
  await setOutput("archive_url", archiveUrl);
  await setOutput("claim_handle", claimHandle);

  if (json.alreadyClaimed) {
    console.log("ALREADY_CLAIMED by this worker identity — skip analyze.");
    return;
  }

  const progressBase = {
    workflowRunId,
    workflowRunAttempt,
    workflowName,
    repository,
    claimHandle,
  };

  if (callbackSecret && workflowRunId) {
    await postSignedProgress(apiBase, callbackSecret, jobId, {
      ...progressBase,
      stage: "PREPARING_ARCHIVE",
      progressMessage: "Preparing repository archive",
      timingPatch: { claimMs: Math.max(0, Date.now() - claimStarted) },
    });
  }

  if (!archiveUrl) {
    await reportIncident(apiBase, jobId, {
      code: "ARCHIVE_PREPARATION_FAILED",
      message: "No public archive URL returned.",
      terminal: false,
      workflowRunId,
      workflowRunUrl,
      requestId,
      stage: "archive",
    });
    throw new Error("ARCHIVE_PREPARATION_FAILED: no public archive URL.");
  }

  const archivePrepMs = Math.max(0, Date.now() - archivePrepStarted);
  if (callbackSecret && workflowRunId) {
    await postSignedProgress(apiBase, callbackSecret, jobId, {
      ...progressBase,
      stage: "DOWNLOADING_ARCHIVE",
      progressMessage: "Downloading commit-pinned source",
      timingPatch: { archivePreparationMs: archivePrepMs },
    });
  }

  const downloadStarted = Date.now();
  const zipPath = path.join(WORK, "archive.zip");
  const archiveRes = await fetch(archiveUrl, {
    headers: { "user-agent": "RepoDiet-Actions-Worker/1.0" },
    redirect: "follow",
  });
  if (!archiveRes.ok || !archiveRes.body) {
    await reportIncident(apiBase, jobId, {
      code: "ARCHIVE_DOWNLOAD_FAILED",
      message: `Archive download failed (${archiveRes.status})`,
      terminal: false,
      workflowRunId,
      workflowRunUrl,
      requestId,
      stage: "archive",
    });
    throw new Error(`Archive download failed (${archiveRes.status})`);
  }

  const maxBytes = json.archive?.maxBytes ?? 100 * 1024 * 1024;
  const len = Number(archiveRes.headers.get("content-length") || "0");
  if (len > maxBytes) {
    await reportIncident(apiBase, jobId, {
      code: "REPOSITORY_TOO_LARGE",
      message: `Archive Content-Length ${len} exceeds ${maxBytes}`,
      terminal: true,
      workflowRunId,
      workflowRunUrl,
      requestId,
      stage: "archive",
    });
    throw new Error(`REPOSITORY_TOO_LARGE: archive Content-Length ${len} exceeds ${maxBytes}`);
  }

  const nodeStream = Readable.fromWeb(archiveRes.body as import("node:stream/web").ReadableStream);
  let downloaded = 0;
  nodeStream.on("data", (chunk: Buffer) => {
    downloaded += chunk.length;
    if (downloaded > maxBytes) {
      nodeStream.destroy(new Error(`REPOSITORY_TOO_LARGE: downloaded > ${maxBytes}`));
    }
  });
  await pipeline(nodeStream, createWriteStream(zipPath));
  const archiveDownloadMs = Math.max(0, Date.now() - downloadStarted);

  if (callbackSecret && workflowRunId) {
    await postSignedProgress(apiBase, callbackSecret, jobId, {
      ...progressBase,
      stage: "ARCHIVE_READY",
      progressMessage: "Repository archive ready for analysis",
      timingPatch: { archiveDownloadMs },
    });
  }

  // Sanitized manifest only — never claimToken / API keys / callback secrets.
  // progressToken is a scoped analyze-only credential (hashed server-side).
  const manifest = {
    jobId,
    workerId: WORKER_ID,
    claimHandle,
    progressToken: progressToken || undefined,
    apiBaseUrl: apiBase,
    sourceCommit,
    repoUrl: json.job?.repoUrl,
    branch: json.job?.branch,
    projectRoot: json.job?.projectRoot || ".",
    structureScanId: json.job?.structureScanId,
    repositoryOwner: json.job?.repositoryOwner,
    repositoryName: json.job?.repositoryName,
    repositoryFullName: json.job?.repositoryFullName || json.archive?.repositoryFullName,
    archiveStrategy: json.archive?.strategy || "PUBLIC_ARCHIVE",
    workflowRunId,
    workflowRunUrl,
    workflowRunAttempt,
    workflowName,
    workflowRepository: repository,
    requestId,
    timingSeed: {
      claimMs: Math.max(0, Date.now() - claimStarted),
      archivePreparationMs: archivePrepMs,
      archiveDownloadMs,
    },
  };
  await fs.writeFile(path.join(WORK, "job-manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(
    JSON.stringify({
      event: "actions_claim_ok",
      jobId,
      workerId: WORKER_ID,
      claimHandle,
      sourceCommit: manifest.sourceCommit,
      repositoryFullName: manifest.repositoryFullName,
      archiveStrategy: manifest.archiveStrategy,
      bytes: downloaded,
      claimTokenTransport: "SERVER_SIDE_ONLY",
      progressTokenIssued: Boolean(progressToken),
    })
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
