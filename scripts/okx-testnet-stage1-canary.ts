#!/usr/bin/env npx tsx
/**
 * Stage 1 OKX testnet engineering canary (NO PAYMENT / NO SIGNING).
 *
 * - Runs the exact OKX reviewer prompt path three times with fresh task IDs
 * - Proves acknowledgement < 10s, deep-scan 200, dispatch, worker claim, analysis
 * - Stops before any payment signature
 * - Aborts if a payment challenge references mainnet (eip155:196 / real USDT)
 *
 * Usage:
 *   REPODIET_BASE_URL=https://…-preview.vercel.app npx tsx scripts/okx-testnet-stage1-canary.ts
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";

const BASE = (process.env.REPODIET_BASE_URL || "").replace(/\/$/, "");
const REPO = "https://github.com/velz-cmd/repodiet-e2e-test";
const BRANCH = "main";
const MAINNET_NETWORK = "eip155:196";
const MAINNET_ASSET = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const ARTIFACT =
  process.env.REPODIET_CANARY_ARTIFACT ||
  "/opt/cursor/artifacts/okx-testnet-stage1-canary.json";

const REVIEWER_PROMPT_1 =
  "I would like to create a repository cleanup task using Agent ID 5283.";
const REVIEWER_PROMPT_2 = [
  "Repository:",
  REPO,
  "",
  "Branch:",
  BRANCH,
  "",
  "Please inspect the repository, prepare an evidence-backed cleanup plan,",
  "quote the task using X Layer Testnet and test USD₮0, and deliver a",
  "verified pull request without pushing directly to main and without",
  "merging automatically.",
].join("\n");

interface ReviewerRun {
  index: number;
  promptTimestamp: string;
  acknowledgementTimestamp?: string;
  acknowledgementLatencyMs?: number;
  taskId?: string;
  deepScanId?: string;
  queueJobId?: string;
  workflowRunId?: string | null;
  workerId?: string | null;
  dispatchState?: string;
  finalAnalysisStatus?: string;
  sourceCommit?: string | null;
  findingsId?: string | null;
  findingsCounts?: Record<string, number>;
  failures: string[];
}

function failHard(msg: string, evidence: unknown): never {
  console.error(JSON.stringify({ verdict: "TESTNET_FAIL", error: msg, evidence }, null, 2));
  process.exit(1);
}

async function pollDeepScan(deepScanId: string, timeoutMs: number) {
  const started = Date.now();
  let last: Record<string, unknown> = {};
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${BASE}/api/deep-scans/${deepScanId}`);
    if (res.status === 200) {
      last = (await res.json()) as Record<string, unknown>;
      const stage = String((last.job as { stage?: string })?.stage ?? last.stage ?? "");
      const run =
        (last.workflowRunId as string | null) ??
        ((last.job as { workflowRunId?: string })?.workflowRunId ?? null);
      const worker =
        (last.workerId as string | null) ??
        ((last.job as { claimedBy?: string })?.claimedBy ?? null);
      if (
        run ||
        worker ||
        ["WAITING_FOR_RUNNER", "DISPATCHED", "CLAIMED", "ARCHIVE_READY", "READY", "COMPLETED"].includes(
          stage
        )
      ) {
        return { ok: true, body: last, stage, run, worker };
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { ok: false, body: last };
}

async function waitAnalysis(deepScanId: string, timeoutMs: number) {
  const started = Date.now();
  let last: Record<string, unknown> = {};
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${BASE}/api/deep-scans/${deepScanId}`);
    if (res.status === 200) {
      last = (await res.json()) as Record<string, unknown>;
      const stage = String((last.job as { stage?: string })?.stage ?? last.stage ?? "");
      if (["READY", "COMPLETED", "FAILED_TERMINAL", "FAILED_RETRYABLE", "WORKER_STALLED"].includes(stage)) {
        return { done: true, body: last, stage };
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { done: false, body: last, stage: String((last.job as { stage?: string })?.stage ?? "") };
}

async function reviewerOnce(index: number): Promise<ReviewerRun> {
  const run: ReviewerRun = { index, promptTimestamp: new Date().toISOString(), failures: [] };
  const t0 = Date.now();
  // Combined prompt keeps "task" and supplies repository in one request (marketplace path).
  const res = await fetch(`${BASE}/api/a2a/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "repository.safe_cleanup",
      repoUrl: REPO,
      branch: BRANCH,
      message: `${REVIEWER_PROMPT_1}\n\n${REVIEWER_PROMPT_2}`,
      source: `okx_reviewer_canary_${index}`,
      asyncDelivery: true,
    }),
  });
  const latency = Date.now() - t0;
  run.acknowledgementLatencyMs = latency;
  run.acknowledgementTimestamp = new Date().toISOString();
  if (latency > 10_000) run.failures.push(`ack latency ${latency}ms > 10s hard fail`);
  if (res.status !== 200) {
    run.failures.push(`A2A HTTP ${res.status}`);
    try {
      const errBody = (await res.json()) as Record<string, unknown>;
      run.failures.push(`body:${String(errBody.code || errBody.error || "").slice(0, 180)}`);
    } catch {
      /* ignore */
    }
    return run;
  }
  const body = (await res.json()) as Record<string, unknown>;
  run.taskId = String(body.taskId ?? "");
  run.deepScanId = String(body.deepScanJobId ?? "");
  run.queueJobId = String(body.queueJobId ?? run.deepScanId);
  if (!run.taskId) run.failures.push("missing taskId");
  if (!run.deepScanId) run.failures.push("missing deepScanId");
  if (String(body.marketplaceLifecycle) === "WAITING_FOR_REPOSITORY") {
    run.failures.push("WAITING_FOR_REPOSITORY despite repo provided");
  }
  if (/Provide the repository URL/i.test(String(body.message ?? ""))) {
    run.failures.push("ack asks for repository again");
  }

  if (run.taskId) {
    const st = await fetch(`${BASE}/api/a2a/tasks/${run.taskId}`);
    if (st.status !== 200) run.failures.push(`task status HTTP ${st.status}`);
  }
  if (run.deepScanId) {
    const ds = await fetch(`${BASE}/api/deep-scans/${run.deepScanId}`);
    if (ds.status !== 200) run.failures.push(`deep-scan HTTP ${ds.status}`);
    else {
      const dispatched = await pollDeepScan(run.deepScanId, 30_000);
      if (!dispatched.ok) run.failures.push("no dispatch/lease within 30s");
      else {
        run.dispatchState = String(dispatched.body.dispatchState ?? "");
        run.workflowRunId = dispatched.run ?? null;
        run.workerId = dispatched.worker ?? null;
      }
      const analysis = await waitAnalysis(run.deepScanId, 180_000);
      run.finalAnalysisStatus = analysis.stage;
      const job = (analysis.body.job as Record<string, unknown>) || {};
      run.sourceCommit = (job.sourceCommit as string) ?? null;
      run.findingsId = (job.findingsId as string) ?? null;
      run.workflowRunId =
        (analysis.body.workflowRunId as string) ??
        (job.workflowRunId as string) ??
        run.workflowRunId;
      run.workerId =
        (analysis.body.workerId as string) ?? (job.claimedBy as string) ?? run.workerId;
      const summary = (job.resultSummary as { findings?: Record<string, number> }) || {};
      if (summary.findings) {
        run.findingsCounts = {
          totalFindings: Number(summary.findings.totalFindings ?? 0),
          safeCandidates: Number(summary.findings.safeCandidates ?? 0),
          actionableFixes: Number(summary.findings.actionableFixes ?? 0),
        };
      }
      if (!analysis.done) {
        run.failures.push(
          `analysis not terminal within 180s (stage=${analysis.stage || "unknown"})`
        );
      }
      if (!analysis.done && analysis.stage === "QUEUED") {
        run.failures.push("analysis still QUEUED after 180s");
      }
      if (!analysis.done && !run.findingsId && analysis.stage === "QUEUED") {
        run.failures.push("no findings and no terminal error within 180s");
      }
    }
  }
  return run;
}

