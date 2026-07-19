#!/usr/bin/env tsx
/**
 * Phase 4 A2A production verification.
 * Usage: REPODIET_PRODUCTION_URL=https://your-app.vercel.app npm run verify:a2a
 */
import { verifyExecutionReceipt } from "@/lib/operator/sign-receipt";

const BASE = process.env.REPODIET_PRODUCTION_URL || process.env.NEXT_PUBLIC_APP_URL || "";
const REPO =
  process.env.REPODIET_A2A_TEST_REPO || "https://github.com/repodiet/demo-slop-app";

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

const checks: Check[] = [];

function record(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function pollTask(taskId: string, until: string[], timeoutMs = 300_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${BASE}/api/a2a/tasks/${taskId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(`poll failed: ${json.error}`);
    if (until.includes(json.status)) return json;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`poll timeout for ${taskId}`);
}

async function main() {
  if (!BASE) {
    console.error("FAIL: Set REPODIET_PRODUCTION_URL");
    process.exit(1);
  }

  console.log(`A2A production verify: ${BASE}`);

  const cardRes = await fetch(`${BASE}/.well-known/agent-card.json`);
  record("agent card", cardRes.ok, `status=${cardRes.status}`);
  const card = await cardRes.json();
  record("agent card task types", Array.isArray(card.supportedTaskTypes) && card.supportedTaskTypes.length >= 4);
  record("agent card status endpoint", Boolean(card.endpoints?.taskStatus));

  const submitRes = await fetch(`${BASE}/api/a2a/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "repository.safe_cleanup",
      repoUrl: REPO,
      branch: "main",
    }),
  });
  const submitJson = await submitRes.json();
  record("submit safe_cleanup", submitRes.ok && Boolean(submitJson.taskId), submitJson.taskId);
  const taskId = submitJson.taskId as string;

  const final = await pollTask(taskId, ["completed", "verification_failed", "analysis_failed"]);
  record("task completed", final.status === "completed", final.status);
  record("real progress transitions", (final.transitions?.length ?? 0) >= 5, `${final.transitions?.length} states`);

  const diff = final.changes?.unifiedDiff as string | undefined;
  record("final diff present", Boolean(diff && diff.includes("diff --git")));
  record("verification result", Boolean(final.verification?.status));
  record("receipt present", Boolean(final.receipt));

  if (final.receipt?.signature && process.env.REPODIET_OPERATOR_PUBLIC_KEY) {
    const ok = verifyExecutionReceipt(
      final.receipt.receipt ?? final.receipt,
      final.receipt.signature,
      process.env.REPODIET_OPERATOR_PUBLIC_KEY
    );
    record("receipt signature verify", ok);
  } else if (final.receipt?.signature) {
    record("receipt signature verify", false, "signature present but REPODIET_OPERATOR_PUBLIC_KEY missing");
  } else {
    record(
      "receipt signature verify",
      false,
      "unsigned receipt — not acceptable for production verification"
    );
  }

  record("verification_failed not success", final.status !== "verification_failed" || final.success === false);

  const prRes = await fetch(`${BASE}/api/a2a/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "repository.cleanup_pr",
      repoUrl: REPO,
      branch: "main",
      paymentReference: `beta_verify_${Date.now()}`,
      demo: REPO.includes("demo"),
    }),
  });
  const prJson = await prRes.json();
  record("submit cleanup_pr", prRes.ok && Boolean(prJson.taskId), prJson.taskId);

  if (prJson.taskId) {
    const prTask = await pollTask(
      prJson.taskId,
      ["awaiting_approval", "verification_failed", "delivery_failed", "completed", "analysis_failed"],
      300_000
    );
    record("cleanup_pr reaches checkpoint or terminal", Boolean(prTask.status), prTask.status);

    if (prTask.status === "awaiting_approval") {
      record("approval payload", Boolean(prTask.approval?.summary));
      const approveRes = await fetch(`${BASE}/api/a2a/tasks/${prJson.taskId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true }),
      });
      const approveJson = await approveRes.json();
      record("approval endpoint", approveRes.ok, approveJson.status);
      if (approveJson.pullRequest?.url) {
        record("PR URL returned", Boolean(approveJson.pullRequest.url), approveJson.pullRequest.url);
      } else if (approveJson.status === "delivery_failed") {
        record(
          "PR URL returned",
          false,
          "delivery_failed — production verify requires a real GitHub PR, not a missing-token pass"
        );
      } else {
        record("PR URL returned", false, `status=${approveJson.status}`);
      }
    }
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    console.error("FAILED:", failed.map((f) => f.name).join(", "));
    console.log("OVERALL: FAIL");
    process.exit(1);
  }
  console.log("OVERALL: PASS");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
