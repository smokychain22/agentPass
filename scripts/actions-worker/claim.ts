/**
 * Trusted Actions claim job.
 * Secrets: REPODIET_WORKER_API_KEY (+ optional callback secret).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const WORK = "/tmp/repodiet-actions";
const WORKER_ID = "github-actions/ubuntu-latest";

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

async function reportIncident(
  apiBase: string,
  apiKey: string,
  jobId: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await fetch(`${apiBase}/api/internal/actions/deep-scans/${jobId}/incident`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...(process.env.REPODIET_WORKER_CALLBACK_SECRET
          ? { "x-worker-callback-secret": process.env.REPODIET_WORKER_CALLBACK_SECRET }
          : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(
      "incident callback failed:",
      err instanceof Error ? err.message : err
    );
  }
}

async function main(): Promise<void> {
  const apiKey = requireEnv("REPODIET_WORKER_API_KEY");
  const apiBase = requireEnv("INPUT_API_BASE_URL").replace(/\/$/, "");
  const jobId = requireEnv("INPUT_JOB_ID");
  const dispatchNonce = requireEnv("INPUT_DISPATCH_NONCE");
  const workflowRunId = process.env.INPUT_WORKFLOW_RUN_ID?.trim();
  const workflowRunUrl = process.env.INPUT_WORKFLOW_RUN_URL?.trim();
  const requestId = process.env.INPUT_REQUEST_ID?.trim();

  await fs.mkdir(WORK, { recursive: true });

  const res = await fetch(`${apiBase}/api/internal/actions/claim-exchange`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(process.env.REPODIET_WORKER_CALLBACK_SECRET
        ? { "x-worker-callback-secret": process.env.REPODIET_WORKER_CALLBACK_SECRET }
        : {}),
    },
    body: JSON.stringify({
      jobId,
      dispatchNonce,
      workerId: WORKER_ID,
      workflowRunId,
      workflowRunUrl,
      workflowRunAttempt: process.env.INPUT_WORKFLOW_RUN_ATTEMPT?.trim(),
      workflowName: process.env.INPUT_WORKFLOW_NAME?.trim(),
      workflowRepository: process.env.INPUT_WORKFLOW_REPOSITORY?.trim(),
      workflowServerUrl: process.env.INPUT_WORKFLOW_SERVER_URL?.trim(),
    }),
  });

  const json = (await res.json()) as {
    ok?: boolean;
    alreadyClaimed?: boolean;
    code?: string;
    claimToken?: string;
    error?: string;
    missingFields?: string[];
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
    };
    archive?: {
      strategy?: string;
      url?: string | null;
      sourceCommit?: string;
      maxBytes?: number;
      repositoryFullName?: string;
    };
  };

  if (!res.ok || !json.ok) {
    if (json.code === "ALREADY_CLAIMED" || json.alreadyClaimed) {
      await setOutput("already_claimed", "true");
      await setOutput("claim_token", "");
      await setOutput("source_commit", "");
      await setOutput("archive_url", "");
      console.log("ALREADY_CLAIMED — exiting successfully (losing workflow).");
      return;
    }

    await reportIncident(apiBase, apiKey, jobId, {
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

  // GitHub Actions strips job outputs that were registered via ::add-mask::.
  // Pass the claim token to the trusted complete job via a private artifact instead.
  await setOutput("already_claimed", json.alreadyClaimed ? "true" : "false");
  await setOutput("source_commit", String(sourceCommit));
  await setOutput("archive_url", archiveUrl);
  await setOutput("has_claim_secret", json.claimToken ? "true" : "false");

  if (json.claimToken) {
    await fs.writeFile(
      path.join(WORK, "claim-secret.json"),
      JSON.stringify({ claimToken: json.claimToken, jobId, workerId: WORKER_ID }),
      { mode: 0o600 }
    );
  }

  if (json.alreadyClaimed) {
    console.log("ALREADY_CLAIMED by this worker identity — skip analyze.");
    return;
  }

  if (!archiveUrl) {
    await reportIncident(apiBase, apiKey, jobId, {
      code: "ARCHIVE_PREPARATION_FAILED",
      message:
        "No public archive URL returned (repository identity incomplete or private archive not ready).",
      terminal: false,
      workflowRunId,
      workflowRunUrl,
      requestId,
      stage: "archive",
    });
    throw new Error(
      "ARCHIVE_PREPARATION_FAILED: no public archive URL (identity incomplete or private archive required)."
    );
  }

  const zipPath = path.join(WORK, "archive.zip");
  const archiveRes = await fetch(archiveUrl, {
    headers: { "user-agent": "RepoDiet-Actions-Worker/1.0" },
    redirect: "follow",
  });
  if (!archiveRes.ok || !archiveRes.body) {
    await reportIncident(apiBase, apiKey, jobId, {
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
    await reportIncident(apiBase, apiKey, jobId, {
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

  const manifest = {
    jobId,
    workerId: WORKER_ID,
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
    requestId,
  };
  await fs.writeFile(path.join(WORK, "job-manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(
    JSON.stringify({
      event: "actions_claim_ok",
      jobId,
      workerId: WORKER_ID,
      sourceCommit: manifest.sourceCommit,
      repositoryFullName: manifest.repositoryFullName,
      archiveStrategy: manifest.archiveStrategy,
      bytes: downloaded,
    })
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
