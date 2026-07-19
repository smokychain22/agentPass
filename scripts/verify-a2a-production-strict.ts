#!/usr/bin/env tsx
/**
 * Strict staged A2A verifier — never accepts beta shortcuts.
 *
 * Modes:
 *   --stage preflight   Submit once, prove dispatch/analysis to plan/quote boundary
 *   --stage resume      Continue an existing task after owner funding/approval
 *   --stage final       Require PR + attestation + receipt + buyer accept + escrow release
 *
 * Usage:
 *   REPODIET_BASE_URL=https://… npx tsx scripts/verify-a2a-production-strict.ts --stage preflight
 *   REPODIET_BASE_URL=https://… npx tsx scripts/verify-a2a-production-strict.ts --stage resume --task-id task_…
 *   REPODIET_BASE_URL=https://… npx tsx scripts/verify-a2a-production-strict.ts --stage final --task-id task_…
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { verifyExecutionReceipt } from "@/lib/operator/sign-receipt";

const BASE = (
  process.env.REPODIET_BASE_URL ||
  process.env.REPODIET_PRODUCTION_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  ""
).replace(/\/$/, "");
const REPO =
  process.env.REPODIET_A2A_TEST_REPO || "https://github.com/velz-cmd/repodiet-e2e-test";
const ARTIFACT_DIR =
  process.env.REPODIET_STRICT_ARTIFACT_DIR || "/opt/cursor/artifacts/a2a-strict";

type Stage = "preflight" | "resume" | "final";

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

interface ContinuationArtifact {
  version: 1;
  baseUrl: string;
  stageCompleted: Stage;
  verdict: string;
  taskId: string;
  deepScanId?: string;
  queueJobId?: string;
  workflowRunId?: string | null;
  workerId?: string | null;
  sourceCommit?: string | null;
  repository?: string;
  findings?: unknown;
  planId?: string | null;
  contractId?: string | null;
  contractDigest?: string | null;
  quoteId?: string | null;
  status?: string;
  nextOwnerAction?: string;
  createdAt: string;
  updatedAt: string;
}

const checks: Check[] = [];

function record(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function parseArgs(argv: string[]) {
  let stage: Stage = "preflight";
  let taskId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stage" && argv[i + 1]) {
      stage = argv[++i] as Stage;
    } else if (a === "--task-id" && argv[i + 1]) {
      taskId = argv[++i];
    } else if (a.startsWith("--stage=")) {
      stage = a.slice("--stage=".length) as Stage;
    } else if (a.startsWith("--task-id=")) {
      taskId = a.slice("--task-id=".length);
    }
  }
  if (!["preflight", "resume", "final"].includes(stage)) {
    throw new Error(`Invalid stage: ${stage}`);
  }
  return { stage, taskId };
}

async function getJson(url: string) {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function pollDeepScan(
  deepScanId: string,
  timeoutMs: number
): Promise<{
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  workflowRunId?: string | null;
  workerId?: string | null;
  stage?: string;
  dispatchState?: string;
}> {
  const started = Date.now();
  let last: Record<string, unknown> = {};
  let lastStatus = 0;
  while (Date.now() - started < timeoutMs) {
    const { res, json } = await getJson(`${BASE}/api/deep-scans/${deepScanId}`);
    lastStatus = res.status;
    last = json as Record<string, unknown>;
    const stage = String((last.job as { stage?: string })?.stage ?? last.stage ?? "");
    const workflowRunId =
      (last.workflowRunId as string | null | undefined) ??
      ((last.job as { workflowRunId?: string })?.workflowRunId ?? null);
    const workerId =
      (last.workerId as string | null | undefined) ??
      ((last.job as { claimedBy?: string })?.claimedBy ?? null);
    const dispatchState = String(last.dispatchState ?? "");
    if (
      res.status === 200 &&
      (workflowRunId ||
        workerId ||
        ["WAITING_FOR_RUNNER", "DISPATCHED", "CLAIMED", "INVENTORY", "READY", "COMPLETED"].includes(
          stage
        ) ||
        dispatchState === "DISPATCHED" ||
        dispatchState === "CLAIMED")
    ) {
      return {
        ok: true,
        status: res.status,
        body: last,
        workflowRunId,
        workerId,
        stage,
        dispatchState,
      };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return {
    ok: false,
    status: lastStatus,
    body: last,
    workflowRunId:
      (last.workflowRunId as string | null | undefined) ??
      ((last.job as { workflowRunId?: string })?.workflowRunId ?? null),
    workerId:
      (last.workerId as string | null | undefined) ??
      ((last.job as { claimedBy?: string })?.claimedBy ?? null),
    stage: String((last.job as { stage?: string })?.stage ?? last.stage ?? ""),
    dispatchState: String(last.dispatchState ?? ""),
  };
}

async function pollTask(taskId: string, until: string[], timeoutMs = 300_000) {
  const started = Date.now();
  let last: Record<string, unknown> = {};
  while (Date.now() - started < timeoutMs) {
    const { res, json } = await getJson(`${BASE}/api/a2a/tasks/${taskId}`);
    last = json as Record<string, unknown>;
    if (res.ok && until.includes(String(json.status))) return json as Record<string, unknown>;
    if (res.status === 403) {
      // Session-bound ownership may block anonymous poll — continue via deep-scan only.
      throw new Error(`task status forbidden for ${taskId}`);
    }
    if (!res.ok && res.status !== 404) {
      throw new Error(`poll failed: ${JSON.stringify(json)}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return last;
}

function saveArtifact(art: ContinuationArtifact) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const file = path.join(ARTIFACT_DIR, `${art.taskId}.json`);
  fs.writeFileSync(file, JSON.stringify(art, null, 2));
  const digest = createHash("sha256").update(JSON.stringify(art)).digest("hex").slice(0, 16);
  console.log(`ARTIFACT ${file} digest=${digest}`);
  return file;
}

function loadArtifact(taskId: string): ContinuationArtifact | null {
  const file = path.join(ARTIFACT_DIR, `${taskId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as ContinuationArtifact;
}

function finish(verdict: string, exitCode = 0) {
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    console.error("FAILED:", failed.map((f) => f.name).join(", "));
  }
  console.log(`OVERALL: ${exitCode === 0 ? "PASS" : exitCode === 2 ? "OWNER_ACTION_REQUIRED" : "FAIL"}`);
  console.log(`VERDICT: ${verdict}`);
  process.exit(exitCode);
}

async function stagePreflight() {
  console.log(`Strict A2A preflight: ${BASE}`);
  const submitRes = await fetch(`${BASE}/api/a2a/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "repository.safe_cleanup",
      repoUrl: REPO,
      branch: "main",
      asyncDelivery: true,
      source: "strict_preflight",
    }),
  });
  const submitJson = (await submitRes.json()) as Record<string, unknown>;
  record("submit task", submitRes.ok && Boolean(submitJson.taskId), String(submitJson.taskId ?? ""));
  record(
    "ack not waiting for repository",
    submitJson.marketplaceLifecycle !== "WAITING_FOR_REPOSITORY",
    String(submitJson.marketplaceLifecycle)
  );
  record("ack within SLA fields", Boolean(submitJson.immediateAcknowledgement ?? submitJson.acknowledged));

  const taskId = String(submitJson.taskId ?? "");
  const deepScanId = String(submitJson.deepScanJobId ?? "");
  const queueJobId = String(submitJson.queueJobId ?? deepScanId);
  record("deepScanJobId returned", Boolean(deepScanId), deepScanId);

  if (!taskId || !deepScanId) {
    finish("NOT_READY", 1);
    return;
  }

  const dsImmediate = await fetch(`${BASE}/api/deep-scans/${deepScanId}`);
  record("deep-scan progress URL HTTP 200", dsImmediate.status === 200, `status=${dsImmediate.status}`);
  const dsImmediateBody = (await dsImmediate.json().catch(() => ({}))) as Record<string, unknown>;

  const dispatched = await pollDeepScan(deepScanId, 30_000);
  record(
    "workflow run or lease within 30s",
    Boolean(
      dispatched.workflowRunId ||
        dispatched.workerId ||
        dispatched.stage === "WAITING_FOR_RUNNER" ||
        dispatched.stage === "DISPATCHED" ||
        dispatched.dispatchState === "DISPATCHED"
    ),
    `stage=${dispatched.stage} dispatch=${dispatched.dispatchState} run=${dispatched.workflowRunId} worker=${dispatched.workerId}`
  );

  // Analysis progress window
  const analysis = await pollDeepScan(deepScanId, 180_000);
  const analysisStage = analysis.stage ?? "";
  const progressed =
    analysisStage !== "" &&
    analysisStage !== "QUEUED" &&
    analysisStage !== "DISPATCHING";
  record("analysis progressed beyond queued", progressed, analysisStage);

  let taskBody: Record<string, unknown> = submitJson;
  try {
    taskBody = await pollTask(
      taskId,
      [
        "awaiting_approval",
        "awaiting_payment",
        "quote_required",
        "analyzing",
        "fetching_repository",
        "diagnosis_ready",
        "analysis_failed",
        "completed",
      ],
      60_000
    );
  } catch (err) {
    record("task status poll", false, err instanceof Error ? err.message : String(err));
  }

  const status = String(taskBody.status ?? analysisStage);
  const findings =
    taskBody.findings ??
    (analysis.body.job as { resultSummary?: unknown })?.resultSummary ??
    null;
  const contractId =
    (taskBody.maintenanceContract as { contractId?: string } | undefined)?.contractId ??
    (taskBody.input as { contractId?: string } | undefined)?.contractId ??
    null;
  const contractDigest =
    (taskBody.maintenanceContract as { contractDigest?: string } | undefined)?.contractDigest ??
    null;
  const quoteId = (taskBody.quoteId as string | undefined) ?? null;
  const sourceCommit =
    ((analysis.body.job as { sourceCommit?: string })?.sourceCommit as string | undefined) ??
    ((dsImmediateBody.job as { sourceCommit?: string })?.sourceCommit ?? null);

  const ownerBoundary = [
    "awaiting_approval",
    "awaiting_payment",
    "quote_required",
    "diagnosis_ready",
  ].includes(status);

  const art: ContinuationArtifact = {
    version: 1,
    baseUrl: BASE,
    stageCompleted: "preflight",
    verdict: "OWNER_ACTION_REQUIRED",
    taskId,
    deepScanId,
    queueJobId,
    workflowRunId: analysis.workflowRunId ?? dispatched.workflowRunId ?? null,
    workerId: analysis.workerId ?? dispatched.workerId ?? null,
    sourceCommit,
    repository: REPO,
    findings,
    planId: (taskBody.planId as string | undefined) ?? null,
    contractId,
    contractDigest,
    quoteId,
    status,
    nextOwnerAction: ownerBoundary
      ? status === "awaiting_approval"
        ? "Approve exact cleanup plan for this taskId"
        : status === "awaiting_payment" || status === "quote_required"
          ? "Fund exact A2A quote / escrow for this taskId"
          : "Inspect diagnosis and continue negotiation"
      : progressed
        ? "Poll task until plan/quote/approval boundary, then fund or approve"
        : "Inspect dispatch/analysis failure before owner funding",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveArtifact(art);

  const hardFail = checks.some((c) => !c.pass && !c.name.includes("task status poll"));
  if (hardFail) {
    finish("NOT_READY", 1);
    return;
  }
  console.log("NEXT_OWNER_ACTION:", art.nextOwnerAction);
  finish("OWNER_ACTION_REQUIRED", 2);
}

async function stageResume(taskId: string) {
  console.log(`Strict A2A resume: ${BASE} task=${taskId}`);
  const prior = loadArtifact(taskId);
  record("continuation artifact present", Boolean(prior), prior ? "loaded" : "missing");

  const { res, json } = await getJson(`${BASE}/api/a2a/tasks/${taskId}`);
  record("retrieve existing task (no new submit)", res.ok || res.status === 403, `status=${res.status}`);
  if (!res.ok && res.status !== 403) {
    finish("NOT_READY", 1);
    return;
  }

  const task = json as Record<string, unknown>;
  if (prior?.repository) {
    const repoUrl =
      (task.repository as { url?: string } | undefined)?.url ||
      (task.input as { repoUrl?: string } | undefined)?.repoUrl;
    record("same repository preserved", !repoUrl || repoUrl.includes("repodiet-e2e-test"), String(repoUrl));
  }
  if (prior?.quoteId && task.quoteId) {
    record("same quote preserved", String(task.quoteId) === prior.quoteId, String(task.quoteId));
  }
  if (prior?.contractDigest && (task.maintenanceContract as { contractDigest?: string })?.contractDigest) {
    record(
      "same contract digest preserved",
      (task.maintenanceContract as { contractDigest?: string }).contractDigest === prior.contractDigest
    );
  }

  const status = String(task.status ?? "");
  const nextBoundary = [
    "awaiting_approval",
    "awaiting_payment",
    "quote_required",
    "delivery_ready",
    "buyer_accepted",
    "escrow_released",
    "completed",
    "delivery_failed",
    "analysis_failed",
  ];
  let current = task;
  try {
    current = await pollTask(taskId, nextBoundary, 180_000);
  } catch (err) {
    record("resume poll", false, err instanceof Error ? err.message : String(err));
  }

  const art: ContinuationArtifact = {
    version: 1,
    baseUrl: BASE,
    stageCompleted: "resume",
    verdict: "OWNER_ACTION_REQUIRED",
    taskId,
    deepScanId: prior?.deepScanId,
    queueJobId: prior?.queueJobId,
    workflowRunId: prior?.workflowRunId,
    workerId: prior?.workerId,
    sourceCommit: prior?.sourceCommit,
    repository: prior?.repository ?? REPO,
    findings: current.findings ?? prior?.findings,
    planId: (current.planId as string | undefined) ?? prior?.planId ?? null,
    contractId:
      (current.maintenanceContract as { contractId?: string } | undefined)?.contractId ??
      prior?.contractId ??
      null,
    contractDigest:
      (current.maintenanceContract as { contractDigest?: string } | undefined)?.contractDigest ??
      prior?.contractDigest ??
      null,
    quoteId: (current.quoteId as string | undefined) ?? prior?.quoteId ?? null,
    status: String(current.status ?? status),
    nextOwnerAction:
      String(current.status) === "awaiting_approval"
        ? "Approve exact cleanup plan"
        : String(current.status) === "awaiting_payment" || String(current.status) === "quote_required"
          ? "Fund exact A2A quote / escrow"
          : String(current.status) === "delivery_ready"
            ? "Buyer accept delivery then run --stage final"
            : "Run --stage final when PR + settlement evidence exist",
    createdAt: prior?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveArtifact(art);

  if (["delivery_failed", "analysis_failed", "verification_failed"].includes(String(current.status))) {
    record("resume reached product failure", false, String(current.status));
    finish("NOT_READY", 1);
    return;
  }

  console.log("NEXT_OWNER_ACTION:", art.nextOwnerAction);
  finish("OWNER_ACTION_REQUIRED", 2);
}

async function stageFinal(taskId: string) {
  console.log(`Strict A2A final: ${BASE} task=${taskId}`);
  if (!process.env.REPODIET_OPERATOR_PUBLIC_KEY?.trim()) {
    console.error("FAIL: REPODIET_OPERATOR_PUBLIC_KEY required for final stage");
    process.exit(1);
  }

  const prior = loadArtifact(taskId);
  const { res, json } = await getJson(`${BASE}/api/a2a/tasks/${taskId}`);
  record("retrieve existing task (no new submit)", res.ok, `status=${res.status}`);
  if (!res.ok) {
    finish("NOT_READY", 1);
    return;
  }
  const task = json as Record<string, unknown>;
  record("task id matches", String(task.taskId ?? taskId) === taskId);

  const prUrl = (task.pullRequest as { url?: string } | undefined)?.url;
  record("real PR URL", Boolean(prUrl && /^https:\/\/github\.com\//.test(prUrl)), prUrl);
  record(
    "delivery_failed is not a pass",
    String(task.status) !== "delivery_failed",
    String(task.status)
  );
  record(
    "not evidence-only delivery",
    !String(task.error ?? "").includes("evidence-only"),
    String(task.error ?? "")
  );

  const receipt = task.receipt as Record<string, unknown> | undefined;
  record("receipt present", Boolean(receipt && (receipt.receiptId || receipt.signature)));
  if (receipt?.signature) {
    const ok = verifyExecutionReceipt(
      (receipt.receipt as object) ?? receipt,
      String(receipt.signature),
      process.env.REPODIET_OPERATOR_PUBLIC_KEY!
    );
    record("receipt signature verifies", ok);
  } else {
    record("receipt signature verifies", false, "missing signature");
  }

  const attestation = task.attestation as Record<string, unknown> | undefined;
  record("attestation present", Boolean(attestation && (attestation.id || attestation.signature)));

  const settlement = (task.settlement as Record<string, unknown> | undefined) ?? {};
  record("buyer acceptance recorded", Boolean(settlement.buyerAcceptedAt), String(settlement.buyerAcceptedAt ?? ""));
  record(
    "escrow release recorded",
    Boolean(settlement.escrowReleasedAt || settlement.escrowReleaseReference),
    String(settlement.escrowReleaseReference ?? settlement.escrowReleasedAt ?? "")
  );

  const art: ContinuationArtifact = {
    version: 1,
    baseUrl: BASE,
    stageCompleted: "final",
    verdict: checks.every((c) => c.pass) ? "PRODUCTION_READY" : "NOT_READY",
    taskId,
    deepScanId: prior?.deepScanId,
    queueJobId: prior?.queueJobId,
    workflowRunId: prior?.workflowRunId,
    workerId: prior?.workerId,
    sourceCommit: prior?.sourceCommit,
    repository: prior?.repository ?? REPO,
    findings: task.findings ?? prior?.findings,
    planId: prior?.planId ?? null,
    contractId:
      (task.maintenanceContract as { contractId?: string } | undefined)?.contractId ??
      prior?.contractId ??
      null,
    contractDigest:
      (task.maintenanceContract as { contractDigest?: string } | undefined)?.contractDigest ??
      prior?.contractDigest ??
      null,
    quoteId: (task.quoteId as string | undefined) ?? prior?.quoteId ?? null,
    status: String(task.status),
    nextOwnerAction: checks.every((c) => c.pass) ? "NONE" : "Complete missing settlement evidence",
    createdAt: prior?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveArtifact(art);

  if (checks.some((c) => !c.pass)) {
    finish("NOT_READY", 1);
    return;
  }
  finish("PRODUCTION_READY", 0);
}

async function main() {
  if (!BASE) {
    console.error("FAIL: Set REPODIET_BASE_URL or REPODIET_PRODUCTION_URL");
    process.exit(1);
  }
  const { stage, taskId } = parseArgs(process.argv.slice(2));
  if (stage === "preflight") {
    await stagePreflight();
    return;
  }
  if (!taskId) {
    console.error("FAIL: --task-id required for resume/final");
    process.exit(1);
  }
  if (stage === "resume") {
    await stageResume(taskId);
    return;
  }
  await stageFinal(taskId);
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
