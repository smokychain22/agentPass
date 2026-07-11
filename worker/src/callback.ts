const apiKey = process.env.WORKER_API_KEY?.trim() ?? "";
const callbackSecret = process.env.WORKER_CALLBACK_SECRET?.trim() ?? apiKey;

export async function postCallback(
  apiBase: string,
  apiKey: string,
  jobId: string,
  action: "progress" | "complete" | "fail",
  body: Record<string, unknown>
): Promise<void> {
  const path =
    action === "progress"
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
