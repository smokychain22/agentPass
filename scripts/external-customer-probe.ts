#!/usr/bin/env npx tsx
/**
 * Anonymous external-customer probe for RepoDiet production/preview.
 *
 * Does NOT spend funds. Does NOT treat status=queued alone as a pass.
 * Upload redacted evidence via the calling CI workflow.
 *
 * Usage:
 *   REPODIET_BASE_URL=https://skillswap-virid-kappa.vercel.app npx tsx scripts/external-customer-probe.ts
 */
import { createHash, randomBytes } from "node:crypto";

const BASE = (process.env.REPODIET_BASE_URL || "https://skillswap-virid-kappa.vercel.app").replace(
  /\/$/,
  ""
);
const REPO =
  process.env.REPODIET_PROBE_REPO || "https://github.com/velz-cmd/repodiet-e2e-test";
const BRANCH = process.env.REPODIET_PROBE_BRANCH || "main";
const DISPATCH_SLA_MS = Number(process.env.REPODIET_DISPATCH_SLA_MS || 30_000);
const ANALYSIS_SLA_MS = Number(process.env.REPODIET_ANALYSIS_SLA_MS || 180_000);

interface Evidence {
  baseUrl: string;
  startedAt: string;
  finishedAt?: string;
  verdict: "PASS" | "FAIL";
  failures: string[];
  agentCard?: Record<string, unknown>;
  health?: Record<string, unknown>;
  a2mcpUnpaidStatus?: number;
  a2mcpForgedStatus?: number;
  taskId?: string;
  deepScanId?: string;
  queueJobId?: string;
  taskAckMs?: number;
  deepScanStatus?: number;
  dispatchState?: string;
  workflowRunId?: string | null;
  workerId?: string | null;
  taskStatusAfterDispatch?: string;
  notes: string[];
}

function fail(ev: Evidence, msg: string): never {
  ev.failures.push(msg);
  ev.verdict = "FAIL";
  ev.finishedAt = new Date().toISOString();
  console.error(JSON.stringify(ev, null, 2));
  process.exit(1);
}

