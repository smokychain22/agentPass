const callbackSecret = process.env.WORKER_CALLBACK_SECRET?.trim() ?? "";

export async function registerWorker(
  apiBase: string,
  apiKey: string,
  body: {
    workerId: string;
    gitVersion: string;
    nodeVersion: string;
    npmVersion: string;
    hostname: string;
  }
): Promise<void> {
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/api/internal/worker/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      workerId: body.workerId,
      version: process.env.WORKER_VERSION ?? "1.0.0",
      hostname: body.hostname,
      gitVersion: body.gitVersion,
      nodeVersion: body.nodeVersion,
      npmVersion: body.npmVersion,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Worker register failed (${response.status}): ${text}`);
  }
}

export async function postCallback(
  apiBase: string,
  apiKey: string,
  jobId: string,
  action: "progress" | "complete" | "fail" | "heartbeat",
  body: Record<string, unknown>
): Promise<void> {
  const path =
    action === "heartbeat"
      ? "/api/internal/worker/heartbeat"
      : action === "progress"
        ? `/api/internal/worker/jobs/${jobId}/progress`
        : action === "complete"
          ? `/api/internal/worker/jobs/${jobId}/complete`
          : `/api/internal/worker/jobs/${jobId}/fail`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  if (callbackSecret) {
    headers["x-worker-callback-secret"] = callbackSecret;
  }

  const response = await fetch(`${apiBase.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Worker callback ${action} failed (${response.status}): ${text}`);
  }
}

export async function claimNextJob(apiBase: string, apiKey: string, workerId: string) {
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/api/internal/worker/jobs/claim-next`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ workerId }),
  });
  if (!response.ok) {
    throw new Error(`Claim failed: ${response.status}`);
  }
  const data = (await response.json()) as { ok: boolean; job: import("../../src/lib/worker/types").RepositoryJob | null };
  return data.job;
}
