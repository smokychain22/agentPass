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

function setOutput(name: string, value: string): void {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) {
    console.log(`output ${name}=${value}`);
    return;
  }
  void fs.appendFile(out, `${name}=${value}\n`);
}

async function main(): Promise<void> {
  const apiKey = requireEnv("REPODIET_WORKER_API_KEY");
  const apiBase = requireEnv("INPUT_API_BASE_URL").replace(/\/$/, "");
  const jobId = requireEnv("INPUT_JOB_ID");
  const dispatchNonce = requireEnv("INPUT_DISPATCH_NONCE");
  const workflowRunId = process.env.INPUT_WORKFLOW_RUN_ID?.trim();
  const workflowRunUrl = process.env.INPUT_WORKFLOW_RUN_URL?.trim();

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
    }),
  });

  const json = (await res.json()) as {
    ok?: boolean;
    alreadyClaimed?: boolean;
    code?: string;
    claimToken?: string;
    error?: string;
    job?: {
      sourceCommit?: string;
      repoUrl?: string;
      branch?: string;
      projectRoot?: string;
      structureScanId?: string;
      id?: string;
    };
    archive?: { url?: string | null; sourceCommit?: string; maxBytes?: number };
  };

  if (!res.ok || !json.ok) {
    if (json.code === "ALREADY_CLAIMED" || json.alreadyClaimed) {
      setOutput("already_claimed", "true");
      setOutput("claim_token", "");
      setOutput("source_commit", "");
      setOutput("archive_url", "");
      console.log("ALREADY_CLAIMED — exiting successfully (losing workflow).");
      return;
    }
    throw new Error(json.error || `claim-exchange failed (${res.status})`);
  }

  if (json.alreadyClaimed) {
    setOutput("already_claimed", "true");
    setOutput("claim_token", json.claimToken || "");
    setOutput("source_commit", json.job?.sourceCommit || json.archive?.sourceCommit || "");
    setOutput("archive_url", json.archive?.url || "");
    console.log("ALREADY_CLAIMED by this worker identity — skip analyze.");
    return;
  }

  const archiveUrl = json.archive?.url;
  if (!archiveUrl) {
    throw new Error("No archive URL returned (private archive exchange not configured).");
  }

  const zipPath = path.join(WORK, "archive.zip");
  const archiveRes = await fetch(archiveUrl, {
    headers: { "user-agent": "RepoDiet-Actions-Worker/1.0" },
    redirect: "follow",
  });
  if (!archiveRes.ok || !archiveRes.body) {
    throw new Error(`Archive download failed (${archiveRes.status})`);
  }

  const maxBytes = json.archive?.maxBytes ?? 100 * 1024 * 1024;
  // Content-Length when present; otherwise stream with a hard cap via counter in pipeline consumer.
  const len = Number(archiveRes.headers.get("content-length") || "0");
  if (len > maxBytes) {
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
    // claimToken must NEVER appear in artifacts consumed by the untrusted analyze job.
    sourceCommit: json.job?.sourceCommit || json.archive?.sourceCommit,
    repoUrl: json.job?.repoUrl,
    branch: json.job?.branch,
    projectRoot: json.job?.projectRoot || ".",
    structureScanId: json.job?.structureScanId,
    workflowRunId,
    workflowRunUrl,
    requestId: process.env.INPUT_REQUEST_ID,
  };
  await fs.writeFile(path.join(WORK, "job-manifest.json"), JSON.stringify(manifest, null, 2));

  if (json.claimToken) {
    console.log(`::add-mask::${json.claimToken}`);
  }

  setOutput("already_claimed", "false");
  setOutput("claim_token", json.claimToken || "");
  setOutput("source_commit", String(manifest.sourceCommit || ""));
  setOutput("archive_url", archiveUrl);

  console.log(
    JSON.stringify({
      event: "actions_claim_ok",
      jobId,
      workerId: WORKER_ID,
      sourceCommit: manifest.sourceCommit,
      bytes: downloaded,
    })
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