async function main() {
  const ev: Evidence = {
    baseUrl: BASE,
    startedAt: new Date().toISOString(),
    verdict: "PASS",
    failures: [],
    notes: [],
  };

  // 1. Agent card
  const cardRes = await fetch(`${BASE}/.well-known/agent-card.json`);
  if (cardRes.status !== 200) fail(ev, `agent-card HTTP ${cardRes.status}`);
  const card = (await cardRes.json()) as Record<string, unknown>;
  ev.agentCard = {
    name: card.name ?? card.productName,
    asp: card.aspAgentId ?? (card as { asp?: unknown }).asp,
  };
  const cardText = JSON.stringify(card);
  if (!/RepoDiet/i.test(cardText)) fail(ev, "agent-card missing RepoDiet");
  if (!cardText.includes("5283")) fail(ev, "agent-card missing ASP 5283");
  if (!cardText.includes("32947")) fail(ev, "agent-card missing A2A 32947");
  if (!cardText.includes("32948")) fail(ev, "agent-card missing A2MCP 32948");

  // 2. Health
  const healthRes = await fetch(`${BASE}/api/okx/health`);
  if (healthRes.status !== 200) fail(ev, `health HTTP ${healthRes.status}`);
  const health = (await healthRes.json()) as Record<string, unknown>;
  ev.health = {
    a2aRuntimeReady: health.a2aRuntimeReady,
    workerReady: health.workerReady,
    dispatcherReady: health.dispatcherReady,
    workerCapacityReady: health.workerCapacityReady,
    queueDepth: health.queueDepth,
    activeJobs: health.activeJobs,
    activeWorkflowRuns: health.activeWorkflowRuns,
    activeWorkers: health.activeWorkers,
    workerHeartbeatAgeSeconds: health.workerHeartbeatAgeSeconds,
    degradedReasons: health.degradedReasons,
  };
  if (health.workerHeartbeatAgeMs === null && health.workerHeartbeatAgeSeconds === 0) {
    fail(ev, "health coerces null heartbeat age to 0");
  }

  // 3. A2MCP unpaid → 402
  const unpaidKey = `probe_unpaid_${randomBytes(8).toString("hex")}`;
  const unpaidRes = await fetch(`${BASE}/api/a2mcp/quick-triage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": unpaidKey,
    },
    body: JSON.stringify({
      repositoryUrl: REPO,
      branch: BRANCH,
      maximumFindings: 3,
      operation: "analyze_repository",
    }),
  });
  ev.a2mcpUnpaidStatus = unpaidRes.status;
  if (unpaidRes.status !== 402) fail(ev, `unpaid A2MCP expected 402 got ${unpaidRes.status}`);

  // 4. Forged signature with unique key → must not execute (402)
  const forgedKey = `probe_forged_${randomBytes(8).toString("hex")}`;
  const forgedRes = await fetch(`${BASE}/api/a2mcp/quick-triage`, {
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
  ev.a2mcpForgedStatus = forgedRes.status;
  if (forgedRes.status === 200) fail(ev, "forged signature must not execute");
  if (forgedRes.status !== 402 && forgedRes.status !== 401) {
    fail(ev, `forged signature unexpected status ${forgedRes.status}`);
  }

  // 5. A2A task accept within 10s
  const t0 = Date.now();
  const taskRes = await fetch(`${BASE}/api/a2a/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "repository.safe_cleanup",
      repoUrl: REPO,
      branch: BRANCH,
      source: "external_customer_probe",
      asyncDelivery: true,
    }),
  });
  const taskAckMs = Date.now() - t0;
  ev.taskAckMs = taskAckMs;
  if (taskRes.status !== 200) fail(ev, `A2A task HTTP ${taskRes.status}`);
  if (taskAckMs > 10_000) fail(ev, `A2A ack too slow: ${taskAckMs}ms`);
  const taskBody = (await taskRes.json()) as Record<string, unknown>;
  const taskId = String(taskBody.taskId ?? (taskBody.task as { taskId?: string })?.taskId ?? "");
  if (!taskId) fail(ev, "missing taskId");
  ev.taskId = taskId;
  const deepScanId = String(
    taskBody.deepScanJobId ??
      (taskBody.task as { deepScanJobId?: string })?.deepScanJobId ??
      ""
  );
  if (!deepScanId) fail(ev, "missing deepScanJobId");
  ev.deepScanId = deepScanId;
  ev.queueJobId = String(taskBody.queueJobId ?? deepScanId);
  const lifecycle = String(taskBody.marketplaceLifecycle ?? "");
  if (lifecycle === "WAITING_FOR_REPOSITORY") {
    fail(ev, "lifecycle incorrectly WAITING_FOR_REPOSITORY when repo was provided");
  }
  if (/Provide the repository URL/i.test(String(taskBody.message ?? ""))) {
    fail(ev, "ack asks for repository URL again");
  }

  // 6. Task status immediately retrievable
  const statusRes = await fetch(`${BASE}/api/a2a/tasks/${taskId}`);
  if (statusRes.status !== 200 && statusRes.status !== 403) {
    // Some deployments bind session ownership; opaque task id may still 403 — note it.
    ev.notes.push(`task status HTTP ${statusRes.status}`);
  } else if (statusRes.status === 200) {
    const st = (await statusRes.json()) as Record<string, unknown>;
    if (st.ok === false && st.terminal !== true && st.status === "queued") {
      fail(ev, "nonterminal queued task reported ok:false");
    }
  }

  // 7. Deep-scan status URL immediately retrievable
  const dsRes = await fetch(`${BASE}/api/deep-scans/${deepScanId}`);
  ev.deepScanStatus = dsRes.status;
  if (dsRes.status !== 200) {
    fail(ev, `deep-scan progress URL HTTP ${dsRes.status} for ${deepScanId}`);
  }
  const dsBody = (await dsRes.json()) as Record<string, unknown>;
  if (dsBody.ok !== true) fail(ev, "deep-scan body ok!=true");
  ev.dispatchState = String(dsBody.dispatchState ?? "");
  ev.workflowRunId =
    (dsBody.workflowRunId as string | null | undefined) ??
    ((dsBody.job as { workflowRunId?: string })?.workflowRunId ?? null);
  ev.workerId =
    (dsBody.workerId as string | null | undefined) ??
    ((dsBody.job as { claimedBy?: string })?.claimedBy ?? null);

  // 8. Dispatch SLA — workflow run or lease within 30s
  const dispatchDeadline = Date.now() + DISPATCH_SLA_MS;
  let dispatched = Boolean(ev.workflowRunId || ev.workerId);
  while (!dispatched && Date.now() < dispatchDeadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    const poll = await fetch(`${BASE}/api/deep-scans/${deepScanId}`);
    if (poll.status !== 200) continue;
    const body = (await poll.json()) as Record<string, unknown>;
    ev.dispatchState = String(body.dispatchState ?? ev.dispatchState);
    ev.workflowRunId =
      (body.workflowRunId as string | null | undefined) ??
      ((body.job as { workflowRunId?: string })?.workflowRunId ?? null);
    ev.workerId =
      (body.workerId as string | null | undefined) ??
      ((body.job as { claimedBy?: string })?.claimedBy ?? null);
    const stage = String((body.job as { stage?: string })?.stage ?? body.stage ?? "");
    if (
      ev.workflowRunId ||
      ev.workerId ||
      ["CLAIMED", "INVENTORY", "RUNNING_ANALYZERS", "READY", "COMPLETED"].includes(stage) ||
      String(body.dispatchState).includes("DISPATCHED") ||
      String(body.dispatchState) === "CLAIMED"
    ) {
      dispatched = true;
      // DISPATCHED without run id yet still counts if stage advanced past QUEUED
      if (!ev.workflowRunId && !ev.workerId && stage === "WAITING_FOR_RUNNER") {
        dispatched = true;
        ev.notes.push("dispatch accepted (WAITING_FOR_RUNNER) within SLA");
      }
    }
    if (["FAILED_TERMINAL", "FAILED_RETRYABLE", "CANCELLED"].includes(stage)) {
      fail(ev, `deep-scan entered terminal failure before dispatch success: ${stage}`);
    }
  }
  if (!dispatched) {
    // Health must be degraded when jobs sit undispatched
    const h2 = await fetch(`${BASE}/api/okx/health`).then((r) => r.json()) as Record<string, unknown>;
    ev.notes.push(`health after miss: ${JSON.stringify({
      a2aRuntimeReady: h2.a2aRuntimeReady,
      workerCapacityReady: h2.workerCapacityReady,
      degradedReasons: h2.degradedReasons,
    })}`);
    fail(ev, `no workflow run / lease / dispatched stage within ${DISPATCH_SLA_MS}ms`);
  }

  // 9. Progress beyond bare queued (analysis SLA — soft note if findings absent)
  const analysisDeadline = Date.now() + ANALYSIS_SLA_MS;
  let progressed = false;
  while (Date.now() < analysisDeadline) {
    const poll = await fetch(`${BASE}/api/deep-scans/${deepScanId}`);
    if (poll.status === 200) {
      const body = (await poll.json()) as Record<string, unknown>;
      const stage = String((body.job as { stage?: string })?.stage ?? body.stage ?? "");
      ev.taskStatusAfterDispatch = stage;
      if (stage && stage !== "QUEUED") {
        progressed = true;
        if (["READY", "COMPLETED", "FAILED_TERMINAL", "FAILED_RETRYABLE"].includes(stage)) break;
      }
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  if (!progressed) {
    fail(ev, `task remained QUEUED beyond analysis window ${ANALYSIS_SLA_MS}ms`);
  }

  ev.finishedAt = new Date().toISOString();
  ev.notes.push(
    `evidenceDigest=${createHash("sha256").update(JSON.stringify(ev)).digest("hex").slice(0, 16)}`
  );
  console.log(JSON.stringify(ev, null, 2));
  if (ev.verdict !== "PASS") process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
