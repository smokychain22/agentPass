/**
 * Trusted Actions complete job — ingest result or structured failure.
 */
import fs from "node:fs/promises";
import path from "node:path";

const WORK = "/tmp/repodiet-actions";
const WORKER_ID = "github-actions/ubuntu-latest";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function postIngest(apiBase: string, apiKey: string, jobId: string, body: unknown) {
  const res = await fetch(`${apiBase}/api/internal/actions/deep-scans/${jobId}/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(process.env.REPODIET_WORKER_CALLBACK_SECRET
        ? { "x-worker-callback-secret": process.env.REPODIET_WORKER_CALLBACK_SECRET }
        : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof json === "object" && json && "error" in json
        ? String((json as { error: string }).error)
        : `ingest failed (${res.status})`
    );
  }
  return json;
}

async function main(): Promise<void> {
  if (process.env.INPUT_ALREADY_CLAIMED === "true") {
    console.log("ALREADY_CLAIMED — complete job no-op.");
    return;
  }

  const apiKey = requireEnv("REPODIET_WORKER_API_KEY");
  const apiBase = requireEnv("INPUT_API_BASE_URL").replace(/\/$/, "");
  const jobId = requireEnv("INPUT_JOB_ID");
  const claimToken = process.env.INPUT_CLAIM_TOKEN?.trim();
  const analyzeResult = process.env.INPUT_ANALYZE_RESULT?.trim() || "success";

  const bundlePath = path.join(WORK, "result-bundle.json");
  let bundle: Record<string, unknown> | null = null;
  try {
    bundle = JSON.parse(await fs.readFile(bundlePath, "utf8")) as Record<string, unknown>;
  } catch {
    bundle = null;
  }

  if (!claimToken) {
    throw new Error("Missing claim token from claim job outputs.");
  }

  if (analyzeResult !== "success" || !bundle) {
    await postIngest(apiBase, apiKey, jobId, {
      workerId: WORKER_ID,
      claimToken,
      stage: "FAILED_RETRYABLE",
      failureCode: bundle ? "ACTIONS_ANALYZER_FAILED" : "RESULT_ARTIFACT_MISSING",
      failureMessage: bundle
        ? "Analyzer job failed."
        : "Analyzer result artifact missing.",
      terminal: false,
      detail: `analyzeResult=${analyzeResult}`,
    });
    console.log(JSON.stringify({ event: "complete_failed_structured", jobId, analyzeResult }));
    return;
  }

  // Progress through stages before READY for UI honesty.
  for (const stage of (bundle.stages as string[]) || []) {
    await postIngest(apiBase, apiKey, jobId, {
      workerId: WORKER_ID,
      claimToken,
      stage,
      detail: `GitHub Actions: ${stage}`,
    });
  }

  await postIngest(apiBase, apiKey, jobId, {
    workerId: WORKER_ID,
    claimToken,
    stage: "READY",
    sourceCommit: bundle.sourceCommit,
    resultDigest: bundle.resultDigest,
    findings: bundle.findings,
    graph: bundle.graph,
    coverage: bundle.coverage,
    baseline: bundle.baseline,
    resultSummary: bundle.resultSummary,
  });

  console.log(JSON.stringify({ event: "complete_ready", jobId, findingsId: (bundle.findings as { scanId?: string })?.scanId }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