async function main() {
  if (!BASE) failHard("Set REPODIET_BASE_URL", {});

  const evidence: Record<string, unknown> = {
    stage: "stage1_no_token",
    baseUrl: BASE,
    startedAt: new Date().toISOString(),
    buyerPublicAddress: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
    sellerPublicAddress: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    buyerRoleEmail: "officialsmokychain@gmail.com",
    sellerRoleEmail: "abdullahlp114@gmail.com",
    agentId: "5283",
    a2aServiceId: "32947",
    a2mcpServiceId: "32948",
  };

  // Agent card + health
  const card = await fetch(`${BASE}/.well-known/agent-card.json`).then((r) => r.json());
  const health = await fetch(`${BASE}/api/okx/health`).then((r) => r.json());
  evidence.agentCard = {
    name: card.name,
    identity: card.identity,
  };
  evidence.health = {
    a2aRuntimeReady: health.a2aRuntimeReady,
    workerCapacityReady: health.workerCapacityReady,
    dispatcherReady: health.dispatcherReady,
    paymentEnvironment: health.paymentEnvironment,
    workerHeartbeatAgeMs: health.workerHeartbeatAgeMs,
    workerHeartbeatAgeSeconds: health.workerHeartbeatAgeSeconds,
    degradedReasons: health.degradedReasons,
  };

  // A2MCP unpaid + forged (must not execute); detect mainnet challenge
  const unpaidKey = `stage1_unpaid_${randomBytes(6).toString("hex")}`;
  const unpaid = await fetch(`${BASE}/api/a2mcp/quick-triage`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": unpaidKey },
    body: JSON.stringify({
      repositoryUrl: REPO,
      branch: BRANCH,
      maximumFindings: 3,
      operation: "analyze_repository",
    }),
  });
  const unpaidBody = (await unpaid.json()) as Record<string, unknown>;
  evidence.a2mcpUnpaidStatus = unpaid.status;
  const accepts = (unpaidBody.accepts as Array<Record<string, unknown>>) || [];
  const challengeNetwork = String(accepts[0]?.network ?? unpaidBody.network ?? "");
  const challengeAsset = String(accepts[0]?.asset ?? "").toLowerCase();
  evidence.a2mcpChallenge = {
    network: challengeNetwork,
    asset: challengeAsset,
    amount: accepts[0]?.amount,
    payTo: accepts[0]?.payTo,
  };
  if (challengeNetwork === MAINNET_NETWORK || challengeAsset === MAINNET_ASSET) {
    evidence.paymentBlock = {
      code: "MAINNET_CONFIGURATION_DETECTED",
      overall: "OWNER_ACTION_REQUIRED",
      blockReason:
        "Preview still issues eip155:196 / real USD₮0 challenges. Set REPODIET_PAYMENT_MODE=testnet and matching REPODIET_PAYMENT_* on the Preview deployment. NO_TRANSACTION_SENT.",
    };
    evidence.a2mcpPaymentSkipped = true;
    console.error(
      "MAINNET_CONFIGURATION_DETECTED — continuing Stage 1 no-token A2A engineering; no payment will be signed."
    );
  } else if (unpaid.status !== 402) {
    failHard(`unpaid A2MCP expected 402 got ${unpaid.status}`, evidence);
  }

  if (!evidence.a2mcpPaymentSkipped) {
    const forgedKey = `stage1_forged_${randomBytes(6).toString("hex")}`;
    const forged = await fetch(`${BASE}/api/a2mcp/quick-triage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": forgedKey,
        "PAYMENT-SIGNATURE": "forged-customer-signature",
      },
      body: JSON.stringify({
        repositoryUrl: REPO,
        branch: BRANCH,
        maximumFindings: 3,
        operation: "analyze_repository",
      }),
    });
    evidence.a2mcpForgedStatus = forged.status;
    if (forged.status === 200) failHard("forged signature executed", evidence);
  } else {
    evidence.a2mcpForgedStatus = "SKIPPED_MAINNET_CHALLENGE";
  }

  // Discovery-style message (exact reviewer first prompt without repo)
  const discoveryRes = await fetch(`${BASE}/api/a2a/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: REVIEWER_PROMPT_1 }),
  });
  const discoveryLatency = Date.now();
  evidence.discoveryAck = {
    status: discoveryRes.status,
    body: await discoveryRes.json(),
  };

  const runs: ReviewerRun[] = [];
  for (let i = 1; i <= 3; i++) {
    console.error(`Reviewer run ${i}/3…`);
    runs.push(await reviewerOnce(i));
    // Avoid stacking concurrent Actions + Redis pressure between canary runs.
    if (i < 3) await new Promise((r) => setTimeout(r, 15_000));
  }
  evidence.reviewerRuns = runs;
  evidence.taskIds = runs.map((r) => r.taskId);
  if (new Set(runs.map((r) => r.taskId)).size !== 3) {
    failHard("reviewer runs reused task IDs", evidence);
  }

  const failed = runs.filter((r) => r.failures.length > 0);
  evidence.verdictMatrix = {
    AGENT_RESPONSE: runs.every((r) => (r.acknowledgementLatencyMs ?? 99999) <= 10_000)
      ? "PASS"
      : "FAIL",
    A2A_TASK_PERSISTENCE: runs.every((r) => r.taskId) ? "PASS" : "FAIL",
    A2A_DEEP_SCAN_STATUS: runs.every((r) => r.deepScanId && !r.failures.some((f) => f.includes("deep-scan")))
      ? "PASS"
      : "FAIL",
    A2A_DISPATCH: runs.every((r) => r.workflowRunId || r.workerId || r.dispatchState === "DISPATCHED")
      ? "PASS"
      : "FAIL",
    A2A_WORKER_CLAIM: runs.every((r) => r.workerId || r.finalAnalysisStatus === "READY")
      ? "PASS"
      : "FAIL",
    A2A_ANALYSIS: runs.every(
      (r) =>
        r.finalAnalysisStatus === "READY" ||
        r.finalAnalysisStatus === "COMPLETED" ||
        Boolean(r.findingsId)
    )
      ? "PASS"
      : "FAIL",
    A2MCP_402: unpaid.status === 402 ? "PASS" : "FAIL",
    A2MCP_TESTNET_PAYMENT: evidence.a2mcpPaymentSkipped
      ? "OWNER_ACTION_REQUIRED"
      : "PENDING",
    HEALTH_FAIL_CLOSED:
      health.workerHeartbeatAgeMs == null && health.workerHeartbeatAgeSeconds === 0
        ? "FAIL"
        : "PASS",
  };

  const matrix = evidence.verdictMatrix as Record<string, string>;
  const engineeringPass = failed.length === 0 &&
    ["AGENT_RESPONSE", "A2A_TASK_PERSISTENCE", "A2A_DEEP_SCAN_STATUS", "A2A_DISPATCH", "A2A_WORKER_CLAIM", "A2A_ANALYSIS", "A2MCP_402", "HEALTH_FAIL_CLOSED"]
      .every((k) => matrix[k] === "PASS");

  evidence.overall = evidence.a2mcpPaymentSkipped
    ? engineeringPass
      ? "STAGE1_ENGINEERING_PASS_PAYMENT_OWNER_ACTION_REQUIRED"
      : "TESTNET_FAIL"
    : engineeringPass
      ? "STAGE1_PASS"
      : "TESTNET_FAIL";
  evidence.finishedAt = new Date().toISOString();
  evidence.digest = createHash("sha256").update(JSON.stringify(evidence)).digest("hex").slice(0, 16);

  fs.writeFileSync(ARTIFACT, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  if (String(evidence.overall).startsWith("TESTNET_FAIL")) process.exit(1);
  if (evidence.a2mcpPaymentSkipped) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
