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

async function postIncident(
  apiBase: string,
  apiKey: string,
  jobId: string,
  body: Record<string, unknown>
) {
  const res = await fetch(`${apiBase}/api/internal/actions/deep-scans/${jobId}/incident`, {
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
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`incident callback failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
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
  const requestId = process.env.INPUT_REQUEST_ID?.trim();

  const bundlePath = path.join(WORK, "result-bundle.json");
  let bundle: Record<string, unknown> | null = null;
  try {
    bundle = JSON.parse(await fs.readFile(bundlePath, "utf8")) as Record<string, unknown>;
  } catch {
    bundle = null;
  }

  if (!claimToken) {
    // Claim itself failed — persist structured failure without requiring a claim token.
    await postIncident(apiBase, apiKey, jobId, {
      code: "CLAIM_OUTPUT_MISSING",
      message: `Claim token missing from claim job outputs (analyzeResult=${analyzeResult}).`,
      terminal: false,
      requestId,
      stage: "complete",
    });
    console.log(
      JSON.stringify({
        event: "complete_claim_missing_incident",
        jobId,
        analyzeResult,
      })
    );
    return;
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

  console.log(
    JSON.stringify({
      event: "complete_ready",
      jobId,
      findingsId: (bundle.findings as { scanId?: string })?.scanId,
    })
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
