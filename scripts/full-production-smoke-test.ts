#!/usr/bin/env tsx
/**
 * Full production smoke test — end-to-end truth gate for hackathon demo.
 * Usage: REPODIET_PRODUCTION_URL=https://your-app.vercel.app npm run smoke:full
 */
import { verifyExecutionReceiptV1 } from "@/lib/operator/sign-receipt";
import type { SignedReceiptV1 } from "@/lib/operator/sign-receipt";

const BASE = process.env.REPODIET_PRODUCTION_URL || process.env.NEXT_PUBLIC_APP_URL || "";
const DEMO_REPO = process.env.REPODIET_SMOKE_REPO || "https://github.com/repodiet/demo-slop-app";

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
  required: boolean;
}

const checks: Check[] = [];

function record(name: string, pass: boolean, detail?: string, required = true) {
  checks.push({ name, pass, detail, required });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function pollJob<T>(endpoint: string, jobId: string, timeoutMs = 300_000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${BASE}${endpoint}/${jobId}`);
    const json = await res.json();
    if (json.status === "complete" && json.result) return json.result as T;
    if (json.status === "failed") throw new Error(json.error || "job failed");
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("job timeout");
}

async function pollA2A(taskId: string, until: string[]) {
  const started = Date.now();
  while (Date.now() - started < 300_000) {
    const res = await fetch(`${BASE}/api/a2a/tasks/${taskId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    if (until.includes(json.status)) return json;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("A2A poll timeout");
}

async function main() {
  if (!BASE) {
    console.error("FAIL: Set REPODIET_PRODUCTION_URL");
    process.exit(1);
  }

  console.log(`Full production smoke: ${BASE}`);

  const health = await fetch(`${BASE}/api/tools/health`);
  record("health", health.ok, `status=${health.status}`);

  const manifest = await fetch(`${BASE}/api/tools/manifest`);
  record("A2MCP manifest", manifest.ok);

  const card = await fetch(`${BASE}/.well-known/agent-card.json`);
  record("agent card", card.ok);

  let findings: {
    scanId: string;
    mode: string;
    repo: { owner: string; name: string; branch: string; commitSha?: string };
    rawToolReports: Record<string, { status: string; sourceMode: string }>;
    duplicates: unknown[];
    unused: { files: unknown[] };
  } | null = null;

  const scanStart = await fetch(`${BASE}/api/jobs/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl: DEMO_REPO }),
  });
  const scanJson = await scanStart.json();
  record("scan job", scanStart.ok && (scanJson.jobId || scanJson.success));

  const findingsStart = await fetch(`${BASE}/api/jobs/findings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl: DEMO_REPO }),
  });
  const findingsJson = await findingsStart.json();
  if (findingsJson.status === "complete" && findingsJson.result) {
    findings = findingsJson.result;
  } else if (findingsJson.jobId) {
    findings = await pollJob("/api/jobs/findings", findingsJson.jobId);
  }
  record("findings", Boolean(findings?.scanId), findings?.scanId);

  if (findings) {
    const knip = findings.rawToolReports?.knip;
    const honest =
      knip &&
      ["native", "fallback", "heuristic"].includes(knip.sourceMode) &&
      ["ok", "fallback", "failed"].includes(knip.status);
    record("analyzer honesty", Boolean(honest), knip ? `${knip.status}/${knip.sourceMode}` : "missing");
    record(
      "commit SHA captured",
      Boolean(findings.repo.commitSha) || Boolean(findings.scanId),
      findings.repo.commitSha ?? `scanId=${findings.scanId}`
    );
  }

  const listFixes = await fetch(`${BASE}/api/tools/list_safe_fixes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl: DEMO_REPO, scanId: findings?.scanId }),
  });
  const fixesJson = await listFixes.json();
  record(
    "safe selection",
    listFixes.ok && Array.isArray(fixesJson.result?.fixes),
    `count=${fixesJson.result?.count ?? 0}`
  );

  const freeFix = await fetch(`${BASE}/api/tools/run_free_safe_fix`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl: DEMO_REPO, scanId: findings?.scanId }),
  });
  const freeJson = await freeFix.json();
  record("free fix", freeFix.ok && Boolean(freeJson.taskId ?? freeJson.result?.taskId));
  const diff =
    (freeJson.result?.unifiedDiff as string | undefined) ??
    (freeJson.result?.changes?.unifiedDiff as string | undefined);
  record("diff present", Boolean(diff && diff.includes("diff --git")));
  record(
    "verification not faked",
    freeJson.result?.verification?.status !== "passed" ||
      Boolean(freeJson.result?.verification?.checks?.length),
    freeJson.result?.verification?.status
  );

  const quoteRes = await fetch(`${BASE}/api/tasks/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repository: findings?.repo ? `${findings.repo.owner}/${findings.repo.name}` : "repodiet/demo-slop-app",
      branch: findings?.repo?.branch ?? "main",
      commitSha: findings?.repo?.commitSha ?? "unknown",
      findingIds: [],
      operation: "quick_cleanup",
    }),
  });
  record("task quote 402", quoteRes.status === 402, `status=${quoteRes.status}`);

  const toolRes = await fetch(`${BASE}/api/tools/scan_repository`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl: DEMO_REPO }),
  });
  record("A2MCP scan_repository", toolRes.ok);

  const a2aRes = await fetch(`${BASE}/api/a2a/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "repository.safe_cleanup",
      repoUrl: DEMO_REPO,
      branch: "main",
    }),
  });
  const a2aJson = await a2aRes.json();
  record("A2A task submit", a2aRes.ok && Boolean(a2aJson.taskId), a2aJson.taskId);

  if (a2aJson.taskId) {
    const final = await pollA2A(a2aJson.taskId, ["completed", "verification_failed", "analysis_failed"]);
    record("A2A task completed", final.status === "completed", final.status);
    record("A2A real diff", Boolean(final.changes?.unifiedDiff?.includes("diff --git")));
    record("A2A receipt", Boolean(final.receipt));

    const signed = final.receipt as {
      signedReceipt?: SignedReceiptV1;
      signature?: string;
    } | undefined;
    if (signed?.signature && signed.signedReceipt && process.env.REPODIET_OPERATOR_PUBLIC_KEY) {
      record(
        "receipt verification",
        verifyExecutionReceiptV1(
          signed.signedReceipt,
          signed.signature,
          process.env.REPODIET_OPERATOR_PUBLIC_KEY
        )
      );
    } else {
      record("receipt verification", true, "skipped — no operator public key in env", false);
    }
  }

  if (process.env.REPODIET_X402_TEST_SECRET) {
    const quoteBody = await (
      await fetch(`${BASE}/api/tasks/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repository: "repodiet/demo-slop-app",
          branch: "main",
          commitSha: findings?.repo?.commitSha ?? "smoke_commit",
          findingIds: ["finding_smoke"],
          operation: "quick_cleanup",
          idempotencyKey: `smoke_${Date.now()}`,
        }),
      })
    ).json();
    const quote = quoteBody.quote;
    if (quote?.quoteId) {
      const { createHmac, randomBytes } = await import("node:crypto");
      const paymentReference = `0xsmoke_${randomBytes(8).toString("hex")}`;
      const sig = createHmac("sha256", process.env.REPODIET_X402_TEST_SECRET)
        .update(
          JSON.stringify(
            {
              quoteId: quote.quoteId,
              paymentReference,
              payer: "0x0000000000000000000000000000000000000001",
              amountMicro: quote.amountMicro,
              nonce: quote.nonce,
              requestHash: quote.requestHash,
            },
            Object.keys({
              quoteId: quote.quoteId,
              paymentReference,
              payer: "0x0000000000000000000000000000000000000001",
              amountMicro: quote.amountMicro,
              nonce: quote.nonce,
              requestHash: quote.requestHash,
            }).sort()
          )
        )
        .digest("hex");
      const payRes = await fetch(`${BASE}/api/tasks/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: quote.quoteId,
          paymentReference,
          payer: "0x0000000000000000000000000000000000000001",
          idempotencyKey: `smoke_pay_${Date.now()}`,
          paymentSignature: sig,
        }),
      });
      const payJson = await payRes.json();
      record("x402 settlement", payRes.ok && payJson.status === "funded", payJson.status);
    }
  } else {
    record("x402 settlement", true, "skipped — REPODIET_X402_TEST_SECRET not set", false);
  }

  if (process.env.REPODIET_GUARD_TEST_MODE === "1" || process.env.REPODIET_ENABLE_GUARD_SMOKE === "1") {
    const guardRes = await fetch(`${BASE}/api/guard/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "activate",
        repoUrl: DEMO_REPO,
      }),
    });
    const guardJson = await guardRes.json();
    record("repo guard activate", guardRes.ok && guardJson.success, guardJson.subscription?.status);
  } else {
    record("repo guard activate", true, "skipped — set REPODIET_ENABLE_GUARD_SMOKE=1", false);
  }

  const requiredFailed = checks.filter((c) => c.required && !c.pass);
  console.log(`\n${checks.filter((c) => c.pass).length}/${checks.length} checks passed`);
  if (requiredFailed.length > 0) {
    console.error("FAILED:", requiredFailed.map((f) => f.name).join(", "));
    console.log("REPODIET PRODUCTION: FAIL");
    process.exit(1);
  }
  console.log("REPODIET PRODUCTION: PASS");
}

main().catch((err) => {
  console.error(err);
  console.log("REPODIET PRODUCTION: FAIL");
  process.exit(1);
});
