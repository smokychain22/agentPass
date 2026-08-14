/**
 * Trusted Actions sandbox-claim job.
 * Secrets: REPODIET_WORKER_API_KEY only. Exchanges a one-time dispatch nonce for
 * a claimHandle + the public commit-pinned archive URL + the exact edits to
 * apply. Raw claimToken never leaves the server.
 */
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";

const WORK = "/tmp/repodiet-actions";
const WORKER_ID = "github-actions/ubuntu-latest";
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

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

async function main(): Promise<void> {
  const apiKey = requireEnv("REPODIET_WORKER_API_KEY");
  const apiBase = requireEnv("INPUT_API_BASE_URL").replace(/\/$/, "");
  const runId = requireEnv("INPUT_RUN_ID");
  const dispatchNonce = requireEnv("INPUT_DISPATCH_NONCE");
  const workflowRunId = process.env.INPUT_WORKFLOW_RUN_ID?.trim() || "";
  const workflowRunUrl = process.env.INPUT_WORKFLOW_RUN_URL?.trim();
  const workflowRunAttempt = process.env.INPUT_WORKFLOW_RUN_ATTEMPT?.trim() || "1";
  const workflowName = process.env.INPUT_WORKFLOW_NAME?.trim() || "RepoDiet sandbox validation worker";
  const repository = process.env.INPUT_WORKFLOW_REPOSITORY?.trim() || "smokychain22/agentPass";

  await fs.mkdir(WORK, { recursive: true });

  const res = await fetch(`${apiBase}/api/internal/actions/sandbox-runs/claim-exchange`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      runId,
      dispatchNonce,
      workerId: WORKER_ID,
      workflowRunId,
      workflowRunUrl,
      workflowRunAttempt,
      workflowName,
      workflowRepository: repository,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    alreadyClaimed?: boolean;
    code?: string;
    error?: string;
    claimHandle?: string;
    runId?: string;
    archiveUrl?: string | null;
    baseCommitSha?: string;
    repositoryOwner?: string;
    repositoryName?: string;
    branch?: string;
    edits?: Array<{ path: string; content: string }>;
    changeOperations?: Array<{ filePath: string; type: string }>;
  };

  if (!res.ok || !json.ok) {
    if (json.code === "ALREADY_CLAIMED" || json.alreadyClaimed) {
      await setOutput("already_claimed", "true");
      await setOutput("claim_handle", "");
      console.log("ALREADY_CLAIMED — exiting successfully (losing workflow).");
      return;
    }
    throw new Error(json.error || `claim-exchange failed (${res.status})`);
  }

  if (json.alreadyClaimed && !json.archiveUrl) {
    // Idempotent re-entry (retry of this exact workflow run) without a fresh
    // archive resolution — should not normally happen, but fail safe.
    throw new Error("claim-exchange returned alreadyClaimed without an archive URL.");
  }

  if (!json.archiveUrl) {
    throw new Error("claim-exchange returned no archive URL.");
  }

  await setOutput("already_claimed", "false");
  await setOutput("claim_handle", json.claimHandle || "");

  // Download the public, commit-pinned archive here (trusted job) so the
  // untrusted validate job needs zero outbound network access at all.
  const archiveRes = await fetch(json.archiveUrl, {
    headers: { "user-agent": "RepoDiet-Sandbox-Actions-Worker/1.0" },
    redirect: "follow",
  });
  if (!archiveRes.ok || !archiveRes.body) {
    throw new Error(`ARCHIVE_DOWNLOAD_FAILED: ${archiveRes.status}`);
  }
  const len = Number(archiveRes.headers.get("content-length") || "0");
  if (len > MAX_ARCHIVE_BYTES) {
    throw new Error(`REPOSITORY_TOO_LARGE: archive Content-Length ${len} exceeds ${MAX_ARCHIVE_BYTES}`);
  }
  const zipPath = path.join(WORK, "archive.zip");
  const nodeStream = Readable.fromWeb(archiveRes.body as import("node:stream/web").ReadableStream);
  let downloaded = 0;
  nodeStream.on("data", (chunk: Buffer) => {
    downloaded += chunk.length;
    if (downloaded > MAX_ARCHIVE_BYTES) {
      nodeStream.destroy(new Error(`REPOSITORY_TOO_LARGE: downloaded > ${MAX_ARCHIVE_BYTES}`));
    }
  });
  await pipeline(nodeStream, createWriteStream(zipPath));

  const manifest = {
    runId: json.runId ?? runId,
    baseCommitSha: json.baseCommitSha,
    repositoryOwner: json.repositoryOwner,
    repositoryName: json.repositoryName,
    branch: json.branch,
    edits: json.edits ?? [],
    changeOperations: json.changeOperations ?? [],
  };
  await fs.writeFile(path.join(WORK, "job-manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(
    JSON.stringify({
      event: "sandbox_claim_ok",
      runId: manifest.runId,
      repository: `${manifest.repositoryOwner}/${manifest.repositoryName}`,
      baseCommitSha: manifest.baseCommitSha,
      operationCount: manifest.changeOperations.length,
      archiveBytes: downloaded,
      claimTokenTransport: "SERVER_SIDE_ONLY",
    })
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
